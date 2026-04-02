import { z } from "zod";

export const Stance = z.enum(["support", "mixed", "oppose", "uncertain"]);
export type Stance = z.infer<typeof Stance>;

export const SeatStatement = z.object({
  seatId: z.string(),
  round: z.number().int().min(1),
  stance: Stance,
  summary: z.string(),
  claims: z.array(z.string()).min(1).max(3),
  objections: z.array(z.string()).max(2),
  confidence: z.number().int().min(1).max(5),
  warnings: z.array(z.string()).optional(),
});
export type SeatStatement = z.infer<typeof SeatStatement>;

export const DisagreementType = z.enum([
  "claim_conflict",
  "risk_warning",
  "priority_conflict",
  "uncertainty",
]);
export type DisagreementType = z.infer<typeof DisagreementType>;

export const DisagreementStatus = z.enum([
  "open",
  "resolved",
  "accepted_split",
]);
export type DisagreementStatus = z.infer<typeof DisagreementStatus>;

export const DisagreementRecord = z.object({
  topic: z.string(),
  seats: z.array(z.string()).min(1),
  type: DisagreementType,
  status: DisagreementStatus,
});
export type DisagreementRecord = z.infer<typeof DisagreementRecord>;

export const StopReason = z.enum([
  "converged",
  "budget",
  "latency",
  "round_limit",
  "blocking_warning",
]);
export type StopReason = z.infer<typeof StopReason>;

export const RoundResult = z.object({
  round: z.number().int().min(1),
  statements: z.array(SeatStatement),
  disagreements: z.array(DisagreementRecord),
  agreementRatio: z.number().min(0).max(1),
  objectionCount: z.number().int().min(0),
  distinctViewCount: z.number().int().min(1),
  blockingWarning: z.boolean(),
});
export type RoundResult = z.infer<typeof RoundResult>;

export const DeliberationTrace = z.object({
  selectedSeats: z.array(z.string()),
  routingReason: z.string(),
  rounds: z.array(RoundResult),
  stopReason: StopReason,
  modelAssignments: z.record(z.string(), z.string()).optional(),
  totalTokensUsed: z.number().int().optional(),
  totalLatencyMs: z.number().int().optional(),
});
export type DeliberationTrace = z.infer<typeof DeliberationTrace>;
