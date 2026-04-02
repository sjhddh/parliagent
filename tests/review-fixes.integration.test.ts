import { describe, it, expect, vi } from "vitest";
import { Speaker, determineDecisionType } from "../src/core/speaker.js";
import { SeatRegistry } from "../src/seats/registry.js";
import { evaluateConvergence } from "../src/core/convergence.js";
import { MODE_CONFIGS } from "../src/core/config.js";
import { evaluateResponse, EVALUATION_FIXTURES } from "../src/evaluation/rubric.js";
import type { ParliagentResponse } from "../src/contracts/response.js";
import type { RoundResult, SeatStatement, DisagreementRecord } from "../src/contracts/trace.js";
import type { ModelAdapter, ChatMessage, CompletionResult } from "../src/runtime/adapter.js";

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

// --- T3-7: Unit tests for determineDecisionType ---

describe("determineDecisionType — dispute-driven logic", () => {
  it("returns uncertain for undefined round", () => {
    expect(determineDecisionType(undefined)).toBe("uncertain");
  });

  it("consensus when all disputes resolved, no splits", () => {
    const round = makeRound({
      round: 2,
      disagreements: [
        { id: "D-1", topic: "test", seats: ["A", "B"], type: "claim_conflict", status: "resolved" },
      ],
      resolvedCount: 1,
      acceptedSplitCount: 0,
      unresolvedCount: 0,
    });
    expect(determineDecisionType(round)).toBe("consensus");
  });

  it("majority when all closed but some accepted_split", () => {
    const round = makeRound({
      round: 2,
      disagreements: [
        { id: "D-1", topic: "a", seats: ["A", "B"], type: "claim_conflict", status: "resolved" },
        { id: "D-2", topic: "b", seats: ["C", "D"], type: "claim_conflict", status: "accepted_split" },
      ],
      resolvedCount: 1,
      acceptedSplitCount: 1,
      unresolvedCount: 0,
    });
    expect(determineDecisionType(round)).toBe("majority");
  });

  it("split when resolved + splits outnumber unresolved", () => {
    const round = makeRound({
      round: 2,
      disagreements: [
        { id: "D-1", topic: "a", seats: ["A", "B"], type: "claim_conflict", status: "resolved" },
        { id: "D-2", topic: "b", seats: ["C", "D"], type: "claim_conflict", status: "accepted_split" },
        { id: "D-3", topic: "c", seats: ["E", "F"], type: "claim_conflict", status: "open" },
      ],
      resolvedCount: 1,
      acceptedSplitCount: 1,
      unresolvedCount: 1,
    });
    expect(determineDecisionType(round)).toBe("split");
  });

  it("uncertain when unresolved dominates", () => {
    const round = makeRound({
      round: 2,
      disagreements: [
        { id: "D-1", topic: "a", seats: ["A", "B"], type: "claim_conflict", status: "open" },
        { id: "D-2", topic: "b", seats: ["C", "D"], type: "claim_conflict", status: "open" },
        { id: "D-3", topic: "c", seats: ["E", "F"], type: "claim_conflict", status: "open" },
      ],
      resolvedCount: 0,
      acceptedSplitCount: 0,
      unresolvedCount: 3,
    });
    expect(determineDecisionType(round)).toBe("uncertain");
  });

  it("falls back to stance metrics when no disputes", () => {
    const round = makeRound({
      round: 1,
      disagreements: [],
      agreementRatio: 0.9,
      objectionCount: 0,
      resolvedCount: 0,
      acceptedSplitCount: 0,
      unresolvedCount: 0,
    });
    expect(determineDecisionType(round)).toBe("consensus");
  });

  it("falls back to majority on moderate agreement", () => {
    const round = makeRound({
      round: 1,
      disagreements: [],
      agreementRatio: 0.65,
      objectionCount: 2,
    });
    expect(determineDecisionType(round)).toBe("majority");
  });

  it("falls back to uncertain on many distinct views", () => {
    const round = makeRound({
      round: 1,
      disagreements: [],
      agreementRatio: 0.4,
      distinctViewCount: 4,
    });
    expect(determineDecisionType(round)).toBe("uncertain");
  });

  it("falls back to split when moderate disagreement", () => {
    const round = makeRound({
      round: 1,
      disagreements: [],
      agreementRatio: 0.5,
      distinctViewCount: 2,
    });
    expect(determineDecisionType(round)).toBe("split");
  });
});

