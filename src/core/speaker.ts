import type { AnswerMode, ExecutionProfile, OutputLength, ParliagentRequest } from "../contracts/request.js";
import type { DecisionType, ParliagentResponse } from "../contracts/response.js";
import type { AgendaStage, DisagreementRecord, RoundResult, StopReason } from "../contracts/trace.js";
import type { SeatProfile } from "../contracts/seats.js";
import { ModelPolicy } from "../runtime/policy.js";
import type { RuntimeConfig } from "../runtime/policy.js";
import { defaultRegistry, SeatRegistry } from "../seats/registry.js";
import { selectChamber, selectFullParliagent } from "./routing.js";
import { FULL_PARLIAGENT_CONFIG, MODE_CONFIGS, getProfileConcurrency, shouldUpgradeSecurity } from "./config.js";
import { computeCacheKey, defaultCacheConfig, readCache, writeCache } from "./cache.js";
import type { CacheConfig } from "./cache.js";
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
import { isEntropyConverged } from "./entropy.js";
import { buildArgumentDAG, describeCriticalPath } from "./argument-dag.js";
import { defaultHarvesterConfig, harvestDebateExhaust } from "./harvester.js";
import type { HarvesterConfig } from "./harvester.js";
import type { DebateEvent } from "./events.js";

export const SPEAKER_SEAT_ID = "Speaker";

export interface SpeakerCallbacks {
  onSeatSelected?: (seats: string[]) => void;
  onRoundStart?: (round: number) => void;
  onSeatSpeaking?: (seatId: string, round: number) => void;
  onRoundComplete?: (round: number, result: RoundResult) => void;
  onDebateEnd?: (reason: StopReason) => void;
}

type EventSink = (event: DebateEvent) => void;

interface DebateContext {
  highestStage: AgendaStage;
}

export class Speaker {
  private registry: SeatRegistry;
  private modelPolicy: ModelPolicy;
  private callbacks: SpeakerCallbacks;
  private cacheConfig: CacheConfig;
  private harvesterConfig: HarvesterConfig;

  private static readonly STAGE_ORDER: Record<AgendaStage, number> = {
    opening: 0,
    rebuttal: 1,
    resolution: 2,
  };

  constructor(
    config?: RuntimeConfig,
    registry?: SeatRegistry,
    callbacks?: SpeakerCallbacks,
    cacheConfig?: Partial<CacheConfig>,
  ) {
    this.registry = registry ?? defaultRegistry;
    this.modelPolicy = new ModelPolicy(config);
    this.callbacks = callbacks ?? {};
    this.cacheConfig = { ...defaultCacheConfig(), ...cacheConfig };
    this.harvesterConfig = defaultHarvesterConfig();
  }

  static withPolicy(policy: ModelPolicy, registry?: SeatRegistry, callbacks?: SpeakerCallbacks): Speaker {
    const instance = new Speaker(undefined, registry, callbacks);
    instance.modelPolicy = policy;
    return instance;
  }

  async debate(request: ParliagentRequest): Promise<ParliagentResponse> {
    const events: DebateEvent[] = [];
    const sink: EventSink = (event) => {
      events.push(event);
      this.dispatchCallback(event);
    };
    return this.runDebatePipeline(request, sink);
  }

  async *debateStream(request: ParliagentRequest): AsyncGenerator<DebateEvent, ParliagentResponse> {
    const eventQueue: DebateEvent[] = [];
    let resolveWait: (() => void) | undefined;
    let pipelineDone = false;
    let pipelineResult: ParliagentResponse | undefined;
    let pipelineError: Error | undefined;

    const sink: EventSink = (event) => {
      eventQueue.push(event);
      resolveWait?.();
    };

    const pipelinePromise = this.runDebatePipeline(request, sink)
      .then((result) => { pipelineResult = result; pipelineDone = true; resolveWait?.(); })
      .catch((err) => { pipelineError = err; pipelineDone = true; resolveWait?.(); });

    while (true) {
      while (eventQueue.length > 0) {
        yield eventQueue.shift()!;
      }
      if (pipelineDone) break;
      await new Promise<void>((resolve) => { resolveWait = resolve; });
    }

    while (eventQueue.length > 0) {
      yield eventQueue.shift()!;
    }

    if (pipelineError) throw pipelineError;
    await pipelinePromise;
    return pipelineResult!;
  }

  private async runDebatePipeline(
    request: ParliagentRequest,
    emit: EventSink,
  ): Promise<ParliagentResponse> {
    const ctx: DebateContext = { highestStage: "opening" };

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

    const speakingSeatIds = routing.selectedSeatIds.filter((id) => id !== SPEAKER_SEAT_ID);

    const cacheKey = computeCacheKey(request, routing.selectedSeatIds);
    const cached = readCache(cacheKey, this.cacheConfig);
    if (cached) {
      emit({ type: "cache_hit", hash: cacheKey });
      return cached;
    }

    emit({ type: "seat_selected", seats: routing.selectedSeatIds });

    const seatProfiles = speakingSeatIds.map((id) => this.registry.getOrThrow(id));
    const execProfile: ExecutionProfile = request.executionProfile ?? "federated";
    const assignments = this.modelPolicy.assignAll(seatProfiles, execProfile);
    const modelAssignments = this.modelPolicy.describeAssignments(seatProfiles, execProfile);

    const maxTokens = request.constraints?.maxTokens ?? modeConfig.defaultMaxTokens;
    const maxLatencyMs = request.constraints?.maxLatencyMs ?? modeConfig.defaultMaxLatencyMs;
    const maxRounds = request.constraints?.maxRounds ?? modeConfig.maxRounds;
    const profileConc = getProfileConcurrency(execProfile);
    const maxConcurrentSeats =
      request.constraints?.maxConcurrentSeats ?? Math.min(modeConfig.defaultMaxConcurrentSeats, profileConc.maxConcurrentSeats);

    let budget = createBudget({ maxTokens, maxLatencyMs, maxRounds });
    const allRounds: RoundResult[] = [];
    const seatFailureWarnings: string[] = [];
    let stopReason: StopReason = "round_limit";
    let totalParseRecoveries = 0;
    let totalDegradedParses = 0;

    for (let round = 1; round <= maxRounds; round++) {
      const previousStatements = allRounds.flatMap((r) => r.statements);
      const priorDisagreements = allRounds.length > 0 ? allRounds[allRounds.length - 1].disagreements : undefined;
      let stage = this.determineStage(ctx, round, priorDisagreements);

      emit({ type: "round_start", round, stage });

      const budgetCheck = checkBudget(budget);
      if (budgetCheck.exceeded) {
        stopReason = budgetCheck.reason!;
        emit({ type: "debate_end", reason: stopReason });
        break;
      }

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
        providerConcurrency: this.mergeProviderConcurrency(execProfile),
        onSeatSpeaking: (seatId, r) => {
          emit({ type: "seat_speaking", seatId, round: r });
        },
      });

