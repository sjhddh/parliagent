import { describe, it, expect } from "vitest";
import {
  extractDisagreements,
  computeRoundResult,
  evaluateConvergence,
} from "../src/core/convergence.js";
import type { SeatStatement } from "../src/contracts/trace.js";
import { MODE_CONFIGS } from "../src/core/config.js";

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

describe("extractDisagreements", () => {
  it("detects opposing stances", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const disagreements = extractDisagreements(statements);
    expect(disagreements.length).toBeGreaterThan(0);
    expect(disagreements[0].type).toBe("claim_conflict");
  });

  it("detects objections", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", objections: ["This is risky"] }),
      makeStatement({ seatId: "B" }),
    ];
    const disagreements = extractDisagreements(statements);
    expect(disagreements.some((d) => d.topic.includes("risky"))).toBe(true);
  });

  it("detects warnings as risk_warning", () => {
    const statements: SeatStatement[] = [
      makeStatement({
        seatId: "SecurityPrivacySeat",
        warnings: ["Security vulnerability"],
      }),
      makeStatement({ seatId: "B" }),
    ];
    const disagreements = extractDisagreements(statements);
    expect(disagreements.some((d) => d.type === "risk_warning")).toBe(true);
  });

  it("returns empty for full agreement", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "support" }),
    ];
    const disagreements = extractDisagreements(statements);
    const conflicts = disagreements.filter((d) => d.type === "claim_conflict");
    expect(conflicts.length).toBe(0);
  });
});

describe("computeRoundResult", () => {
  it("computes agreement ratio correctly", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "support" }),
      makeStatement({ seatId: "C", stance: "oppose" }),
    ];
    const result = computeRoundResult(1, statements);
    expect(result.agreementRatio).toBeCloseTo(0.67, 1);
  });

  it("counts objections", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", objections: ["obj1"] }),
      makeStatement({ seatId: "B", objections: ["obj2", "obj3"] }),
    ];
    const result = computeRoundResult(1, statements);
    expect(result.objectionCount).toBe(3);
  });

  it("detects blocking warnings", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", warnings: ["critical issue"] }),
      makeStatement({ seatId: "B" }),
    ];
    const result = computeRoundResult(1, statements);
    expect(result.blockingWarning).toBe(true);
  });

  it("no blocking warning when clean", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A" }),
      makeStatement({ seatId: "B" }),
    ];
    const result = computeRoundResult(1, statements);
    expect(result.blockingWarning).toBe(false);
  });
});

describe("evaluateConvergence", () => {
  it("converges on high agreement with low objections", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "support" }),
      makeStatement({ seatId: "C", stance: "support" }),
    ];
    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.micro,
      currentRound: 1,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe("converged");
  });

  it("continues on low agreement", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
      makeStatement({ seatId: "C", stance: "mixed" }),
    ];
    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.balanced,
      currentRound: 1,
    });
    expect(result.shouldStop).toBe(false);
  });

  it("stops on round limit", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support" }),
      makeStatement({ seatId: "B", stance: "oppose" }),
    ];
    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.micro,
      currentRound: 1,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe("round_limit");
  });

  it("stops on blocking warning with low agreement", () => {
    const statements: SeatStatement[] = [
      makeStatement({
        seatId: "A",
        stance: "oppose",
        warnings: ["critical security vulnerability"],
      }),
      makeStatement({ seatId: "B", stance: "oppose" }),
      makeStatement({ seatId: "C", stance: "mixed" }),
      makeStatement({ seatId: "D", stance: "support" }),
      makeStatement({ seatId: "E", stance: "uncertain" }),
    ];
    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.deep,
      currentRound: 1,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe("blocking_warning");
  });

  it("converges when only one distinct view remains", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "mixed" }),
      makeStatement({ seatId: "B", stance: "mixed" }),
    ];
    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.balanced,
      currentRound: 1,
    });
    expect(result.shouldStop).toBe(true);
    expect(result.reason).toBe("converged");
  });
});