// --- T1-4: Integration test for Speaker.debate() with protocol features ---

describe("Speaker.debate() integration — protocol features", () => {
  function createMultiRoundMockAdapter(): ModelAdapter {
    let callOrder = 0;
    return {
      providerId: "mock",
      isAvailable: () => true,
      complete: async (messages: ChatMessage[]): Promise<CompletionResult> => {
        callOrder++;
        const sys = messages.find((m) => m.role === "system")?.content ?? "";
        const usr = messages.find((m) => m.role === "user")?.content ?? "";
        const isSynthesis = sys.includes("synthesizing") || sys.includes("Speaker") || sys.includes("Produce a clear");
        const isResolution = sys.includes("dispute resolution round");

        if (isSynthesis) {
          return {
            content: "Synthesis: After 2 rounds of debate with dispute resolution, the parliament converged.",
            tokensUsed: { prompt: 100, completion: 200, total: 300 },
            model: "mock-model",
            latencyMs: 20,
          };
        }

        const isSecurity = sys.includes("Security") || sys.includes("adversar") || sys.includes("security");
        const isDijkstra = sys.includes("Dijkstra") || sys.includes("correctness");

        if (isResolution) {
          return {
            content: JSON.stringify({
              stance: "mixed",
              summary: "After reviewing the dispute, I accept there are valid points on both sides.",
              claims: ["Both approaches have merit in different contexts"],
              claimProvenance: ["inferred"],
              objections: [],
              confidence: 3,
            }),
            tokensUsed: { prompt: 100, completion: 200, total: 300 },
            model: "mock-model",
            latencyMs: 20,
          };
        }

        if (isSecurity) {
          return {
            content: JSON.stringify({
              stance: "oppose",
              summary: "This approach has significant security risks.",
              claims: ["API keys could be exposed", "No rate limiting"],
              claimProvenance: ["supported", "inferred"],
              objections: ["The architecture lacks auth boundaries"],
              confidence: 5,
              warnings: ["Security vulnerability: no credential management"],
            }),
            tokensUsed: { prompt: 100, completion: 200, total: 300 },
            model: "mock-model",
            latencyMs: 20,
          };
        }

        if (isDijkstra) {
          return {
            content: JSON.stringify({
              stance: "support",
              summary: "The design is structurally correct.",
              claims: ["Well-defined invariants", "Edge cases handled"],
              claimProvenance: ["supported", "inferred"],
              objections: ["Could improve test coverage"],
              confidence: 4,
            }),
            tokensUsed: { prompt: 100, completion: 200, total: 300 },
            model: "mock-model",
            latencyMs: 20,
          };
        }

        return {
          content: JSON.stringify({
            stance: "support",
            summary: "The approach is sound and well-structured.",
            claims: ["Clean separation of concerns"],
            claimProvenance: ["inferred"],
            objections: [],
            confidence: 4,
          }),
          tokensUsed: { prompt: 100, completion: 200, total: 300 },
          model: "mock-model",
          latencyMs: 20,
        };
      },
    };
  }

  function createMockPolicy(adapter: ModelAdapter) {
    return {
      isReady: () => true,
      primaryAdapter: adapter,
      availableProviders: ["mock"],
      getSynthesisAdapter: () => adapter,
      assignModel: (seat: any) => ({ seatId: seat.id, adapter }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) map.set(s.id, { seatId: s.id, adapter });
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) result[s.id] = "mock";
        return result;
      },
    };
  }

  it("produces agenda stages in trace output", async () => {
    const adapter = createMultiRoundMockAdapter();
    const registry = new SeatRegistry();
    const speaker = Speaker.withPolicy(createMockPolicy(adapter) as any, registry);

    const response = await speaker.debate({
      prompt: "How should we handle API key rotation and credential management?",
      mode: "fast" as const,
      taskType: "coding" as const,
      trace: "full" as const,
    });

    expect(response.traceArtifact).toBeDefined();
    const rounds = response.traceArtifact!.rounds;
    expect(rounds.length).toBeGreaterThanOrEqual(1);
    expect(rounds[0].stage).toBe("opening");
  });

  it("produces resolution metrics in round results", async () => {
    const adapter = createMultiRoundMockAdapter();
    const registry = new SeatRegistry();
    const speaker = Speaker.withPolicy(createMockPolicy(adapter) as any, registry);

    const response = await speaker.debate({
      prompt: "How should we handle API key rotation and credential management?",
      mode: "fast" as const,
      taskType: "coding" as const,
      trace: "full" as const,
    });

    const lastRound = response.traceArtifact!.rounds[response.traceArtifact!.rounds.length - 1];
    expect(lastRound.resolvedCount).toBeDefined();
    expect(lastRound.acceptedSplitCount).toBeDefined();
    expect(lastRound.unresolvedCount).toBeDefined();
    expect(typeof lastRound.resolvedCount).toBe("number");
  });

  it("debate summary includes stage labels", async () => {
    const adapter = createMultiRoundMockAdapter();
    const registry = new SeatRegistry();
    const speaker = Speaker.withPolicy(createMockPolicy(adapter) as any, registry);

    const response = await speaker.debate({
      prompt: "How should we handle API key rotation?",
      mode: "fast" as const,
      taskType: "coding" as const,
      trace: "summary" as const,
    });

    expect(response.debateSummary).toBeDefined();
    expect(response.debateSummary).toContain("[opening]");
  });

  it("produces valid decisionType from dispute state", async () => {
    const adapter = createMultiRoundMockAdapter();
    const registry = new SeatRegistry();
    const speaker = Speaker.withPolicy(createMockPolicy(adapter) as any, registry);

    const response = await speaker.debate({
      prompt: "Should we refactor the database layer?",
      mode: "micro" as const,
      trace: "full" as const,
    });

    expect(["consensus", "majority", "split", "uncertain"]).toContain(response.decisionType);
  });

  it("produces claimProvenance in seat statements when model provides it", async () => {
    const adapter = createMultiRoundMockAdapter();
    const registry = new SeatRegistry();
    const speaker = Speaker.withPolicy(createMockPolicy(adapter) as any, registry);

    const response = await speaker.debate({
      prompt: "How should we handle API key rotation?",
      mode: "fast" as const,
      taskType: "coding" as const,
      trace: "full" as const,
    });

    const firstRound = response.traceArtifact!.rounds[0];
    const statementsWithProvenance = firstRound.statements.filter(
      (s) => s.claimProvenance && s.claimProvenance.length > 0,
    );
    expect(statementsWithProvenance.length).toBeGreaterThan(0);
  });
});

