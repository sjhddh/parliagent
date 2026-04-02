import { describe, it, expect } from "vitest";
import {
  extractDisagreements,
  computeRoundResult,
  evaluateConvergence,
  getDisputeParticipants,
} from "../src/core/convergence.js";
import { buildTraceText } from "../src/core/synthesis.js";
import { MODE_CONFIGS } from "../src/core/config.js";
import type { SeatStatement, DisagreementRecord, RoundResult } from "../src/contracts/trace.js";
import {
  SeatStatement as SeatStatementSchema,
  DisagreementRecord as DisagreementRecordSchema,
  RoundResult as RoundResultSchema,
  AgendaStage,
  ClaimProvenance,
  StopReason,
} from "../src/contracts/trace.js";

function makeStatement(
  overrides: Partial<SeatStatement> & { seatId: string },
): SeatStatement {
  return {
    round: 1,
    stance: "support",
    summary: "Test position",
    claims: ["Test claim"],
    objections: [],
    confidence: 3,
    ...overrides,
  };
}

describe("Agenda stages", () => {
  it("AgendaStage schema accepts valid values", () => {
    expect(AgendaStage.safeParse("opening").success).toBe(true);
    expect(AgendaStage.safeParse("rebuttal").success).toBe(true);
    expect(AgendaStage.safeParse("resolution").success).toBe(true);
    expect(AgendaStage.safeParse("voting").success).toBe(false);
  });

  it("RoundResult accepts stage field", () => {
    const result = RoundResultSchema.safeParse({
      round: 1,
      stage: "opening",
      statements: [],
      disagreements: [],
      agreementRatio: 1.0,
      objectionCount: 0,
      distinctViewCount: 1,
      blockingWarning: false,
      resolvedCount: 0,
      acceptedSplitCount: 0,
      unresolvedCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("computeRoundResult includes stage when provided", () => {
    const stmts = [makeStatement({ seatId: "A" })];
    const result = computeRoundResult(1, stmts, undefined, "opening");
    expect(result.stage).toBe("opening");
  });

  it("computeRoundResult omits stage when not provided", () => {
    const stmts = [makeStatement({ seatId: "A" })];
    const result = computeRoundResult(1, stmts);
    expect(result.stage).toBeUndefined();
  });
});

describe("Dispute lifecycle — extractDisagreements with prior context", () => {
  it("assigns IDs to new disagreements", () => {
    const stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const disagreements = extractDisagreements(stmts);
    expect(disagreements.length).toBeGreaterThan(0);
    expect(disagreements[0].id).toBeDefined();
    expect(disagreements[0].status).toBe("open");
  });

  it("resolves disputes when previously opposing seats agree", () => {
    const round1Stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const round1Disputes = extractDisagreements(round1Stmts);
    expect(round1Disputes.some((d) => d.status === "open")).toBe(true);

    const round2Stmts = [
      makeStatement({ seatId: "A", stance: "support", round: 2 }),
      makeStatement({ seatId: "B", stance: "support", round: 2 }),
    ];
    const round2Disputes = extractDisagreements(round2Stmts, round1Disputes);
    const claimConflicts = round2Disputes.filter((d) => d.type === "claim_conflict");
    expect(claimConflicts.some((d) => d.status === "resolved")).toBe(true);
  });

  it("marks disputes as accepted_split when both move to mixed", () => {
    const round1Stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const round1Disputes = extractDisagreements(round1Stmts);

    const round2Stmts = [
      makeStatement({ seatId: "A", stance: "mixed", round: 2 }),
      makeStatement({ seatId: "B", stance: "mixed", round: 2 }),
    ];
    const round2Disputes = extractDisagreements(round2Stmts, round1Disputes);
    expect(round2Disputes.some((d) => d.status === "accepted_split")).toBe(true);
  });

  it("keeps disputes open when opposition continues", () => {
    const round1Stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const round1Disputes = extractDisagreements(round1Stmts);

    const round2Stmts = [
      makeStatement({ seatId: "A", stance: "support", round: 2 }),
      makeStatement({ seatId: "B", stance: "oppose", round: 2 }),
    ];
    const round2Disputes = extractDisagreements(round2Stmts, round1Disputes);
    const conflicts = round2Disputes.filter((d) => d.type === "claim_conflict");
    expect(conflicts.some((d) => d.status === "open")).toBe(true);
  });

  it("resolves risk_warning when seat drops warnings", () => {
    const round1Stmts = [
      makeStatement({ seatId: "A", warnings: ["Security risk"] }),
      makeStatement({ seatId: "B" }),
    ];
    const round1Disputes = extractDisagreements(round1Stmts);
    expect(round1Disputes.some((d) => d.type === "risk_warning" && d.status === "open")).toBe(true);

    const round2Stmts = [
      makeStatement({ seatId: "A", round: 2 }),
      makeStatement({ seatId: "B", round: 2 }),
    ];
    const round2Disputes = extractDisagreements(round2Stmts, round1Disputes);
    expect(round2Disputes.some((d) => d.type === "risk_warning" && d.status === "resolved")).toBe(true);
  });

  it("preserves already-resolved disputes across rounds", () => {
    const resolved: DisagreementRecord = {
      id: "D-99",
      topic: "Old resolved dispute",
      seats: ["A", "B"],
      type: "claim_conflict",
      status: "resolved",
    };
    const stmts = [makeStatement({ seatId: "A" }), makeStatement({ seatId: "B" })];
    const result = extractDisagreements(stmts, [resolved]);
    expect(result.some((d) => d.id === "D-99" && d.status === "resolved")).toBe(true);
  });
});

describe("Resolution metrics in RoundResult", () => {
  it("computes resolution metrics from disagreement statuses", () => {
    const round1Stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
      makeStatement({ seatId: "C", stance: "support", warnings: ["risk"] }),
    ];
    const round1Disputes = extractDisagreements(round1Stmts);

    const round2Stmts = [
      makeStatement({ seatId: "A", stance: "support", round: 2 }),
      makeStatement({ seatId: "B", stance: "support", round: 2 }),
      makeStatement({ seatId: "C", stance: "support", round: 2 }),
    ];
    const result = computeRoundResult(2, round2Stmts, round1Disputes, "resolution");

    expect(result.resolvedCount).toBeDefined();
    expect(result.acceptedSplitCount).toBeDefined();
    expect(result.unresolvedCount).toBeDefined();
    expect(result.resolvedCount!).toBeGreaterThan(0);
    expect(result.stage).toBe("resolution");
  });

  it("RoundResult schema validates resolution metrics", () => {
    const result = RoundResultSchema.safeParse({
      round: 2,
      stage: "resolution",
      statements: [],
      disagreements: [],
      agreementRatio: 0.8,
      objectionCount: 0,
      distinctViewCount: 1,
      blockingWarning: false,
      resolvedCount: 3,
      acceptedSplitCount: 1,
      unresolvedCount: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe("Issue-level convergence", () => {
  it("stops with issues_resolved when all disputes are closed", () => {
    const resolvedDispute: DisagreementRecord = {
      id: "D-1",
      topic: "Test dispute",
      seats: ["A", "B"],
      type: "claim_conflict",
      status: "open",
    };

    const stmts = [
      makeStatement({ seatId: "A", stance: "support", round: 2 }),
      makeStatement({ seatId: "B", stance: "support", round: 2 }),
    ];

    const result = evaluateConvergence({
      statements: stmts,
      modeConfig: MODE_CONFIGS.fast,
      currentRound: 2,
      priorDisagreements: [resolvedDispute],
      stage: "resolution",
    });

    expect(result.roundResult.resolvedCount).toBeGreaterThan(0);
    expect(result.roundResult.unresolvedCount).toBe(0);
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe("issues_resolved");
  });

  it("continues when unresolved disputes remain", () => {
    const stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
      makeStatement({ seatId: "C", stance: "mixed" }),
    ];

    const result = evaluateConvergence({
      statements: stmts,
      modeConfig: MODE_CONFIGS.balanced,
      currentRound: 1,
    });

    expect(result.roundResult.unresolvedCount).toBeGreaterThan(0);
    expect(result.shouldStop).toBe(false);
  });
});

describe("Targeted dispute exchange — getDisputeParticipants", () => {
  it("returns seats from top open resolvable disputes", () => {
    const disputes: DisagreementRecord[] = [
      { id: "D-1", topic: "Dispute 1", seats: ["A", "B"], type: "claim_conflict", status: "open" },
      { id: "D-2", topic: "Dispute 2", seats: ["C", "D"], type: "claim_conflict", status: "open" },
      { id: "D-3", topic: "Warning", seats: ["E"], type: "risk_warning", status: "open" },
      { id: "D-4", topic: "Resolved", seats: ["F", "G"], type: "claim_conflict", status: "resolved" },
      { id: "D-5", topic: "Uncertain", seats: ["H"], type: "uncertainty", status: "open" },
    ];

    const participants = getDisputeParticipants(disputes, 3);
    expect(participants).toContain("A");
    expect(participants).toContain("B");
    expect(participants).toContain("C");
    expect(participants).toContain("D");
    expect(participants).toContain("E");
    expect(participants).not.toContain("F");
    expect(participants).not.toContain("H");
  });

  it("returns empty when no open resolvable disputes", () => {
    const disputes: DisagreementRecord[] = [
      { topic: "Uncertain", seats: ["A"], type: "uncertainty", status: "open" },
      { topic: "Resolved", seats: ["B", "C"], type: "claim_conflict", status: "resolved" },
    ];
    expect(getDisputeParticipants(disputes)).toEqual([]);
  });
});

describe("Dispute-driven decisionType", () => {
  it("consensus when all disputes resolved with no splits", () => {
    const round: RoundResult = {
      round: 2,
      statements: [
        makeStatement({ seatId: "A", stance: "support" }),
        makeStatement({ seatId: "B", stance: "support" }),
      ],
      disagreements: [
        { id: "D-1", topic: "test", seats: ["A", "B"], type: "claim_conflict", status: "resolved" },
      ],
      agreementRatio: 1.0,
      objectionCount: 0,
      distinctViewCount: 1,
      blockingWarning: false,
      resolvedCount: 1,
      acceptedSplitCount: 0,
      unresolvedCount: 0,
    };

    const convergence = evaluateConvergence({
      statements: round.statements,
      modeConfig: MODE_CONFIGS.fast,
      currentRound: 2,
      priorDisagreements: [{ id: "D-1", topic: "test", seats: ["A", "B"], type: "claim_conflict", status: "open" }],
    });

    expect(convergence.shouldStop).toBe(true);
    expect(convergence.reason).toBe("issues_resolved");
  });
});

describe("Claim provenance (Track 2: Evidence grounding)", () => {
  it("ClaimProvenance schema validates all types", () => {
    expect(ClaimProvenance.safeParse("supported").success).toBe(true);
    expect(ClaimProvenance.safeParse("inferred").success).toBe(true);
    expect(ClaimProvenance.safeParse("speculative").success).toBe(true);
    expect(ClaimProvenance.safeParse("missing_evidence").success).toBe(true);
    expect(ClaimProvenance.safeParse("proven").success).toBe(false);
  });

  it("SeatStatement accepts claimProvenance array", () => {
    const result = SeatStatementSchema.safeParse({
      seatId: "TestSeat",
      round: 1,
      stance: "support",
      summary: "Test",
      claims: ["Claim A", "Claim B"],
      claimProvenance: ["supported", "speculative"],
      objections: [],
      confidence: 4,
    });
    expect(result.success).toBe(true);
  });

  it("SeatStatement is valid without claimProvenance", () => {
    const result = SeatStatementSchema.safeParse({
      seatId: "TestSeat",
      round: 1,
      stance: "support",
      summary: "Test",
      claims: ["Claim A"],
      objections: [],
      confidence: 3,
    });
    expect(result.success).toBe(true);
  });
});

describe("Enhanced trace output", () => {
  it("buildTraceText includes stage labels", () => {
    const rounds: RoundResult[] = [
      {
        round: 1,
        stage: "opening",
        statements: [makeStatement({ seatId: "A" })],
        disagreements: [],
        agreementRatio: 1.0,
        objectionCount: 0,
        distinctViewCount: 1,
        blockingWarning: false,
        resolvedCount: 0,
        acceptedSplitCount: 0,
        unresolvedCount: 0,
      },
    ];
    const text = buildTraceText(rounds);
    expect(text).toContain("[opening]");
  });

  it("buildTraceText includes resolution metrics", () => {
    const rounds: RoundResult[] = [
      {
        round: 2,
        stage: "resolution",
        statements: [makeStatement({ seatId: "A", round: 2 })],
        disagreements: [],
        agreementRatio: 0.8,
        objectionCount: 0,
        distinctViewCount: 1,
        blockingWarning: false,
        resolvedCount: 2,
        acceptedSplitCount: 1,
        unresolvedCount: 0,
      },
    ];
    const text = buildTraceText(rounds);
    expect(text).toContain("2 resolved");
    expect(text).toContain("1 accepted splits");
    expect(text).toContain("0 open");
  });

  it("buildTraceText includes claim provenance", () => {
    const rounds: RoundResult[] = [
      {
        round: 1,
        statements: [
          {
            seatId: "A",
            round: 1,
            stance: "support",
            summary: "Test",
            claims: ["Verified fact", "Hypothesis"],
            claimProvenance: ["supported", "speculative"],
            objections: [],
            confidence: 4,
          },
        ],
        disagreements: [],
        agreementRatio: 1.0,
        objectionCount: 0,
        distinctViewCount: 1,
        blockingWarning: false,
      },
    ];
    const text = buildTraceText(rounds);
    expect(text).toContain("[supported]");
    expect(text).toContain("[speculative]");
  });
});

describe("DisagreementRecord schema with id", () => {
  it("accepts record with id", () => {
    const result = DisagreementRecordSchema.safeParse({
      id: "D-1",
      topic: "Test dispute",
      seats: ["A", "B"],
      type: "claim_conflict",
      status: "open",
    });
    expect(result.success).toBe(true);
  });

  it("accepts record without id (backward compat)", () => {
    const result = DisagreementRecordSchema.safeParse({
      topic: "Test dispute",
      seats: ["A"],
      type: "risk_warning",
      status: "open",
    });
    expect(result.success).toBe(true);
  });
});

describe("StopReason includes issues_resolved", () => {
  it("issues_resolved is valid StopReason", () => {
    expect(StopReason.safeParse("issues_resolved").success).toBe(true);
  });
});
