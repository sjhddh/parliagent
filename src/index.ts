import { Speaker as SpeakerClass } from "./core/speaker.js";
export { SpeakerClass as Speaker };
export type { SpeakerCallbacks } from "./core/speaker.js";

export {
  ParliamentRequest,
  ParliamentResponse,
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
export { buildSynthesisPrompt, getSynthesisMaxTokens } from "./core/synthesis.js";
export { detectAntiCollapse, checkSafetyBoundaries, isHardBlocked } from "./core/safety.js";

export { loadConfig, toRuntimeConfig } from "./config.js";
export type { SunParliamentConfig } from "./config.js";

export { handleRequest } from "./handler.js";
export type { HandlerRequest, HandlerResponse } from "./handler.js";

/**
 * Convenience function — the primary skill-facing entry point.
 */
export async function debate(
  request: import("./contracts/request.js").ParliamentRequest,
  config?: import("./runtime/policy.js").RuntimeConfig,
): Promise<import("./contracts/response.js").ParliamentResponse> {
  const speaker = new SpeakerClass(config);
  return speaker.debate(request);
}
