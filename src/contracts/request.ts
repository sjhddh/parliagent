import { z } from "zod";

export const DebateMode = z.enum(["micro", "fast", "balanced", "deep"]);
export type DebateMode = z.infer<typeof DebateMode>;

export const TaskType = z.enum([
  "general",
  "writing",
  "planning",
  "analysis",
  "coding",
  "strategy",
  "ethics",
]);
export type TaskType = z.infer<typeof TaskType>;

export const AnswerMode = z.enum([
  "answer",
  "memo",
  "plan",
  "review",
  "transcript",
]);
export type AnswerMode = z.infer<typeof AnswerMode>;

export const TraceLevel = z.enum(["none", "summary", "full"]);
export type TraceLevel = z.infer<typeof TraceLevel>;

export const OutputLength = z.enum(["short", "standard", "long"]);
export type OutputLength = z.infer<typeof OutputLength>;

export const SafetyMode = z.enum(["default", "strict"]);
export type SafetyMode = z.infer<typeof SafetyMode>;

export const ExecutionProfile = z.enum(["available", "federated", "supreme"]);
export type ExecutionProfile = z.infer<typeof ExecutionProfile>;

export const ParliagentConstraints = z.object({
  maxTokens: z.number().positive().optional(),
  maxLatencyMs: z.number().positive().optional(),
  maxRounds: z.number().int().min(1).max(5).optional(),
  outputLength: OutputLength.optional(),
  safetyMode: SafetyMode.optional(),
});
export type ParliagentConstraints = z.infer<typeof ParliagentConstraints>;

export const ParliagentRequest = z.object({
  prompt: z.string().min(1),
  mode: DebateMode.optional().default("micro"),
  executionProfile: ExecutionProfile.optional().default("available"),
  fullParliagent: z.boolean().optional().default(false),
  taskType: TaskType.optional(),
  answerMode: AnswerMode.optional().default("answer"),
  outputLanguage: z.string().optional(),
  seatHints: z.array(z.string()).optional(),
  excludeSeats: z.array(z.string()).optional(),
  constraints: ParliagentConstraints.optional(),
  seed: z.string().optional(),
  trace: TraceLevel.optional().default("summary"),
});
export type ParliagentRequest = z.infer<typeof ParliagentRequest>;
