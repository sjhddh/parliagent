import { describe, it, expect } from "vitest";
import { ParliagentRequest } from "../src/contracts/request.js";
import { ParliagentResponse } from "../src/contracts/response.js";
import { SeatStatement } from "../src/contracts/trace.js";
import { SeatProfile } from "../src/contracts/seats.js";

describe("ParliagentRequest schema", () => {
  it("accepts minimal request", () => {
    const result = ParliagentRequest.safeParse({ prompt: "test" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe("micro");
      expect(result.data.trace).toBe("summary");
    }
  });

  it("accepts full request", () => {
    const result = ParliagentRequest.safeParse({
      prompt: "What is the best architecture?",
      mode: "balanced",
      taskType: "coding",
      answerMode: "plan",
      seatHints: ["DijkstraSeat"],
      constraints: {
        maxTokens: 5000,
        maxLatencyMs: 10000,
        maxRounds: 2,
        outputLength: "standard",
        safetyMode: "strict",
      },
      seed: "test-seed-123",
      trace: "full",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty prompt", () => {
    const result = ParliagentRequest.safeParse({ prompt: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid mode", () => {
    const result = ParliagentRequest.safeParse({
      prompt: "test",
      mode: "turbo",
    });
    expect(result.success).toBe(false);
  });
});

describe("ParliagentResponse schema", () => {
  it("validates a complete response", () => {
    const result = ParliagentResponse.safeParse({
      finalAnswer: "The recommended approach is...",
      decisionType: "consensus",
      activatedSeats: ["Speaker", "DijkstraSeat", "ClaudeSeat"],
      whyTheseSeats: "Coding task requiring rigor and synthesis",
      debateSummary: "Round 1: all seats agreed on core approach",
    });
    expect(result.success).toBe(true);
  });

  it("validates response with minority report", () => {
    const result = ParliagentResponse.safeParse({
      finalAnswer: "Use microservices",
      decisionType: "split",
      activatedSeats: ["Speaker", "DijkstraSeat", "OperatorSeat"],
      whyTheseSeats: "Architecture decision",
      minorityReport: "OperatorSeat: monolith is simpler for team size",
      openQuestions: ["What is the expected scale in 2 years?"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = ParliagentResponse.safeParse({
      finalAnswer: "test",
    });
    expect(result.success).toBe(false);
  });
});

describe("SeatStatement schema", () => {
  it("validates a correct statement", () => {
    const result = SeatStatement.safeParse({
      seatId: "DijkstraSeat",
      round: 1,
      stance: "support",
      summary: "This approach is structurally sound",
      claims: ["The invariants are well-defined", "Edge cases are handled"],
      objections: [],
      confidence: 4,
    });
    expect(result.success).toBe(true);
  });

  it("rejects confidence out of range", () => {
    const result = SeatStatement.safeParse({
      seatId: "test",
      round: 1,
      stance: "support",
      summary: "test",
      claims: ["claim"],
      objections: [],
      confidence: 6,
    });
    expect(result.success).toBe(false);
  });

  it("rejects too many claims", () => {
    const result = SeatStatement.safeParse({
      seatId: "test",
      round: 1,
      stance: "support",
      summary: "test",
      claims: ["a", "b", "c", "d"],
      objections: [],
      confidence: 3,
    });
    expect(result.success).toBe(false);
  });
});

describe("SeatProfile schema", () => {
  it("validates a starter seat profile", () => {
    const result = SeatProfile.safeParse({
      id: "TestSeat",
      name: "Test",
      role: "Testing",
      domain: "testing",
      category: "procedural",
      strengths: ["thoroughness"],
      blindSpots: ["may miss big picture"],
      speakingStyle: "precise",
      defaultModelClass: "frontier",
      systemPrompt: "You are a test seat.",
      isStarter: true,
    });
    expect(result.success).toBe(true);
  });
});
