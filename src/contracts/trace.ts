import { z } from "zod";

export const Stance = z.enum(["support", "mixed", "oppose", "uncertain"]);
export type Stance = z.infer<typeof Stance>;

export const ClaimProvenance = z.enum([
  "supported",
  "inferred",
  "speculative",
  "missing_evidence",
]);
export type ClaimProvenance = z.infer<typeof ClaimProvenance>;

export const SeatStatement = z.object({
  seatId: z.string(),
  round: z.number().int().min(1),
  stance: Stance,
  summary: z.string(),
  claims: z.array(z.string()).min(1).max(3),
  claimProvenance: z.array(ClaimProvenance).optional(),
  objections: z.array(z.string()).max(2),
  confidence: z.number().int().min(1).max(5),
  confidenceScore: z.number().min(0).max(1).optional(),
  warnings: z.array(z.string()).optional(),
}).refine(
  (data) => !data.claimProvenance || data.claimProvenance.length === data.claims.length,
  { message: "claimProvenance length must match claims length when present" },
);
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
  id: z.string().optional(),
  topic: z.string(),
  seats: z.array(z.string()).min(1),
  type: DisagreementType,
  status: DisagreementStatus,
});
export type DisagreementRecord = z.infer<typeof DisagreementRecord>;

export const AgendaStage = z.enum(["opening", "rebuttal", "resolution"]);
export type AgendaStage = z.infer<typeof AgendaStage>;

export const StopReason = z.enum([
  "converged",
  "budget",
  "latency",
  "round_limit",
  "blocking_warning",
  "issues_resolved",
  "entropy_converged",
]);
export type StopReason = z.infer<typeof StopReason>;

export const RoundResult = z.object({
  round: z.number().int().min(1),
  stage: AgendaStage.optional(),
  statements: z.array(SeatStatement),
  disagreements: z.array(DisagreementRecord),
  agreementRatio: z.number().min(0).max(1),
  objectionCount: z.number().int().min(0),
  distinctViewCount: z.number().int().min(1),
  blockingWarning: z.boolean(),
  resolvedCount: z.number().int().min(0).optional(),
  acceptedSplitCount: z.number().int().min(0).optional(),
  unresolvedCount: z.number().int().min(0).optional(),
  parseRecoveryCount: z.number().int().min(0).optional(),
  degradedParseCount: z.number().int().min(0).optional(),
});
export type RoundResult = z.infer<typeof RoundResult>;

export const ArgumentNodeSchema = z.object({
  id: z.string(),
  seatId: z.string(),
  claim: z.string(),
  provenance: ClaimProvenance,
  confidence: z.number(),
  round: z.number().int(),
  resilience: z.number(),
});

export const ArgumentEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(["support", "attack"]),
  strength: z.number(),
});

export const ArgumentDAGSchema = z.object({
  nodes: z.array(ArgumentNodeSchema),
  edges: z.array(ArgumentEdgeSchema),
  criticalPath: z.array(z.string()),
});

export const DeliberationTrace = z.object({
  selectedSeats: z.array(z.string()),
  routingReason: z.string(),
  rounds: z.array(RoundResult),
  stopReason: StopReason,
  modelAssignments: z.record(z.string(), z.string()).optional(),
  totalTokensUsed: z.number().int().optional(),
  totalLatencyMs: z.number().int().optional(),
  totalParseRecoveries: z.number().int().optional(),
  totalDegradedParses: z.number().int().optional(),
  argumentDAG: ArgumentDAGSchema.optional(),
  dagPath: z.string().optional(),
});
export type DeliberationTrace = z.infer<typeof DeliberationTrace>;
