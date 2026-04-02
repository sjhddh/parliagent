import type { ParliagentRequest, OutputLength, AnswerMode, ExecutionProfile } from "../contracts/request.js";
import type { ParliagentResponse, DecisionType } from "../contracts/response.js";
import type { SeatStatement, StopReason, RoundResult, AgendaStage, DisagreementRecord } from "../contracts/trace.js";
import type { SeatProfile } from "../contracts/seats.js";
import type { ModelAssignment } from "../runtime/policy.js";
import { ModelPolicy } from "../runtime/policy.js";
import type { RuntimeConfig } from "../runtime/policy.js";
import { SeatRegistry, defaultRegistry } from "../seats/registry.js";
import { selectChamber, selectFullParliagent } from "./routing.js";
import { MODE_CONFIGS, FULL_PARLIAGENT_CONFIG } from "./config.js";
import { evaluateConvergence, getDisputeParticipants } from "./convergence.js";
import { createBudget, addTokens, advanceRound, checkBudget } from "./budget.js";
import { buildSynthesisPrompt, getSynthesisMaxTokens, buildTraceText } from "./synthesis.js";
import { detectAntiCollapse, checkSafetyBoundaries, isHardBlocked } from "./safety.js";
import { shouldUpgradeSecurity } from "./config.js";

export interface SpeakerCallbacks {
  onSeatSelected?: (seats: string[]) => void;
  onRoundStart?: (round: number) => void;
  onSeatSpeaking?: (seatId: string, round: number) => void;
  onRoundComplete?: (round: number, result: RoundResult) => void;
  onDebateEnd?: (reason: StopReason) => void;
}

const STATEMENT_PROMPT = `You are participating in a structured parliamentary debate. Respond with a JSON object (no markdown, no code fences) matching this exact schema:

{
  "stance": "support" | "mixed" | "oppose" | "uncertain",
  "summary": "Your position in 1-2 sentences",
  "claims": ["Claim 1", "Claim 2"],
  "claimProvenance": ["supported" | "inferred" | "speculative" | "missing_evidence"],
  "objections": ["Objection, if any"],
  "confidence": 1-5,
  "warnings": ["Only if there are safety/security/legal concerns"]
}

Rules:
- "claims" must have 1-3 items — your strongest atomic arguments
- "claimProvenance" must match claims array length — classify each claim: "supported" (you have concrete evidence), "inferred" (logical deduction), "speculative" (hypothesis), "missing_evidence" (would need verification)
- "objections" can have 0-2 items — unresolved concerns about the motion or other positions
- "confidence" is 1 (very uncertain) to 5 (very confident)
- "warnings" is optional — only include if there are genuine safety, security, legal, or ethical red flags
- Be substantive and specific, not generic
- Take a clear position — do not hedge everything into "mixed" unless genuinely torn`;

const REBUTTAL_PROMPT = `You are in a rebuttal round. Other members have spoken. Review their positions, then respond with the same JSON schema as before. You may:
- Strengthen your position if you still believe it
- Shift your stance if persuaded by new arguments
- Raise new objections based on what you've heard
- Resolve previous objections if addressed

Remember to include "claimProvenance" for each claim.
Respond with JSON only (no markdown, no code fences).`;

const RESOLUTION_PROMPT_PREFIX = `You are in a dispute resolution round. The Speaker has identified specific unresolved disagreements that need your attention. Focus on THESE SPECIFIC disputes:

`;

const RESOLUTION_PROMPT_SUFFIX = `

For each dispute you are involved in, you must do ONE of:
1. RESOLVE: Change your position if persuaded — shift your stance
2. ACCEPT SPLIT: Acknowledge the disagreement is legitimate and both sides have merit — set stance to "mixed"
3. MAINTAIN: Hold your position but address the other side's strongest argument

Respond with the same JSON schema. Your response should directly address the disputes listed above.
Respond with JSON only (no markdown, no code fences).`;

