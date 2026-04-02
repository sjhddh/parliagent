import { Speaker as SpeakerClass } from "./core/speaker.js";
import { DebateEventBus } from "./core/events.js";
import type { DebateEvent, DebateEventType, DebateEventHandler } from "./core/events.js";
import { ParliagentRequest as ParliagentRequestSchema } from "./contracts/request.js";
import type { ParliagentRequest } from "./contracts/request.js";
import type { ParliagentResponse } from "./contracts/response.js";
import type { RuntimeConfig } from "./runtime/policy.js";

export { SpeakerClass as Speaker };
export type { SpeakerCallbacks } from "./core/speaker.js";

export {
  ParliagentRequest,
  ParliagentResponse,
  SeatProfile,
  SubstratePolicy,
  SeatStatement,
  DisagreementRecord,
  DeliberationTrace,
  DebateMode,
  TaskType,
  AnswerMode,
  TraceLevel,
  OutputLength,
  ExecutionProfile,
} from "./contracts/index.js";

export { SeatRegistry, defaultRegistry } from "./seats/index.js";

export { ModelPolicy } from "./runtime/policy.js";
export type { RuntimeConfig } from "./runtime/policy.js";

export { selectChamber, classifyTask } from "./core/routing.js";
export { MODE_CONFIGS } from "./core/config.js";
export { PROFILE_CONCURRENCY, getProfileConcurrency } from "./core/config.js";
export { buildSynthesisPrompt, getSynthesisMaxTokens } from "./core/synthesis.js";
export { detectAntiCollapse, checkSafetyBoundaries, isHardBlocked } from "./core/safety.js";

export { DebateEventBus, callbacksToEventBus, eventBusToCallbacks } from "./core/events.js";
export type { DebateEvent, DebateEventType, DebateEventHandler } from "./core/events.js";

export { buildArgumentDAG, describeCriticalPath } from "./core/argument-dag.js";
export type { ArgumentNode, ArgumentEdge, ArgumentDAG } from "./core/argument-dag.js";

export { computeInformationGain, isEntropyConverged } from "./core/entropy.js";
export { computeCacheKey, defaultCacheConfig } from "./core/cache.js";
export { defaultHarvesterConfig } from "./core/harvester.js";

export { loadConfig, toRuntimeConfig } from "./config.js";
export type { ParliagentConfig } from "./config.js";

export { handleRequest } from "./handler.js";
export type { HandlerRequest, HandlerResponse } from "./handler.js";

export const Strategy = {
  DYNAMIC_ADVERSARIAL: "dynamic_adversarial",
  ROUND_ROBIN: "round_robin",
  ENTROPY_CONVERGENCE: "entropy_convergence",
  ROUND_LIMIT: "round_limit",
} as const;

export type StrategyValue = (typeof Strategy)[keyof typeof Strategy];

export interface ParliagentOptions {
  config?: RuntimeConfig;
  topology?: StrategyValue;
  haltingCondition?: StrategyValue;
  harvestExhaust?: boolean;
  cache?: boolean;
}

/**
 * High-level V2 API: stateful session with event-based observation.
 * Wraps Speaker + event bus + cache + harvester for ergonomic use.
 *
 * @example
 * ```ts
 * const session = new Parliagent({
 *   topology: Strategy.DYNAMIC_ADVERSARIAL,
 *   haltingCondition: Strategy.ENTROPY_CONVERGENCE,
 *   harvestExhaust: true,
 * });
 *
 * session.on("seat_responded", (e) => console.log(`[${e.seatId}] ${e.statement.summary}`));
 * session.on("objection_raised", (e) => console.log(`Objection: ${e.objection}`));
 *
 * const result = await session.debate("Should we migrate to an Agent-native L1?");
 * console.log(result.traceArtifact?.dagPath);
 * ```
 */
export class Parliagent {
  private speaker: SpeakerClass;
  private eventBus: DebateEventBus;

  constructor(opts: ParliagentOptions = {}) {

    const cacheConfig = opts.cache
      ? { enabled: true }
      : undefined;

    this.speaker = new SpeakerClass(opts.config, undefined, undefined, cacheConfig);
    this.eventBus = new DebateEventBus();

    if (opts.harvestExhaust) {
      process.env.PARLIAGENT_HARVEST = "on";
    }
  }

  on<T extends DebateEventType>(type: T, handler: DebateEventHandler<T>): this {
    this.eventBus.on(type, handler);
    return this;
  }

  off<T extends DebateEventType>(type: T, handler: DebateEventHandler<T>): this {
    this.eventBus.off(type, handler);
    return this;
  }

  private resolveRequest(promptOrRequest: string | ParliagentRequest): ParliagentRequest {
    const base = typeof promptOrRequest === "string"
      ? ParliagentRequestSchema.parse({ prompt: promptOrRequest, trace: "full" })
      : promptOrRequest;

    return base;
  }

  async debate(
    promptOrRequest: string | ParliagentRequest,
  ): Promise<ParliagentResponse> {
    const request = this.resolveRequest(promptOrRequest);
    const stream = this.speaker.debateStream(request);
    let response: ParliagentResponse | undefined;

    while (true) {
      const { value, done } = await stream.next();
      if (done) {
        response = value;
        break;
      }
      this.eventBus.emit(value);
    }

    if (!response) throw new Error("Debate stream ended without producing a response");
    return response;
  }

  debateStream(
    promptOrRequest: string | ParliagentRequest,
  ): AsyncGenerator<DebateEvent, ParliagentResponse> {
    const request = this.resolveRequest(promptOrRequest);
    return this.speaker.debateStream(request);
  }
}

/**
 * Convenience function — the primary skill-facing entry point.
 */
export async function debate(
  request: ParliagentRequest,
  config?: RuntimeConfig,
): Promise<ParliagentResponse> {
  const speaker = new SpeakerClass(config);
  return speaker.debate(request);
}

/**
 * Streaming entry point — yields DebateEvents during deliberation.
 */
export function debateStream(
  request: ParliagentRequest,
  config?: RuntimeConfig,
): AsyncGenerator<DebateEvent, ParliagentResponse> {
  const speaker = new SpeakerClass(config);
  return speaker.debateStream(request);
}
