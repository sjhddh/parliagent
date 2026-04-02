import { Speaker } from "../core/speaker.js";
import { ParliagentRequest } from "../contracts/request.js";
import type {
  DebateMode,
  TaskType,
  AnswerMode,
  TraceLevel,
  ExecutionProfile,
} from "../contracts/request.js";
import { formatResponse, formatStreamEvent } from "./format.js";
import { loadConfig, toRuntimeConfig } from "../config.js";

export interface CommandDefaults {
  mode: DebateMode;
  trace: TraceLevel;
  answerMode: AnswerMode;
  taskType?: TaskType;
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

  const request: ParliagentRequest = {
    prompt,
    executionProfile:
      (opts.profile as ExecutionProfile | undefined) ??
      config.defaults?.executionProfile ??
      "federated",
    fullParliagent: !!opts.fullParliagent,
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

  const parsed = ParliagentRequest.safeParse(request);
  if (!parsed.success) {
    console.error(`Invalid options: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
    process.exit(1);
  }
  const validatedRequest = parsed.data;

  const speaker = new Speaker(toRuntimeConfig(config));

  try {
    if (opts.json) {
      const response = await speaker.debate(validatedRequest);
      console.log(formatResponse(response, true));
    } else {
      const stream = speaker.debateStream(validatedRequest);
      let response;
      while (true) {
        const { value, done } = await stream.next();
        if (done) {
          response = value;
          break;
        }
        const line = formatStreamEvent(value);
        if (line) process.stderr.write(line + "\n");
      }
      if (response) {
        console.log(formatResponse(response, false));
      }
    }
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
    .option("--full-parliagent", "Activate all 33 seats (high cost, explicit opt-in)", false)
    .option("--profile <profile>", "Execution profile: federated, available, supreme", "federated")
    .option("--seat <seats...>", "Preferred seats to include")
    .option("--exclude-seat <seats...>", "Seats to exclude")
    .option("--max-tokens <n>", "Maximum token budget", parseInt)
    .option("--max-latency-ms <n>", "Maximum latency in ms", parseInt)
    .option("--seed <value>", "Reproducibility seed")
    .option("--json", "Output as JSON", false)
    .option("--short", "Short output", false)
    .option("--long", "Long output", false);
}
