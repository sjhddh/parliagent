import type { StopReason } from "../contracts/trace.js";

export interface BudgetState {
  tokensUsed: number;
  maxTokens: number;
  startTime: number;
  maxLatencyMs: number;
  roundsCompleted: number;
  maxRounds: number;
}

export interface BudgetCheck {
  exceeded: boolean;
  reason: StopReason | null;
  tokensUsed: number;
  elapsedMs: number;
}

export function createBudget(config: {
  maxTokens: number;
  maxLatencyMs: number;
  maxRounds: number;
}): BudgetState {
  return {
    tokensUsed: 0,
    maxTokens: config.maxTokens,
    startTime: Date.now(),
    maxLatencyMs: config.maxLatencyMs,
    roundsCompleted: 0,
    maxRounds: config.maxRounds,
  };
}

export function addTokens(state: BudgetState, tokens: number): BudgetState {
  return { ...state, tokensUsed: state.tokensUsed + tokens };
}

export function advanceRound(state: BudgetState): BudgetState {
  return { ...state, roundsCompleted: state.roundsCompleted + 1 };
}

export function checkBudget(state: BudgetState): BudgetCheck {
  const elapsedMs = Date.now() - state.startTime;

  if (state.tokensUsed >= state.maxTokens) {
    return {
      exceeded: true,
      reason: "budget",
      tokensUsed: state.tokensUsed,
      elapsedMs,
    };
  }

  if (elapsedMs >= state.maxLatencyMs) {
    return {
      exceeded: true,
      reason: "latency",
      tokensUsed: state.tokensUsed,
      elapsedMs,
    };
  }

  if (state.roundsCompleted >= state.maxRounds) {
    return {
      exceeded: true,
      reason: "round_limit",
      tokensUsed: state.tokensUsed,
      elapsedMs,
    };
  }

  return {
    exceeded: false,
    reason: null,
    tokensUsed: state.tokensUsed,
    elapsedMs,
  };
}