// --- T4-3: Calibration dimension with traceArtifact data ---

describe("Evaluation calibration with trace data", () => {
  it("scores higher when trace has dispute lifecycle activity", () => {
    const fixture = EVALUATION_FIXTURES.find((f) => f.id === "arch-tradeoff")!;

    const responseWithTrace: ParliagentResponse = {
      finalAnswer: "Use a modular monolith. Consider team size and complexity tradeoffs at scale.",
      decisionType: "majority",
      activatedSeats: ["Speaker", "DijkstraSeat", "OperatorSeat"],
      whyTheseSeats: "Architecture decision",
      minorityReport: "OperatorSeat: microservices too complex",
      openQuestions: ["What is expected scale?"],
      warnings: ["Complexity risk"],
      debateSummary: "Round 1: debate. Round 2: resolution.",
      traceArtifact: {
        selectedSeats: ["Speaker", "DijkstraSeat", "OperatorSeat"],
        routingReason: "Architecture",
        rounds: [
          makeRound({
            round: 1,
            stage: "opening",
            resolvedCount: 0,
            acceptedSplitCount: 0,
            unresolvedCount: 2,
          }),
          makeRound({
            round: 2,
            stage: "resolution",
            resolvedCount: 1,
            acceptedSplitCount: 1,
            unresolvedCount: 0,
          }),
        ],
        stopReason: "issues_resolved",
      },
    };

    const responseWithoutTrace: ParliagentResponse = {
      finalAnswer: "Use a modular monolith. Consider team size and complexity tradeoffs at scale.",
      decisionType: "majority",
      activatedSeats: ["Speaker", "DijkstraSeat", "OperatorSeat"],
      whyTheseSeats: "Architecture decision",
      minorityReport: "OperatorSeat: microservices too complex",
      openQuestions: ["What is expected scale?"],
      warnings: ["Complexity risk"],
      debateSummary: "Round 1: debate.",
    };

    const withTraceResult = evaluateResponse(fixture, responseWithTrace);
    const withoutTraceResult = evaluateResponse(fixture, responseWithoutTrace);

    const calibWith = withTraceResult.dimensions.find((d) => d.name === "calibration")!;
    const calibWithout = withoutTraceResult.dimensions.find((d) => d.name === "calibration")!;

    expect(calibWith.score).toBeGreaterThanOrEqual(calibWithout.score);
    expect(calibWith.notes).toContain("resolved");
  });
});