function buildResolutionPrompt(disputes: string): string {
  return RESOLUTION_PROMPT_PREFIX + disputes + RESOLUTION_PROMPT_SUFFIX;
}

export class Speaker {
  private registry: SeatRegistry;
  private modelPolicy: ModelPolicy;
  private callbacks: SpeakerCallbacks;

  constructor(
    config?: RuntimeConfig,
    registry?: SeatRegistry,
    callbacks?: SpeakerCallbacks,
  ) {
    this.registry = registry ?? defaultRegistry;
    this.modelPolicy = new ModelPolicy(config);
    this.callbacks = callbacks ?? {};
  }

  static withPolicy(
    policy: ModelPolicy,
    registry?: SeatRegistry,
    callbacks?: SpeakerCallbacks,
  ): Speaker {
    const instance = new Speaker(undefined, registry, callbacks);
    instance.modelPolicy = policy;
    return instance;
  }

  async debate(request: ParliagentRequest): Promise<ParliagentResponse> {
    if (!this.modelPolicy.isReady()) {
      throw new Error(
        "No model provider configured. Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, FLOCK_API_KEY",
      );
    }

    const safetyMode = request.constraints?.safetyMode ?? "default";

    if (isHardBlocked(request.prompt, safetyMode)) {
      return {
        finalAnswer:
          "This request has been blocked by Parliagent's safety policy. The prompt appears to involve content that the system is not designed to assist with.",
        decisionType: "uncertain",
        activatedSeats: [],
        whyTheseSeats: "Debate was not initiated — prompt blocked by safety policy.",
        warnings: [
          "Hard safety block: prompt matched multiple safety-critical content categories.",
        ],
      };
    }

    let mode = request.mode ?? "micro";
    if (mode === "micro" && shouldUpgradeSecurity(request.prompt)) {
      mode = "fast";
    }
    const isFullParliagent = request.fullParliagent ?? false;
    const modeConfig = isFullParliagent ? FULL_PARLIAGENT_CONFIG : MODE_CONFIGS[mode];

    const safetyWarnings = checkSafetyBoundaries(request.prompt, safetyMode);

    const routing = isFullParliagent
      ? selectFullParliagent(
          request.prompt,
          request.taskType,
          request.excludeSeats,
          this.registry,
        )
      : selectChamber(
          request.prompt,
          mode,
          request.taskType,
          request.seatHints,
          request.excludeSeats,
          this.registry,
        );

    const speakingSeatIds = routing.selectedSeatIds.filter(
      (id) => id !== "Speaker",
    );

    this.callbacks.onSeatSelected?.(routing.selectedSeatIds);

    const seatProfiles = speakingSeatIds.map((id) =>
      this.registry.getOrThrow(id),
    );

    const execProfile: ExecutionProfile = request.executionProfile ?? "federated";

    const assignments = this.modelPolicy.assignAll(seatProfiles, execProfile);
    const modelAssignments = this.modelPolicy.describeAssignments(seatProfiles, execProfile);

    const maxTokens =
      request.constraints?.maxTokens ?? modeConfig.defaultMaxTokens;
    const maxLatencyMs =
      request.constraints?.maxLatencyMs ?? modeConfig.defaultMaxLatencyMs;
    const maxRounds =
      request.constraints?.maxRounds ?? modeConfig.maxRounds;

    let budget = createBudget({ maxTokens, maxLatencyMs, maxRounds });

    const allRounds: RoundResult[] = [];
    const seatFailureWarnings: string[] = [];
    let stopReason: StopReason = "round_limit";

    for (let round = 1; round <= maxRounds; round++) {
      this.callbacks.onRoundStart?.(round);

      const budgetCheck = checkBudget(budget);
      if (budgetCheck.exceeded) {
        stopReason = budgetCheck.reason!;
        this.callbacks.onDebateEnd?.(stopReason);
        break;
      }

      const previousRounds = allRounds.flatMap((r) => r.statements);
      const priorDisagreements = allRounds.length > 0
        ? allRounds[allRounds.length - 1].disagreements
        : undefined;

      const stage = this.determineStage(round, priorDisagreements);

      let roundSeats = seatProfiles;
      let roundAssignments = assignments;
      let disputeContext: string | undefined;

      if (stage === "resolution" && priorDisagreements) {
        const disputeParticipants = getDisputeParticipants(priorDisagreements);
        if (disputeParticipants.length >= 2) {
          roundSeats = seatProfiles.filter((s) =>
            disputeParticipants.includes(s.id),
          );
          disputeContext = this.formatDisputeContext(priorDisagreements);
        }
      }

      const roundResult = await this.runRound(
        round,
        request.prompt,
        roundSeats,
        roundAssignments,
        previousRounds,
        request.seed,
        stage,
        disputeContext,
      );

      if (roundResult.failedSeats.length > 0) {
        seatFailureWarnings.push(
          `Round ${round}: ${roundResult.failedSeats.length} seat(s) failed to respond: ${roundResult.failedSeats.join(", ")}`,
        );
      }

      budget = addTokens(budget, roundResult.tokensUsed);
      budget = advanceRound(budget);

      const convergence = evaluateConvergence({
        statements: roundResult.statements,
        modeConfig,
        currentRound: round,
        priorDisagreements,
        stage,
      });

      allRounds.push(convergence.roundResult);
      this.callbacks.onRoundComplete?.(round, convergence.roundResult);

      if (convergence.shouldStop && convergence.reason) {
        stopReason = convergence.reason;
        this.callbacks.onDebateEnd?.(stopReason);
        break;
      }
    }

    const lastRound = allRounds[allRounds.length - 1];
    const finalStatements = lastRound?.statements ?? [];

    const collapseWarnings = detectAntiCollapse(finalStatements);

    const decisionType = determineDecisionType(lastRound);
    const answerMode: AnswerMode = request.answerMode ?? "answer";
    const outputLength: OutputLength = request.constraints?.outputLength ?? "standard";
    const outputLanguage = request.outputLanguage;

    const finalAnswer = await this.synthesize(
      request.prompt,
      allRounds,
      decisionType,
      execProfile,
      answerMode,
      outputLength,
      outputLanguage,
    );

    const minorityReport = buildMinorityReport(finalStatements, decisionType);
    const openQuestions = extractOpenQuestions(allRounds);
    const allWarnings = [
      ...safetyWarnings,
      ...extractWarnings(allRounds),
      ...collapseWarnings,
      ...seatFailureWarnings,
    ];

    const response: ParliagentResponse = {
      finalAnswer,
      decisionType,
      activatedSeats: routing.selectedSeatIds,
      whyTheseSeats: routing.routingReason,
      ...(minorityReport ? { minorityReport } : {}),
      ...(openQuestions.length > 0 ? { openQuestions } : {}),
      ...(allWarnings.length > 0 ? { warnings: allWarnings } : {}),
      ...(request.trace !== "none"
        ? {
            debateSummary: buildDebateSummary(allRounds, stopReason),
          }
        : {}),
      ...(request.trace === "full"
        ? {
            traceArtifact: {
              selectedSeats: routing.selectedSeatIds,
              routingReason: routing.routingReason,
              rounds: allRounds,
              stopReason,
              modelAssignments,
              totalTokensUsed: budget.tokensUsed,
              totalLatencyMs: Date.now() - budget.startTime,
            },
          }
        : {}),
    };

    return response;
  }

