import type { AnswerMode, ExecutionProfile, OutputLength, ParliagentRequest } from "../contracts/request.js";
import type { DecisionType, ParliagentResponse } from "../contracts/response.js";
import type { AgendaStage, DisagreementRecord, RoundResult, StopReason } from "../contracts/trace.js";
import type { SeatProfile } from "../contracts/seats.js";
import { ModelPolicy } from "../runtime/policy.js";
import type { RuntimeConfig } from "../runtime/policy.js";
import { defaultRegistry, SeatRegistry } from "../seats/registry.js";
import { selectChamber, selectFullParliagent } from "./routing.js";
import { FULL_PARLIAGENT_CONFIG, MODE_CONFIGS, shouldUpgradeSecurity } from "./config.js";
import { evaluateConvergence, getDisputeParticipants } from "./convergence.js";
import { addTokens, advanceRound, checkBudget, createBudget } from "./budget.js";
import { buildSynthesisPrompt, buildTraceText, getSynthesisMaxTokens } from "./synthesis.js";
import { checkSafetyBoundaries, detectAntiCollapse, isHardBlocked } from "./safety.js";
import {
  buildDebateSummary,
  buildFallbackSynthesis,
  buildMinorityReport,
  determineDecisionType,
  extractOpenQuestions,
  extractWarnings,
} from "./decision-semantics.js";
import { executeRound, formatDisputeContext } from "./round-execution.js";

export interface SpeakerCallbacks {
  onSeatSelected?: (seats: string[]) => void;
  onRoundStart?: (round: number) => void;
  onSeatSpeaking?: (seatId: string, round: number) => void;
  onRoundComplete?: (round: number, result: RoundResult) => void;
  onDebateEnd?: (reason: StopReason) => void;
}

export class Speaker {
  private registry: SeatRegistry;
  private modelPolicy: ModelPolicy;
  private callbacks: SpeakerCallbacks;
  private highestStage: AgendaStage = "opening";

  private static readonly STAGE_ORDER: Record<AgendaStage, number> = {
    opening: 0,
    rebuttal: 1,
    resolution: 2,
  };

  constructor(
    config?: RuntimeConfig,
    registry?: SeatRegistry,
    callbacks?: SpeakerCallbacks,
  ) {
    this.registry = registry ?? defaultRegistry;
    this.modelPolicy = new ModelPolicy(config);
    this.callbacks = callbacks ?? {};
  }

  static withPolicy(policy: ModelPolicy, registry?: SeatRegistry, callbacks?: SpeakerCallbacks): Speaker {
    const instance = new Speaker(undefined, registry, callbacks);
    instance.modelPolicy = policy;
    return instance;
  }

  async debate(request: ParliagentRequest): Promise<ParliagentResponse> {
    this.highestStage = "opening";

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
      ? selectFullParliagent(request.prompt, request.taskType, request.excludeSeats, this.registry)
      : selectChamber(
          request.prompt,
          mode,
          request.taskType,
          request.seatHints,
          request.excludeSeats,
          this.registry,
        );

    const speakingSeatIds = routing.selectedSeatIds.filter((id) => id !== "Speaker");
    this.callbacks.onSeatSelected?.(routing.selectedSeatIds);

    const seatProfiles = speakingSeatIds.map((id) => this.registry.getOrThrow(id));
    const execProfile: ExecutionProfile = request.executionProfile ?? "federated";
    const assignments = this.modelPolicy.assignAll(seatProfiles, execProfile);
    const modelAssignments = this.modelPolicy.describeAssignments(seatProfiles, execProfile);

    const maxTokens = request.constraints?.maxTokens ?? modeConfig.defaultMaxTokens;
    const maxLatencyMs = request.constraints?.maxLatencyMs ?? modeConfig.defaultMaxLatencyMs;
    const maxRounds = request.constraints?.maxRounds ?? modeConfig.maxRounds;
    const maxConcurrentSeats =
      request.constraints?.maxConcurrentSeats ?? modeConfig.defaultMaxConcurrentSeats;

    let budget = createBudget({ maxTokens, maxLatencyMs, maxRounds });
    const allRounds: RoundResult[] = [];
    const seatFailureWarnings: string[] = [];
    let stopReason: StopReason = "round_limit";
    let totalParseRecoveries = 0;
    let totalDegradedParses = 0;

    for (let round = 1; round <= maxRounds; round++) {
      this.callbacks.onRoundStart?.(round);

      const budgetCheck = checkBudget(budget);
      if (budgetCheck.exceeded) {
        stopReason = budgetCheck.reason!;
        this.callbacks.onDebateEnd?.(stopReason);
        break;
      }

      const previousStatements = allRounds.flatMap((r) => r.statements);
      const priorDisagreements = allRounds.length > 0 ? allRounds[allRounds.length - 1].disagreements : undefined;
      let stage = this.determineStage(round, priorDisagreements);

      let roundSeats: SeatProfile[] = seatProfiles;
      let disputeContext: string | undefined;

      if (stage === "resolution" && priorDisagreements) {
        const disputeParticipants = getDisputeParticipants(priorDisagreements);
        if (disputeParticipants.length >= 2) {
          roundSeats = seatProfiles.filter((s) => disputeParticipants.includes(s.id));
          disputeContext = formatDisputeContext(priorDisagreements);
        } else {
          stage = "rebuttal";
        }
      }

      const roundResult = await executeRound({
        round,
        prompt: request.prompt,
        seats: roundSeats,
        assignments,
        previousStatements,
        seed: request.seed,
        stage,
        disputeContext,
        evidenceBundle: request.evidenceBundle,
        maxConcurrentSeats,
        providerConcurrency: this.modelPolicy.getProviderConcurrency?.() ?? {},
        onSeatSpeaking: this.callbacks.onSeatSpeaking,
      });

      if (roundResult.failedSeats.length > 0) {
        seatFailureWarnings.push(
          `Round ${round}: ${roundResult.failedSeats.length} seat(s) failed to respond: ${roundResult.failedSeats.join(", ")}`,
        );
      }

      budget = addTokens(budget, roundResult.tokensUsed);
      budget = advanceRound(budget);
      totalParseRecoveries += roundResult.parseRecoveryCount;
      totalDegradedParses += roundResult.degradedParseCount;

      const convergence = evaluateConvergence({
        statements: roundResult.statements,
        modeConfig,
        currentRound: round,
        priorDisagreements,
        stage,
      });

      const enrichedRoundResult: RoundResult = {
        ...convergence.roundResult,
        parseRecoveryCount: roundResult.parseRecoveryCount,
        degradedParseCount: roundResult.degradedParseCount,
      };

      allRounds.push(enrichedRoundResult);
      this.callbacks.onRoundComplete?.(round, enrichedRoundResult);

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

    return {
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
              totalParseRecoveries,
              totalDegradedParses,
            },
          }
        : {}),
    };
  }

  /**
   * Determine stage for this round. Stages progress monotonically:
   * opening → rebuttal → resolution. Never regresses.
   */
  private determineStage(round: number, priorDisagreements?: DisagreementRecord[]): AgendaStage {
    if (round === 1) {
      this.highestStage = "opening";
      return "opening";
    }

    let candidate: AgendaStage = "rebuttal";
    if (priorDisagreements) {
      const openDisputes = priorDisagreements.filter((d) => d.status === "open");
      const resolvable = openDisputes.filter((d) =>
        d.type === "claim_conflict" || d.type === "risk_warning" || d.type === "priority_conflict"
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

export { determineDecisionType } from "./decision-semantics.js";
