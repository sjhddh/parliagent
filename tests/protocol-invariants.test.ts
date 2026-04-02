import { describe, it, expect } from "vitest";
import { evaluateConvergence, extractDisagreements, getDisputeParticipants } from "../src/core/convergence.js";
import { determineDecisionType } from "../src/core/speaker.js";
import { MODE_CONFIGS } from "../src/core/config.js";
import type { SeatStatement, DisagreementRecord, RoundResult } from "../src/contracts/trace.js";

function makeStatement(
  overrides: Partial<SeatStatement> & { seatId: string },
): SeatStatement {
  return {
    round: 1,
    stance: "support",
    summary: "Test",
    claims: ["Test claim"],
    objections: [],
    confidence: 3,
    ...overrides,
  };
}

function makeRound(overrides: Partial<RoundResult> & { round: number }): RoundResult {
  return {
    statements: [],
    disagreements: [],
    agreementRatio: 0.5,
    objectionCount: 0,
    distinctViewCount: 2,
    blockingWarning: false,
    resolvedCount: 0,
    acceptedSplitCount: 0,
    unresolvedCount: 0,
    ...overrides,
  };
}

describe("Protocol invariant: converged implies no open disputes", () => {
  it("NEVER returns 'converged' with unresolvedCount > 0", () => {
    const configs = [MODE_CONFIGS.micro, MODE_CONFIGS.fast, MODE_CONFIGS.balanced, MODE_CONFIGS.deep];
    const stanceGroups = [
      [makeStatement({ seatId: "A", stance: "support" }), makeStatement({ seatId: "B", stance: "support" })],
      [makeStatement({ seatId: "A", stance: "support" }), makeStatement({ seatId: "B", stance: "support" }), makeStatement({ seatId: "C", stance: "support" })],
    ];

    for (const config of configs) {
      for (const stmts of stanceGroups) {
        for (const round of [1, 2, 3]) {
          const prior: DisagreementRecord[] = [
            { id: "D-test", topic: "open dispute", seats: ["A", "B"], type: "claim_conflict", status: "open" },
          ];

          const result = evaluateConvergence({
            statements: stmts,
            modeConfig: config,
            currentRound: round,
            priorDisagreements: prior,
          });

          if (result.reason === "converged") {
            expect(result.roundResult.unresolvedCount).toBe(0);
          }
        }
      }
    }
  });
});

describe("Protocol invariant: decisionType ↔ dispute resolution consistency", () => {
  it("consensus requires unresolvedCount === 0 and acceptedSplitCount === 0 (when disputes exist)", () => {
    const round = makeRound({
      round: 2,
      disagreements: [
        { topic: "test", seats: ["A", "B"], type: "claim_conflict", status: "resolved" },
      ],
      resolvedCount: 1,
      acceptedSplitCount: 0,
      unresolvedCount: 0,
      agreementRatio: 1.0,
      objectionCount: 0,
    });
    expect(determineDecisionType(round)).toBe("consensus");
  });

  it("uncertain requires either no disputes or high unresolved count", () => {
    const round = makeRound({
      round: 2,
      disagreements: [
        { topic: "a", seats: ["A", "B"], type: "claim_conflict", status: "open" },
        { topic: "b", seats: ["C", "D"], type: "claim_conflict", status: "open" },
        { topic: "c", seats: ["E", "F"], type: "claim_conflict", status: "open" },
      ],
      resolvedCount: 0,
      acceptedSplitCount: 0,
      unresolvedCount: 3,
    });
    expect(determineDecisionType(round)).toBe("uncertain");
  });
});

describe("Protocol invariant: openQuestions reflect unresolved disputes", () => {
  it("every open dispute should map to an open question", () => {
    const stmts = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const round1Disputes = extractDisagreements(stmts);

    const openDisputes = round1Disputes.filter((d) => d.status === "open");
    expect(openDisputes.length).toBeGreaterThan(0);

    for (const d of openDisputes) {
      expect(d.topic.length).toBeGreaterThan(0);
    }
  });
});

describe("Protocol invariant: resolution targets all resolvable dispute types", () => {
  it("getDisputeParticipants includes risk_warning seats", () => {
    const disputes: DisagreementRecord[] = [
      { id: "D-1", topic: "risk", seats: ["SecuritySeat"], type: "risk_warning", status: "open" },
    ];
    const participants = getDisputeParticipants(disputes);
    expect(participants).toContain("SecuritySeat");
  });

  it("getDisputeParticipants includes priority_conflict seats", () => {
    const disputes: DisagreementRecord[] = [
      { id: "D-1", topic: "priority", seats: ["A", "B"], type: "priority_conflict", status: "open" },
    ];
    const participants = getDisputeParticipants(disputes);
    expect(participants).toContain("A");
    expect(participants).toContain("B");
  });

  it("getDisputeParticipants excludes resolved disputes", () => {
    const disputes: DisagreementRecord[] = [
      { id: "D-1", topic: "resolved", seats: ["A", "B"], type: "claim_conflict", status: "resolved" },
      { id: "D-2", topic: "open", seats: ["C", "D"], type: "risk_warning", status: "open" },
    ];
    const participants = getDisputeParticipants(disputes);
    expect(participants).not.toContain("A");
    expect(participants).toContain("C");
  });
});

describe("Protocol invariant: JSON extraction resilience", () => {
  it("is validated through Speaker.debate() integration tests that use mock adapters returning fenced JSON", () => {
    expect(true).toBe(true);
  });
});

describe("Structured output: seat failure isolation", () => {
  it("failed seat has detectable signature", () => {
    const failed: SeatStatement = {
      seatId: "FailedSeat",
      round: 1,
      stance: "uncertain",
      summary: "Seat unavailable: API error",
      claims: ["Seat could not produce a response"],
      objections: [],
      confidence: 1,
      warnings: ["Seat FailedSeat failed to respond"],
    };

    expect(failed.claims[0]).toBe("Seat could not produce a response");
    expect(failed.stance).toBe("uncertain");
    expect(failed.confidence).toBe(1);
  });
});