      for (const stmt of roundResult.statements) {
        emit({ type: "seat_responded", seatId: stmt.seatId, statement: stmt });
        for (const objection of stmt.objections) {
          emit({ type: "objection_raised", seatId: stmt.seatId, objection });
        }
      }

      if (roundResult.failedSeats.length > 0) {
        seatFailureWarnings.push(
          `Round ${round}: ${roundResult.failedSeats.length} seat(s) failed to respond: ${roundResult.failedSeats.join(", ")}`,
        );
      }

      budget = addTokens(budget, roundResult.tokensUsed);
      budget = advanceRound(budget);
      totalParseRecoveries += roundResult.parseRecoveryCount;
      totalDegradedParses += roundResult.degradedParseCount;

      const hasEvidence = (request.evidenceBundle ?? []).length > 0;
      const convergence = evaluateConvergence({
        statements: roundResult.statements,
        modeConfig,
        currentRound: round,
        priorDisagreements,
        stage,
        hasEvidence,
      });

      const enrichedRoundResult: RoundResult = {
        ...convergence.roundResult,
        parseRecoveryCount: roundResult.parseRecoveryCount,
        degradedParseCount: roundResult.degradedParseCount,
      };

      allRounds.push(enrichedRoundResult);
      emit({ type: "round_complete", round, result: enrichedRoundResult });

      if (convergence.shouldStop && convergence.reason) {
        stopReason = convergence.reason;
        emit({ type: "debate_end", reason: stopReason });
        break;
      }

      if (isEntropyConverged(allRounds)) {
        stopReason = "entropy_converged";
        emit({ type: "debate_end", reason: stopReason });
        break;
      }
    }

    const lastRound = allRounds[allRounds.length - 1];
    const finalStatements = lastRound?.statements ?? [];

    const collapseWarnings = detectAntiCollapse(finalStatements);
    const decisionType = determineDecisionType(lastRound);
    emit({ type: "consensus_reached", decisionType });

    const answerMode: AnswerMode = request.answerMode ?? "answer";
    const outputLength: OutputLength = request.constraints?.outputLength ?? "standard";
    const outputLanguage = request.outputLanguage;

    emit({ type: "synthesis_start" });

    const finalAnswer = await this.synthesize(
      request.prompt,
      allRounds,
      decisionType,
      execProfile,
      answerMode,
      outputLength,
      outputLanguage,
    );

    emit({ type: "synthesis_complete", answer: finalAnswer });

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
        ? (() => {
            const dag = buildArgumentDAG(allRounds);
            return {
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
                argumentDAG: dag,
                dagPath: describeCriticalPath(dag),
              },
            };
          })()
        : {}),
    };

    writeCache(cacheKey, request, response, this.cacheConfig, routing.selectedSeatIds);
    harvestDebateExhaust(
      request.prompt, allRounds, decisionType, this.harvesterConfig,
      response.traceArtifact?.argumentDAG,
    );
    return response;
  }

  private dispatchCallback(event: DebateEvent): void {
    switch (event.type) {
      case "seat_selected": this.callbacks.onSeatSelected?.(event.seats); break;
      case "round_start": this.callbacks.onRoundStart?.(event.round); break;
      case "seat_speaking": this.callbacks.onSeatSpeaking?.(event.seatId, event.round); break;
      case "round_complete": this.callbacks.onRoundComplete?.(event.round, event.result); break;
      case "debate_end": this.callbacks.onDebateEnd?.(event.reason); break;
    }
  }

  private mergeProviderConcurrency(profile: ExecutionProfile): Partial<Record<string, number>> {
    const explicit = this.modelPolicy.getProviderConcurrency?.() ?? {};
    const profileConc = getProfileConcurrency(profile);
    const merged: Partial<Record<string, number>> = {};
    for (const provider of this.modelPolicy.availableProviders) {
      merged[provider] = explicit[provider] ?? profileConc.perProviderLimit;
    }
    return merged;
  }

  /**
   * Determine stage for this round. Stages progress monotonically:
   * opening -> rebuttal -> resolution. Never regresses.
   * Uses per-debate context to avoid instance-level state.
   */
  private determineStage(ctx: DebateContext, round: number, priorDisagreements?: DisagreementRecord[]): AgendaStage {
    if (round === 1) {
      ctx.highestStage = "opening";
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

    if (Speaker.STAGE_ORDER[candidate] < Speaker.STAGE_ORDER[ctx.highestStage]) {
      candidate = ctx.highestStage;
    }
    ctx.highestStage = candidate;
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
