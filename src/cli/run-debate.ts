import { Speaker } from "../core/speaker.js";
import type { ParliamentRequest } from "../contracts/request.js";
import type {
  DebateMode,
  TaskType,
  AnswerMode,
  TraceLevel,
  ExecutionProfile,
} from "../contracts/request.js";
import { formatResponse, formatProgress } from "./format.js";
import { loadConfig, toRuntimeConfig } from "../config.js";

export interface CommandDefaults {
  mode: DebateMode;
  trace: TraceLevel;
  answerMode: AnswerMode;
  taskType?: TaskType;
  progressPrefix?: string;
}

export async function runDebate(
  prompt: string,
  opts: Record<string, unknown>,
  defaults: CommandDefaults,
): Promise<void> {
  const config = loadConfig();

  const outputLanguage =
    (opts.language as string | undefined) ??
    (opts.lang as string | undefined) ??
    config.defaults?.outputLanguage;

  const request: ParliamentRequest = {
    prompt,
    executionProfile:
      (opts.profile as ExecutionProfile | undefined) ??
      config.defaults?.executionProfile ??
      "available",
    fullParliament: !!opts.fullParliament,
    mode: (opts.mode as DebateMode) ?? config.defaults?.mode ?? defaults.mode,
    ...(outputLanguage ? { outputLanguage } : {}),
    taskType: (opts.task as TaskType | undefined) ?? defaults.taskType,
    answerMode: (opts.answer as AnswerMode) ?? defaults.answerMode,
    trace: (opts.trace as TraceLevel) ?? config.defaults?.trace ?? defaults.trace,
    seatHints: opts.seat as string[] | undefined,
    excludeSeats: opts.excludeSeat as string[] | undefined,
    constraints: {
      outputLength: opts.short
        ? "short"
        : opts.long
          ? "long"
          : config.defaults?.outputLength ?? "standard",
      ...(opts.maxTokens
        ? { maxTokens: opts.maxTokens as number }
        : config.budgetOverrides?.maxTokens
          ? { maxTokens: config.budgetOverrides.maxTokens }
          : {}),
      ...(opts.maxLatencyMs
        ? { maxLatencyMs: opts.maxLatencyMs as number }
        : config.budgetOverrides?.maxLatencyMs
          ? { maxLatencyMs: config.budgetOverrides.maxLatencyMs }
          : {}),
      ...(opts.safetyMode ? { safetyMode: opts.safetyMode as "default" | "strict" } : {}),
    },
    seed: opts.seed as string | undefined,
  };

  const prefix = defaults.progressPrefix ?? "Chamber";

  const speaker = new Speaker(toRuntimeConfig(config), undefined, {
    onSeatSelected: (seats) => {
      if (!opts.json) {
        formatProgress(`${prefix}: ${seats.filter((s) => s !== "Speaker").join(", ")}`);
      }
    },
    onRoundStart: (round) => {
      if (!opts.json) formatProgress(`Round ${round}...`);
    },
    onSeatSpeaking: (seatId, round) => {
      if (!opts.json) formatProgress(`  ${seatId} speaking (round ${round})`);
    },
    onRoundComplete: (round, result) => {
      if (!opts.json) {
        formatProgress(
          `  Round ${round} — agreement: ${Math.round(result.agreementRatio * 100)}%, objections: ${result.objectionCount}`,
        );
      }
    },
    onDebateEnd: (reason) => {
      if (!opts.json) formatProgress(`Complete: ${reason}`);
    },
  });

  try {
    const response = await speaker.debate(request);
    console.log(formatResponse(response, !!opts.json));
  } catch (error) {
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
    }
    process.exit(1);
  }
}

export function addCommonOptions(cmd: import("commander").Command) {
  return cmd
    .option("--language <code>", "Output language (e.g. zh, ja, es). Internal debate stays English.")
    .option("--lang <code>", "Alias for --language")
    .option("--full-parliament", "Activate all 33 seats (high cost, explicit opt-in)", false)
    .option("--profile <profile>", "Execution profile: available, federated, supreme", "available")
    .option("--seat <seats...>", "Preferred seats to include")
    .option("--exclude-seat <seats...>", "Seats to exclude")
    .option("--max-tokens <n>", "Maximum token budget", parseInt)
    .option("--max-latency-ms <n>", "Maximum latency in ms", parseInt)
    .option("--seed <value>", "Reproducibility seed")
    .option("--json", "Output as JSON", false)
    .option("--short", "Short output", false)
    .option("--long", "Long output", false);
}
