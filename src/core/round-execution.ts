import type { EvidenceItem } from "../contracts/request.js";
import type { AgendaStage, DisagreementRecord, SeatStatement } from "../contracts/trace.js";
import type { SeatProfile } from "../contracts/seats.js";
import type { ModelAssignment } from "../runtime/policy.js";
import {
  RETRY_FEEDBACK,
  STATEMENT_JSON_SCHEMA,
  estimateTokens,
  fallbackStatement,
  isDegradedParse,
  isSeatFailure,
  parseStatement,
} from "./statement-parser.js";

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

function formatEvidenceBundle(items: EvidenceItem[]): string {
  const header = "=== SHARED EVIDENCE (reference these when classifying claim provenance) ===";
  const entries = items.map((item, i) => {
    const typeLabel = item.type ? ` [${item.type}]` : "";
    return `Evidence ${i + 1}${typeLabel} — ${item.source}:\n${item.content}`;
  });
  return `${header}\n\n${entries.join("\n\n")}`;
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

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const bounded = Math.max(1, Math.min(limit, items.length || 1));
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: bounded }, () => worker()));
  return results;
}

function createProviderLimiter(
  limits: Partial<Record<string, number>>,
): (providerId: string, task: () => Promise<SeatStatement>) => Promise<SeatStatement> {
  const inFlight = new Map<string, number>();
  const waiters = new Map<string, Array<() => void>>();

  function getLimit(providerId: string): number {
    return Math.max(1, limits[providerId] ?? Number.MAX_SAFE_INTEGER);
  }

  function enqueue(providerId: string): Promise<void> {
    return new Promise((resolve) => {
      const queue = waiters.get(providerId) ?? [];
      queue.push(resolve);
      waiters.set(providerId, queue);
    });
  }

  function release(providerId: string): void {
    const current = inFlight.get(providerId) ?? 0;
    if (current <= 1) inFlight.delete(providerId);
    else inFlight.set(providerId, current - 1);

    const queue = waiters.get(providerId);
    if (!queue || queue.length === 0) return;
    const next = queue.shift();
    if (queue.length === 0) waiters.delete(providerId);
    else waiters.set(providerId, queue);
    next?.();
  }

  return async (providerId: string, task: () => Promise<SeatStatement>): Promise<SeatStatement> => {
    const limit = getLimit(providerId);
    while ((inFlight.get(providerId) ?? 0) >= limit) {
      await enqueue(providerId);
    }

    inFlight.set(providerId, (inFlight.get(providerId) ?? 0) + 1);
    try {
      return await task();
    } finally {
      release(providerId);
    }
  };
}

export interface RoundExecutionInput {
  round: number;
  prompt: string;
  seats: SeatProfile[];
  assignments: Map<string, ModelAssignment>;
  previousStatements: SeatStatement[];
  seed?: string;
  stage?: AgendaStage;
  disputeContext?: string;
  evidenceBundle?: EvidenceItem[];
  maxConcurrentSeats: number;
  providerConcurrency: Partial<Record<string, number>>;
  onSeatSpeaking?: (seatId: string, round: number) => void;
}

export interface RoundExecutionResult {
  statements: SeatStatement[];
  failedSeats: string[];
  tokensUsed: number;
  parseRecoveryCount: number;
  degradedParseCount: number;
}

export function formatDisputeContext(disagreements: DisagreementRecord[]): string {
  const resolvableTypes = new Set(["claim_conflict", "risk_warning", "priority_conflict"]);
  const open = disagreements.filter((d) => d.status === "open" && resolvableTypes.has(d.type));
  return open
    .slice(0, 5)
    .map((d, i) => `${i + 1}. [${d.type}: ${d.seats.join(" vs ")}] ${d.topic}`)
    .join("\n");
}

export async function executeRound(input: RoundExecutionInput): Promise<RoundExecutionResult> {
  const {
    round,
    prompt,
    seats,
    assignments,
    previousStatements,
    seed,
    stage,
    disputeContext,
    evidenceBundle,
    maxConcurrentSeats,
    providerConcurrency,
    onSeatSpeaking,
  } = input;

  const isRebuttal = round > 1 && previousStatements.length > 0;
  const isResolution = stage === "resolution";
  const numericSeed = seed ? hashSeed(seed) : undefined;

  let roundTokens = 0;
  let parseRecoveryCount = 0;

  const runWithProviderLimit = createProviderLimiter(providerConcurrency);

  const statements = await mapWithConcurrency(seats, maxConcurrentSeats, async (seat) => {
    onSeatSpeaking?.(seat.id, round);

    const assignment = assignments.get(seat.id);
    if (!assignment) {
      throw new Error(`No model assignment for seat ${seat.id}`);
    }

    return runWithProviderLimit(assignment.adapter.providerId, async () => {
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

      if (evidenceBundle && evidenceBundle.length > 0) {
        userContent += "\n\n" + formatEvidenceBundle(evidenceBundle);
      }

      const completionOpts = {
        temperature: 0.7,
        maxTokens: 600,
        jsonMode: true,
        jsonSchema: STATEMENT_JSON_SCHEMA,
        ...(numericSeed != null ? { seed: numericSeed } : {}),
      };

      try {
        const messages = [
          { role: "system" as const, content: `${seat.systemPrompt}\n\n${instructionPrompt}` },
          { role: "user" as const, content: userContent },
        ];

        const result = await assignment.adapter.complete(messages, completionOpts);
        roundTokens += result.tokensUsed.total || estimateTokens(result.content);
        const stmt = parseStatement(result.content, seat.id, round);

        if (isDegradedParse(stmt)) {
          parseRecoveryCount++;
          const retryMessages = [
            ...messages,
            { role: "assistant" as const, content: result.content },
            { role: "user" as const, content: RETRY_FEEDBACK },
          ];
          const retry = await assignment.adapter.complete(retryMessages, completionOpts);
          roundTokens += retry.tokensUsed.total || estimateTokens(retry.content);
          return parseStatement(retry.content, seat.id, round);
        }

        return stmt;
      } catch (error) {
        return fallbackStatement(seat.id, round, error);
      }
    });
  });

  const successful = statements.filter((s) => !isSeatFailure(s));
  const failed = statements.filter((s) => isSeatFailure(s));
  const degradedParseCount = successful.filter((s) => isDegradedParse(s)).length;

  return {
    statements: successful.length > 0 ? successful : statements,
    failedSeats: failed.map((s) => s.seatId),
    tokensUsed: roundTokens,
    parseRecoveryCount,
    degradedParseCount,
  };
}