  private highestStage: AgendaStage = "opening";

  private static readonly STAGE_ORDER: Record<AgendaStage, number> = {
    opening: 0,
    rebuttal: 1,
    resolution: 2,
  };

  /**
   * Determine stage for this round. Stages progress monotonically:
   * opening → rebuttal → resolution. Never regresses.
   * Resolution triggers on any open claim_conflict — even a single
   * seat-vs-seat dispute benefits from focused dispute resolution.
   */
  private determineStage(
    round: number,
    priorDisagreements?: DisagreementRecord[],
  ): AgendaStage {
    if (round === 1) {
      this.highestStage = "opening";
      return "opening";
    }

    let candidate: AgendaStage = "rebuttal";

    if (priorDisagreements) {
      const openDisputes = priorDisagreements.filter((d) => d.status === "open");
      const resolvable = openDisputes.filter((d) =>
        d.type === "claim_conflict" || d.type === "risk_warning" || d.type === "priority_conflict",
      );
      if (resolvable.length >= 1) {
        candidate = "resolution";
      }
    }

    if (Speaker.STAGE_ORDER[candidate] < Speaker.STAGE_ORDER[this.highestStage]) {
      candidate = this.highestStage;
    }
    this.highestStage = candidate;
    return candidate;
  }

  private formatDisputeContext(disagreements: DisagreementRecord[]): string {
    const resolvableTypes = new Set(["claim_conflict", "risk_warning", "priority_conflict"]);
    const open = disagreements.filter((d) => d.status === "open" && resolvableTypes.has(d.type));
    return open
      .slice(0, 5)
      .map((d, i) => `${i + 1}. [${d.type}: ${d.seats.join(" vs ")}] ${d.topic}`)
      .join("\n");
  }

