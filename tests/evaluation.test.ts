import { describe, it, expect } from "vitest";
import { evaluateResponse, EVALUATION_FIXTURES } from "../src/evaluation/rubric.js";
import type { ParliagentResponse } from "../src/contracts/response.js";

function makeResponse(overrides: Partial<ParliagentResponse> = {}): ParliagentResponse {
  return {
    finalAnswer: "The recommended approach is to use a modular monolith initially, then extract services as the team grows. This balances development speed with future scalability.",
    decisionType: "majority",
    activatedSeats: ["Speaker", "DijkstraSeat", "OperatorSeat", "ProductStrategySeat"],
    whyTheseSeats: "Architecture decision with strategy and operational tradeoffs",
    minorityReport: "OperatorSeat (oppose): Microservices introduce premature complexity for a 3-person team.",
    openQuestions: ["What is the expected team size in 12 months?"],
    warnings: ["Premature microservices can increase complexity beyond team capacity"],
    debateSummary: "Round 1: DijkstraSeat and ProductStrategySeat support modular monolith, OperatorSeat opposes early microservices.",
    ...overrides,
  };
}

describe("Evaluation rubric", () => {
  const archFixture = EVALUATION_FIXTURES.find((f) => f.id === "arch-tradeoff")!;

  it("evaluates a good response with high scores", () => {
    const response = makeResponse();
    const result = evaluateResponse(archFixture, response);

    expect(result.percentScore).toBeGreaterThan(50);
    expect(result.dimensions.length).toBe(5);
    expect(result.summary).toContain("Score:");
  });

  it("penalizes incomplete responses", () => {
    const response = makeResponse({
      finalAnswer: "IDK",
      minorityReport: undefined,
      warnings: undefined,
      openQuestions: undefined,
    });
    const result = evaluateResponse(archFixture, response);

    const goodResult = evaluateResponse(archFixture, makeResponse());
    expect(result.percentScore).toBeLessThan(goodResult.percentScore);
  });

  it("rewards minority reports on tradeoff questions", () => {
    const withMinority = evaluateResponse(archFixture, makeResponse());
    const withoutMinority = evaluateResponse(archFixture, makeResponse({
      minorityReport: undefined,
      decisionType: "consensus",
    }));

    const tradeoffWith = withMinority.dimensions.find((d) => d.name === "tradeoff_quality")!;
    const tradeoffWithout = withoutMinority.dimensions.find((d) => d.name === "tradeoff_quality")!;
    expect(tradeoffWith.score).toBeGreaterThanOrEqual(tradeoffWithout.score);
  });

  it("measures risk recall against expected topics", () => {
    const response = makeResponse({
      finalAnswer: "Consider team size and complexity tradeoffs. Watch the scale implications.",
      warnings: ["Complexity risk for small team"],
    });
    const result = evaluateResponse(archFixture, response);
    const riskDim = result.dimensions.find((d) => d.name === "risk_recall")!;
    expect(riskDim.score).toBeGreaterThan(0);
  });

  it("handles factual/low-tradeoff fixtures", () => {
    const factualFixture = EVALUATION_FIXTURES.find((f) => f.id === "factual-simple")!;
    const response = makeResponse({
      finalAnswer: "Binary search has O(log n) time complexity. This is well-established and not debatable.",
      decisionType: "consensus",
      minorityReport: undefined,
    });
    const result = evaluateResponse(factualFixture, response);
    expect(result.percentScore).toBeGreaterThan(50);
  });

  it("all fixtures have required fields", () => {
    for (const fixture of EVALUATION_FIXTURES) {
      expect(fixture.id).toBeTruthy();
      expect(fixture.prompt).toBeTruthy();
      expect(fixture.category).toBeTruthy();
      expect(fixture.expectedTraits).toBeDefined();
      expect(typeof fixture.expectedTraits.shouldSurfaceDisagreement).toBe("boolean");
    }
  });

  it("fixture set covers all categories", () => {
    const categories = new Set(EVALUATION_FIXTURES.map((f) => f.category));
    expect(categories.has("factual")).toBe(true);
    expect(categories.has("tradeoff")).toBe(true);
    expect(categories.has("risk")).toBe(true);
    expect(categories.has("calibration")).toBe(true);
    expect(categories.has("actionability")).toBe(true);
  });

  it("parliamentBeatBaseline flag works", () => {
    const response = makeResponse();
    const result = evaluateResponse(archFixture, response, "Just use microservices.");
    expect(typeof result.parliamentBeatBaseline).toBe("boolean");
  });
});

describe("Evaluation dimensions", () => {
  const fixture = EVALUATION_FIXTURES.find((f) => f.id === "security-review")!;

  it("completeness scores answer quality", () => {
    const response = makeResponse({
      finalAnswer: "The security implementation has several concerns that need addressing including credential storage practices.",
      activatedSeats: ["Speaker", "SecurityPrivacySeat", "DijkstraSeat"],
      whyTheseSeats: "Security review requiring adversarial analysis",
    });
    const result = evaluateResponse(fixture, response);
    const completeness = result.dimensions.find((d) => d.name === "completeness")!;
    expect(completeness.score).toBeGreaterThanOrEqual(3);
  });

  it("actionability measures structured output", () => {
    const response = makeResponse({
      finalAnswer: "Step 1: Audit current bcrypt configuration. Step 2: Add connection encryption. Step 3: Implement key rotation.",
      warnings: ["Credential storage needs review"],
    });
    const result = evaluateResponse(fixture, response);
    const actionability = result.dimensions.find((d) => d.name === "actionability")!;
    expect(actionability.score).toBeGreaterThan(0);
  });
});
