import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createBudget,
  addTokens,
  advanceRound,
  checkBudget,
} from "../src/core/budget.js";

describe("budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 2, 0, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates budget with correct defaults", () => {
    const budget = createBudget({
      maxTokens: 6000,
      maxLatencyMs: 8000,
      maxRounds: 1,
    });
    expect(budget.tokensUsed).toBe(0);
    expect(budget.roundsCompleted).toBe(0);
    expect(budget.maxTokens).toBe(6000);
  });

  it("tracks token usage", () => {
    let budget = createBudget({
      maxTokens: 1000,
      maxLatencyMs: 30000,
      maxRounds: 3,
    });
    budget = addTokens(budget, 500);
    expect(budget.tokensUsed).toBe(500);
    budget = addTokens(budget, 300);
    expect(budget.tokensUsed).toBe(800);
  });

  it("tracks round advancement", () => {
    let budget = createBudget({
      maxTokens: 10000,
      maxLatencyMs: 30000,
      maxRounds: 2,
    });
    budget = advanceRound(budget);
    expect(budget.roundsCompleted).toBe(1);
    budget = advanceRound(budget);
    expect(budget.roundsCompleted).toBe(2);
  });

  it("detects token budget exceeded", () => {
    let budget = createBudget({
      maxTokens: 1000,
      maxLatencyMs: 30000,
      maxRounds: 3,
    });
    budget = addTokens(budget, 1000);
    const check = checkBudget(budget);
    expect(check.exceeded).toBe(true);
    expect(check.reason).toBe("budget");
  });

  it("detects latency exceeded", () => {
    let budget = createBudget({
      maxTokens: 10000,
      maxLatencyMs: 5000,
      maxRounds: 3,
    });
    vi.advanceTimersByTime(6000);
    const check = checkBudget(budget);
    expect(check.exceeded).toBe(true);
    expect(check.reason).toBe("latency");
  });

  it("detects round limit exceeded", () => {
    let budget = createBudget({
      maxTokens: 10000,
      maxLatencyMs: 30000,
      maxRounds: 2,
    });
    budget = advanceRound(budget);
    budget = advanceRound(budget);
    const check = checkBudget(budget);
    expect(check.exceeded).toBe(true);
    expect(check.reason).toBe("round_limit");
  });

  it("reports not exceeded when within limits", () => {
    const budget = createBudget({
      maxTokens: 10000,
      maxLatencyMs: 30000,
      maxRounds: 3,
    });
    const check = checkBudget(budget);
    expect(check.exceeded).toBe(false);
    expect(check.reason).toBeNull();
  });
});