// --- T4-5: Exercise remaining evaluation fixtures ---

describe("Evaluation fixtures — full coverage", () => {
  function makeFixtureResponse(fixtureId: string): ParliagentResponse {
    const base: ParliagentResponse = {
      finalAnswer: "",
      decisionType: "majority",
      activatedSeats: ["Speaker", "DijkstraSeat", "KahnemanSeat"],
      whyTheseSeats: "Selected for domain coverage",
      debateSummary: "Round 1: Multiple perspectives discussed.",
    };

    switch (fixtureId) {
      case "strategic-pivot":
        return {
          ...base,
          finalAnswer: "Focus on enterprise — the market dynamics and competition pressure from the $50M raise suggest resource constraints in SMB. Pivot to enterprise for higher ACV.",
          minorityReport: "KahnemanSeat: SMB still has untapped potential, beware sunk cost bias",
          openQuestions: ["What is our current CAC for SMB vs enterprise?"],
          warnings: ["Market timing risk: enterprise sales cycles are 6-12 months"],
        };
      case "calibration-uncertain":
        return {
          ...base,
          finalAnswer: "Current evidence suggests quantum computing will NOT make encryption obsolete within 5 years. This is speculative — timeline estimates vary widely and needs verification against latest research.",
          decisionType: "uncertain",
          minorityReport: "Some seats argued that hybrid quantum/classical attacks could arrive sooner",
          openQuestions: ["What is the latest status of error correction in quantum hardware?"],
        };
      case "ethics-ai-hiring":
        return {
          ...base,
          finalAnswer: "Proceed with extreme caution. Step 1: Audit the training data for historical bias. Step 2: Run blind comparisons. Step 3: Implement human oversight.",
          warnings: ["Bias risk: historical hiring data likely reflects systemic discrimination", "Fairness concern: protected classes may be disproportionately affected"],
          minorityReport: "EthicsHumanImpactSeat: This should not proceed without regulatory review",
          openQuestions: ["Has the training data been audited for protected-class proxy variables?"],
        };
      case "plan-migration":
        return {
          ...base,
          finalAnswer: "Step 1: Identify bounded contexts. Step 2: Extract the auth service first. Step 3: Set up API gateway. Risk: managing distributed transactions during migration adds complexity.",
          warnings: ["Complexity risk: distributed transactions during partial migration"],
          minorityReport: "OperatorSeat: 6 months is aggressive for a small team",
          openQuestions: ["How many services are in the current monolith?"],
        };
      case "low-stakes-writing":
        return {
          ...base,
          finalAnswer: "Here is a README for the calculator library with installation, usage, and API documentation sections.",
          decisionType: "consensus",
          minorityReport: undefined,
          warnings: undefined,
        };
      default:
        return base;
    }
  }

  const remainingFixtures = ["strategic-pivot", "calibration-uncertain", "ethics-ai-hiring", "plan-migration", "low-stakes-writing"];

  for (const fixtureId of remainingFixtures) {
    it(`evaluates fixture: ${fixtureId}`, () => {
      const fixture = EVALUATION_FIXTURES.find((f) => f.id === fixtureId)!;
      expect(fixture).toBeDefined();

      const response = makeFixtureResponse(fixtureId);
      const result = evaluateResponse(fixture, response);

      expect(result.dimensions.length).toBe(5);
      expect(result.percentScore).toBeGreaterThanOrEqual(0);
      expect(result.percentScore).toBeLessThanOrEqual(100);
      expect(result.summary).toContain("Score:");
      expect(result.parliamentBeatBaseline).toBeNull();
    });
  }

  it("calibration fixture checks evidence language", () => {
    const fixture = EVALUATION_FIXTURES.find((f) => f.id === "calibration-uncertain")!;
    const response = makeFixtureResponse("calibration-uncertain");
    const result = evaluateResponse(fixture, response);

    const calibration = result.dimensions.find((d) => d.name === "calibration")!;
    expect(calibration.notes).toContain("evidence");
  });

  it("ethics fixture detects expected risk topics", () => {
    const fixture = EVALUATION_FIXTURES.find((f) => f.id === "ethics-ai-hiring")!;
    const response = makeFixtureResponse("ethics-ai-hiring");
    const result = evaluateResponse(fixture, response);

    const riskRecall = result.dimensions.find((d) => d.name === "risk_recall")!;
    expect(riskRecall.score).toBeGreaterThan(0);
  });

  it("low-stakes fixture scores well with consensus", () => {
    const fixture = EVALUATION_FIXTURES.find((f) => f.id === "low-stakes-writing")!;
    const response = makeFixtureResponse("low-stakes-writing");
    const result = evaluateResponse(fixture, response);

    const tradeoff = result.dimensions.find((d) => d.name === "tradeoff_quality")!;
    expect(tradeoff.score).toBeGreaterThanOrEqual(2);
  });
});

