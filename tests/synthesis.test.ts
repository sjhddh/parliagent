import { describe, it, expect } from "vitest";
import {
  buildSynthesisPrompt,
  getSynthesisMaxTokens,
  buildTraceText,
} from "../src/core/synthesis.js";
import type { RoundResult } from "../src/contracts/trace.js";

describe("buildSynthesisPrompt", () => {
  it("generates answer mode prompt", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "answer",
      decisionType: "consensus",
      outputLength: "standard",
      rounds: [],
    });
    expect(prompt).toContain("clear, direct final answer");
    expect(prompt).toContain("thorough but focused");
  });

  it("generates memo mode prompt with options structure", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "memo",
      decisionType: "split",
      outputLength: "standard",
      rounds: [],
    });
    expect(prompt).toContain("options memo");
    expect(prompt).toContain("Situation");
    expect(prompt).toContain("Recommendation");
  });

  it("generates plan mode prompt with steps", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "plan",
      decisionType: "majority",
      outputLength: "standard",
      rounds: [],
    });
    expect(prompt).toContain("implementation plan");
    expect(prompt).toContain("Steps");
    expect(prompt).toContain("Dependencies");
  });

  it("generates review mode prompt with severity ordering", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "review",
      decisionType: "split",
      outputLength: "standard",
      rounds: [],
    });
    expect(prompt).toContain("critical review");
    expect(prompt).toContain("Issues");
    expect(prompt).toContain("severity");
  });

  it("generates transcript mode prompt", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "transcript",
      decisionType: "consensus",
      outputLength: "long",
      rounds: [],
    });
    expect(prompt).toContain("debate transcript");
    expect(prompt).toContain("comprehensive and detailed");
  });

  it("applies short length instruction", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "answer",
      decisionType: "consensus",
      outputLength: "short",
      rounds: [],
    });
    expect(prompt).toContain("2-4 sentences maximum");
  });

  it("applies long length instruction", () => {
    const prompt = buildSynthesisPrompt({
      prompt: "test",
      answerMode: "answer",
      decisionType: "consensus",
      outputLength: "long",
      rounds: [],
    });
    expect(prompt).toContain("comprehensive and detailed");
  });
});

describe("getSynthesisMaxTokens", () => {
  it("returns correct tokens for answer/standard", () => {
    expect(getSynthesisMaxTokens("answer", "standard")).toBe(512);
  });

  it("returns half tokens for short", () => {
    expect(getSynthesisMaxTokens("answer", "short")).toBe(256);
  });

  it("returns double tokens for long", () => {
    expect(getSynthesisMaxTokens("answer", "long")).toBe(1024);
  });

  it("transcript has highest base tokens", () => {
    const transcript = getSynthesisMaxTokens("transcript", "standard");
    const answer = getSynthesisMaxTokens("answer", "standard");
    expect(transcript).toBeGreaterThan(answer);
  });

  it("plan has more tokens than answer", () => {
    const plan = getSynthesisMaxTokens("plan", "standard");
    const answer = getSynthesisMaxTokens("answer", "standard");
    expect(plan).toBeGreaterThan(answer);
  });
});

describe("buildTraceText", () => {
  it("formats round results into readable text", () => {
    const rounds: RoundResult[] = [
      {
        round: 1,
        statements: [
          {
            seatId: "TestSeat",
            round: 1,
            stance: "support",
            summary: "Good approach",
            claims: ["Claim A"],
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
    expect(text).toContain("Round 1");
    expect(text).toContain("TestSeat");
    expect(text).toContain("support");
    expect(text).toContain("Claim A");
  });
});
