import { z } from "zod";
import { DeliberationTrace } from "./trace.js";

export const DecisionType = z.enum([
  "consensus",
  "majority",
  "split",
  "uncertain",
]);
export type DecisionType = z.infer<typeof DecisionType>;

export const ParliagentResponse = z.object({
  finalAnswer: z.string(),
  decisionType: DecisionType,
  activatedSeats: z.array(z.string()),
  whyTheseSeats: z.string(),
  minorityReport: z.string().optional(),
  openQuestions: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  debateSummary: z.string().optional(),
  traceArtifact: DeliberationTrace.optional(),
});
export type ParliagentResponse = z.infer<typeof ParliagentResponse>;