// --- Regression tests for REVIEW.md findings ---

describe("Regression: convergence must not claim 'converged' with open disputes", () => {
  it("does NOT return 'converged' when risk_warning dispute is still open", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", round: 2, stance: "support", warnings: ["warn"] }),
      makeStatement({ seatId: "B", round: 2, stance: "support" }),
    ];
    const prior: DisagreementRecord[] = [
      { id: "D1", topic: "risk", seats: ["A"], type: "risk_warning", status: "open" },
    ];

    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.fast,
      currentRound: 2,
      priorDisagreements: prior,
    });

    expect(result.reason).not.toBe("converged");
    expect(result.roundResult.unresolvedCount).toBeGreaterThan(0);
  });

  it("does NOT return 'converged' when claim_conflict is still open", () => {
    const statements: SeatStatement[] = [
      makeStatement({ seatId: "A", round: 2, stance: "support" }),
      makeStatement({ seatId: "B", round: 2, stance: "oppose" }),
    ];
    const prior: DisagreementRecord[] = [
      { id: "D1", topic: "conflict", seats: ["A", "B"], type: "claim_conflict", status: "open" },
    ];

    const result = evaluateConvergence({
      statements,
      modeConfig: MODE_CONFIGS.fast,
      currentRound: 2,
      priorDisagreements: prior,
    });

    expect(result.reason).not.toBe("converged");
  });
});

describe("Regression: parliamentBeatBaseline uses same rubric for both sides", () => {
  it("baseline is scored through the same 5-dimension rubric", () => {
    const fixture = EVALUATION_FIXTURES.find((f) => f.id === "arch-tradeoff")!;
    const response: ParliagentResponse = {
      finalAnswer: "Use a modular monolith first. Balances team size, complexity and scale.",
      decisionType: "majority",
      activatedSeats: ["Speaker", "DijkstraSeat", "OperatorSeat"],
      whyTheseSeats: "Architecture tradeoff",
      minorityReport: "OperatorSeat: microservices too early",
      openQuestions: ["Team growth pace?"],
      warnings: ["Complexity risk"],
      debateSummary: "Round 1 debate",
    };

    const withBaseline = evaluateResponse(fixture, response, "Just use microservices.");
    const withoutBaseline = evaluateResponse(fixture, response);

    expect(withBaseline.parliamentBeatBaseline).toBe(true);
    expect(withoutBaseline.parliamentBeatBaseline).toBeNull();
  });
});