  private async runRound(
    round: number,
    prompt: string,
    seats: SeatProfile[],
    assignments: Map<string, ModelAssignment>,
    previousStatements: SeatStatement[],
    seed?: string,
    stage?: AgendaStage,
    disputeContext?: string,
  ): Promise<{ statements: SeatStatement[]; failedSeats: string[]; tokensUsed: number }> {
    const isRebuttal = round > 1 && previousStatements.length > 0;
    const isResolution = stage === "resolution";
    const numericSeed = seed ? hashSeed(seed) : undefined;

    let roundTokens = 0;
    const promises = seats.map(async (seat) => {
      this.callbacks.onSeatSpeaking?.(seat.id, round);

      const assignment = assignments.get(seat.id);
      if (!assignment) {
        throw new Error(`No model assignment for seat ${seat.id}`);
      }

      let userContent: string;
      let instructionPrompt: string;

      if (isResolution && disputeContext) {
        instructionPrompt = buildResolutionPrompt(disputeContext);
        userContent = buildRebuttalContext(prompt, seat.id, previousStatements);
      } else if (isRebuttal) {
        instructionPrompt = REBUTTAL_PROMPT;
        userContent = buildRebuttalContext(prompt, seat.id, previousStatements);
      } else {
        instructionPrompt = STATEMENT_PROMPT;
        userContent = `Debate motion: ${prompt}`;
      }

      try {
        const result = await assignment.adapter.complete(
          [
            { role: "system", content: `${seat.systemPrompt}\n\n${instructionPrompt}` },
            { role: "user", content: userContent },
          ],
          {
            temperature: 0.7,
            maxTokens: 600,
            ...(numericSeed != null ? { seed: numericSeed } : {}),
          },
        );

        roundTokens += result.tokensUsed.total || estimateTokens(result.content);
        return parseStatement(result.content, seat.id, round);
      } catch (error) {
        return fallbackStatement(seat.id, round, error);
      }
    });

    const statements = await Promise.all(promises);
    const successful = statements.filter((s) => !isSeatFailure(s));
    const failed = statements.filter((s) => isSeatFailure(s));

    return {
      statements: successful.length > 0 ? successful : statements,
      failedSeats: failed.map((s) => s.seatId),
      tokensUsed: roundTokens,
    };
  }

