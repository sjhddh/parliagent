import { describe, it, expect } from "vitest";
import {
  detectAntiCollapse,
  checkSafetyBoundaries,
  isHardBlocked,
} from "../src/core/safety.js";
import type { SeatStatement } from "../src/contracts/trace.js";

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

describe("detectAntiCollapse", () => {
  it("returns no warnings for diverse statements", () => {
    const statements: SeatStatement[] = [
      makeStatement({
        seatId: "A",
        stance: "support",
        summary: "This approach is technically sound and well-structured",
        claims: ["Good architecture", "Clean code"],
      }),
      makeStatement({
        seatId: "B",
        stance: "oppose",
        summary: "The security implications are concerning and poorly addressed",
        claims: ["Missing auth boundary", "Data exposure risk"],
      }),
    ];
    const warnings = detectAntiCollapse(statements);
    expect(warnings.length).toBe(0);
  });

  it("warns on identical summaries", () => {
    const statements: SeatStatement[] = [
      makeStatement({
        seatId: "A",
        summary: "This is a perfectly fine approach that works well in practice.",
      }),
      makeStatement({
        seatId: "B",
        summary: "This is a perfectly fine approach that works well in practice.",
      }),
    ];
    const warnings = detectAntiCollapse(statements);
    expect(warnings.some((w) => w.includes("identical summaries"))).toBe(true);
  });

  it("warns on lazy consensus (all agree, high confidence, no objections)", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support", confidence: 5, objections: [] }),
      makeStatement({ seatId: "B", stance: "support", confidence: 4, objections: [] }),
      makeStatement({ seatId: "C", stance: "support", confidence: 5, objections: [] }),
    ];
    const warnings = detectAntiCollapse(statements);
    expect(warnings.some((w) => w.includes("lazy consensus"))).toBe(true);
  });

  it("does not warn when mixed stances exist", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", stance: "support", confidence: 5 }),
      makeStatement({ seatId: "B", stance: "oppose", confidence: 4 }),
      makeStatement({ seatId: "C", stance: "support", confidence: 5 }),
    ];
    const warnings = detectAntiCollapse(statements);
    const lazyWarnings = warnings.filter((w) => w.includes("lazy consensus"));
    expect(lazyWarnings.length).toBe(0);
  });
});

describe("checkSafetyBoundaries", () => {
  it("returns no warnings for normal prompts", () => {
    expect(checkSafetyBoundaries("What is the best sorting algorithm?")).toEqual([]);
  });

  it("warns on medical topics", () => {
    const warnings = checkSafetyBoundaries("What medication should I take for my symptoms?");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("medical");
  });

  it("warns on legal topics", () => {
    const warnings = checkSafetyBoundaries("Can I sue my landlord for this contract dispute?");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("legal");
  });

  it("warns on financial topics", () => {
    const warnings = checkSafetyBoundaries("Should I invest in this stock for my portfolio?");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("financial");
  });
});

describe("isHardBlocked", () => {
  it("does not block normal prompts", () => {
    expect(isHardBlocked("How do I implement auth?")).toBe(false);
  });

  it("blocks prompts with multiple safety-critical keywords", () => {
    expect(isHardBlocked("How to make a weapon and explosive device")).toBe(true);
  });

  it("does not block single-keyword matches", () => {
    expect(isHardBlocked("What is a weapon?")).toBe(false);
  });
});