  private async synthesize(
    prompt: string,
    rounds: RoundResult[],
    decisionType: DecisionType,
    execProfile: ExecutionProfile,
    answerMode: AnswerMode = "answer",
    outputLength: OutputLength = "standard",
    outputLanguage?: string,
  ): Promise<string> {
    const synthesisAdapter = this.modelPolicy.getSynthesisAdapter(execProfile);
    if (!synthesisAdapter) {
      return buildFallbackSynthesis(rounds, decisionType);
    }

    const synthesisPrompt = buildSynthesisPrompt({
      prompt,
      answerMode,
      decisionType,
      outputLength,
      rounds,
      outputLanguage,
    });

    const traceText = buildTraceText(rounds);
    const maxTokens = getSynthesisMaxTokens(answerMode, outputLength, outputLanguage);

    try {
      const result = await synthesisAdapter.complete(
        [
          { role: "system", content: synthesisPrompt },
          {
            role: "user",
            content: `Original question: ${prompt}\n\nDecision type: ${decisionType}\n\nDebate trace:\n${traceText}`,
          },
        ],
        { temperature: 0.4, maxTokens },
      );
      return result.content;
    } catch {
      return buildFallbackSynthesis(rounds, decisionType);
    }
  }
}

/**
 * Extract and parse JSON from LLM output using multiple strategies:
 * 1. Direct parse (if output is clean JSON)
 * 2. Strip markdown fences and parse
 * 3. Brace-depth extraction (handles preamble/trailing text)
 * 4. Truncation recovery (close unclosed braces/brackets)
 * 5. Regex fallback for individual fields
 */
function extractJSON(raw: string): unknown {
  const text = raw.trim();

  const strategies: Array<() => unknown> = [
    () => JSON.parse(text),
    () => {
      const stripped = text
        .replace(/^[^{]*/, "")
        .replace(/```\s*$/g, "")
        .trim();
      return JSON.parse(stripped);
    },
    () => extractByBraceDepth(text),
    () => recoverTruncatedJSON(text),
    () => extractFieldsViaRegex(text),
  ];

  for (const strategy of strategies) {
    try {
      const result = strategy();
      if (result && typeof result === "object") return result;
    } catch {
      continue;
    }
  }

  throw new Error("No valid JSON found after all extraction strategies");
}

function extractByBraceDepth(raw: string): unknown {
  const text = raw.replace(/```(?:json|JSON|js|javascript|typescript)?\s*\n?/g, "").trim();

  const braceStart = text.indexOf("{");
  if (braceStart === -1) throw new Error("No JSON object found");

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = braceStart; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(text.slice(braceStart, i + 1));
      }
    }
  }

  throw new Error("Unbalanced JSON braces");
}

function recoverTruncatedJSON(raw: string): unknown {
  const text = raw.replace(/```(?:json|JSON|js|javascript|typescript)?\s*\n?/g, "").trim();
  const braceStart = text.indexOf("{");
  if (braceStart === -1) throw new Error("No JSON");

  let fragment = text.slice(braceStart);

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const ch of fragment) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }

  if (inString) fragment += '"';

  const lastSignificant = fragment.search(/["\d\]}\w]\s*$/);
  if (lastSignificant >= 0) {
    const afterLast = fragment.slice(lastSignificant + 1).trim();
    if (afterLast === "" || afterLast === ",") {
      fragment = fragment.slice(0, lastSignificant + 1);
    }
  }

  while (openBrackets > 0) { fragment += "]"; openBrackets--; }
  while (openBraces > 0) { fragment += "}"; openBraces--; }

  return JSON.parse(fragment);
}

function extractFieldsViaRegex(raw: string): Record<string, unknown> {
  const stanceMatch = raw.match(/"stance"\s*:\s*"(support|mixed|oppose|uncertain)"/);
  const summaryMatch = raw.match(/"summary"\s*:\s*"([^"]+)"/);
  const confidenceMatch = raw.match(/"confidence"\s*:\s*(\d)/);

  if (!stanceMatch && !summaryMatch) throw new Error("No recognizable fields");

  const claimsMatch = raw.match(/"claims"\s*:\s*\[([^\]]*)\]/);
  let claims: string[] = [];
  if (claimsMatch) {
    claims = claimsMatch[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter((s) => s.length > 0);
  }

  return {
    stance: stanceMatch?.[1] ?? "uncertain",
    summary: summaryMatch?.[1] ?? raw.slice(0, 150),
    claims: claims.length > 0 ? claims : ["Recovered from partial output"],
    objections: [],
    confidence: confidenceMatch ? parseInt(confidenceMatch[1]) : 2,
  };
}

function parseStatement(
  raw: string,
  seatId: string,
  round: number,
): SeatStatement {
  try {
    const parsed = extractJSON(raw) as Record<string, unknown>;

    const claims = Array.isArray(parsed.claims)
      ? parsed.claims.slice(0, 3).map(String)
      : ["Position stated without specific claims"];

    const validProvenance = ["supported", "inferred", "speculative", "missing_evidence"] as const;
    type Provenance = typeof validProvenance[number];
    let claimProvenance: Provenance[] | undefined;
    if (Array.isArray(parsed.claimProvenance)) {
      const rawProv = parsed.claimProvenance.slice(0, claims.length) as unknown[];
      claimProvenance = rawProv.map((p): Provenance =>
        validProvenance.includes(String(p) as Provenance) ? String(p) as Provenance : "inferred",
      );
      while (claimProvenance.length < claims.length) {
        claimProvenance.push("missing_evidence");
      }
    }

    return {
      seatId,
      round,
      stance: validateStance(parsed.stance),
      summary: String(parsed.summary ?? "No summary provided"),
      claims,
      ...(claimProvenance !== undefined ? { claimProvenance } : {}),
      objections: Array.isArray(parsed.objections)
        ? parsed.objections.slice(0, 2).map(String)
        : [],
      confidence: validateConfidence(parsed.confidence),
      ...(Array.isArray(parsed.warnings) && parsed.warnings.length > 0
        ? { warnings: parsed.warnings.map(String) }
        : {}),
    };
  } catch {
    return {
      seatId,
      round,
      stance: "uncertain",
      summary: raw.slice(0, 200),
      claims: ["Unable to parse structured response"],
      objections: [],
      confidence: 2,
    };
  }
}

function validateStance(s: unknown): SeatStatement["stance"] {
  const valid = ["support", "mixed", "oppose", "uncertain"];
  return valid.includes(String(s)) ? (String(s) as SeatStatement["stance"]) : "uncertain";
}

function validateConfidence(c: unknown): 1 | 2 | 3 | 4 | 5 {
  const n = Number(c);
  if (n >= 1 && n <= 5) return Math.round(n) as 1 | 2 | 3 | 4 | 5;
  return 3;
}

function isSeatFailure(stmt: SeatStatement): boolean {
  return stmt.claims.length === 1 && stmt.claims[0] === "Seat could not produce a response";
}

function fallbackStatement(
  seatId: string,
  round: number,
  error: unknown,
): SeatStatement {
  return {
    seatId,
    round,
    stance: "uncertain",
    summary: `Seat unavailable: ${error instanceof Error ? error.message : "unknown error"}`,
    claims: ["Seat could not produce a response"],
    objections: [],
    confidence: 1,
    warnings: [`Seat ${seatId} failed to respond`],
  };
}

function buildRebuttalContext(
  prompt: string,
  currentSeatId: string,
  previousStatements: SeatStatement[],
): string {
  const othersText = previousStatements
    .filter((s) => s.seatId !== currentSeatId)
    .map(
      (s) =>
        `${s.seatId} (${s.stance}): ${s.summary}\n  Claims: ${s.claims.join("; ")}${s.objections.length > 0 ? `\n  Objections: ${s.objections.join("; ")}` : ""}`,
    )
    .join("\n\n");

  return `Original motion: ${prompt}\n\nOther members' positions:\n${othersText}`;
}

/**
 * Derive decision type from dispute resolution state, not just stance ratios.
 * Uses issue lifecycle as primary signal, falls back to stance metrics.
 */
export function determineDecisionType(lastRound?: RoundResult): DecisionType {
  if (!lastRound) return "uncertain";

  const total = lastRound.disagreements.length;
  const resolved = lastRound.resolvedCount ?? 0;
  const splits = lastRound.acceptedSplitCount ?? 0;
  const unresolved = lastRound.unresolvedCount ?? 0;

  if (total > 0) {
    if (unresolved === 0 && splits === 0) return "consensus";
    if (unresolved === 0 && splits > 0) return "majority";
    if (resolved + splits > unresolved) return "split";
    if (unresolved > resolved + splits) return "uncertain";
  }

  if (lastRound.agreementRatio >= 0.8 && lastRound.objectionCount === 0) {
    return "consensus";
  }
  if (lastRound.agreementRatio >= 0.6) {
    return "majority";
  }
  if (lastRound.distinctViewCount >= 3) {
    return "uncertain";
  }
  return "split";
}

function buildMinorityReport(
  statements: SeatStatement[],
  decisionType: DecisionType,
): string | undefined {
  if (decisionType === "consensus") return undefined;

  const majority = statements.reduce<Record<string, number>>(
    (acc, s) => {
      acc[s.stance] = (acc[s.stance] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const majorityStance = Object.entries(majority).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];

  const minorities = statements.filter(
    (s) => s.stance !== majorityStance && s.stance !== "uncertain",
  );

  if (minorities.length === 0) return undefined;

  return minorities
    .map(
      (s) =>
        `${s.seatId} (${s.stance}): ${s.summary} [${s.claims.join("; ")}]`,
    )
    .join("\n");
}

function extractOpenQuestions(rounds: RoundResult[]): string[] {
  const lastRound = rounds[rounds.length - 1];
  if (!lastRound) return [];

  return lastRound.disagreements
    .filter((d) => d.status === "open")
    .map((d) => d.topic);
}

function extractWarnings(rounds: RoundResult[]): string[] {
  const warnings = new Set<string>();
  for (const round of rounds) {
    for (const stmt of round.statements) {
      if (stmt.warnings) {
        stmt.warnings.forEach((w) => warnings.add(w));
      }
    }
  }
  return Array.from(warnings);
}

function buildDebateSummary(
  rounds: RoundResult[],
  stopReason: StopReason,
): string {
  const lines: string[] = [];

  for (const round of rounds) {
    const stageLabel = round.stage ? ` [${round.stage}]` : "";
    lines.push(`Round ${round.round}${stageLabel}:`);
    for (const stmt of round.statements) {
      lines.push(
        `  ${stmt.seatId}: ${stmt.stance} (confidence ${stmt.confidence}/5) — ${stmt.summary}`,
      );
    }
    lines.push(
      `  Agreement: ${Math.round(round.agreementRatio * 100)}%, Objections: ${round.objectionCount}`,
    );
    if (round.resolvedCount !== undefined) {
      lines.push(
        `  Issues: ${round.resolvedCount} resolved, ${round.acceptedSplitCount ?? 0} accepted splits, ${round.unresolvedCount ?? 0} unresolved`,
      );
    }
  }

  lines.push(`\nStopped: ${stopReason}`);
  return lines.join("\n");
}

function buildFallbackSynthesis(
  rounds: RoundResult[],
  decisionType: DecisionType,
): string {
  const lastRound = rounds[rounds.length - 1];
  if (!lastRound) return "No debate data available.";

  const claims = lastRound.statements.flatMap((s) => s.claims);
  return `Decision: ${decisionType}. Key points: ${claims.join(". ")}`;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
