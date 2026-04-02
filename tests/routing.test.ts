import { describe, it, expect } from "vitest";
import { classifyTask, selectChamber } from "../src/core/routing.js";
import { SeatRegistry } from "../src/seats/registry.js";

describe("classifyTask", () => {
  it("classifies coding prompts", () => {
    expect(classifyTask("How do I implement a binary search function?")).toBe(
      "coding",
    );
    expect(classifyTask("Debug this TypeScript compiler error")).toBe("coding");
    expect(classifyTask("Write a REST API endpoint for user auth")).toBe(
      "coding",
    );
  });

  it("classifies writing prompts", () => {
    expect(classifyTask("Write a blog post about climate change")).toBe(
      "writing",
    );
    expect(classifyTask("Draft an email to the team about the launch")).toBe(
      "writing",
    );
  });

  it("classifies planning prompts", () => {
    expect(classifyTask("Create a project roadmap for Q3")).toBe("planning");
    expect(classifyTask("Plan the sprint backlog for next milestone")).toBe(
      "planning",
    );
  });

  it("classifies analysis prompts", () => {
    expect(classifyTask("Analyze the performance metrics from last quarter")).toBe(
      "analysis",
    );
    expect(classifyTask("Compare React and Vue for our use case")).toBe(
      "analysis",
    );
  });

  it("classifies strategy prompts", () => {
    expect(classifyTask("What pricing strategy should we use?")).toBe(
      "strategy",
    );
    expect(classifyTask("How do we position against our competitor?")).toBe(
      "strategy",
    );
  });

  it("classifies ethics prompts", () => {
    expect(classifyTask("Is this ethical and morally responsible?")).toBe(
      "ethics",
    );
    expect(
      classifyTask("What are the fairness and bias implications of this?"),
    ).toBe("ethics");
  });

  it("defaults to general for ambiguous prompts", () => {
    expect(classifyTask("What should I have for lunch?")).toBe("general");
    expect(classifyTask("Tell me about the weather")).toBe("general");
  });
});

describe("selectChamber", () => {
  const registry = new SeatRegistry();

  it("always includes Speaker", () => {
    const result = selectChamber("test prompt", "micro", undefined, undefined, undefined, registry);
    expect(result.selectedSeatIds).toContain("Speaker");
  });

  it("respects micro mode seat count", () => {
    const result = selectChamber("test prompt", "micro", "general", undefined, undefined, registry);
    expect(result.selectedSeatIds.length).toBeGreaterThanOrEqual(2);
    expect(result.selectedSeatIds.length).toBeLessThanOrEqual(4);
  });

  it("includes a model seat", () => {
    const result = selectChamber("test prompt", "fast", "general", undefined, undefined, registry);
    const modelSeats = ["OpenAISeat", "ClaudeSeat", "GeminiSeat"];
    expect(result.selectedSeatIds.some((id) => modelSeats.includes(id))).toBe(
      true,
    );
  });

  it("respects seat hints", () => {
    const result = selectChamber(
      "test prompt",
      "balanced",
      "general",
      ["SecurityPrivacySeat"],
      undefined,
      registry,
    );
    expect(result.selectedSeatIds).toContain("SecurityPrivacySeat");
  });

  it("respects exclude seats", () => {
    const result = selectChamber(
      "test prompt",
      "fast",
      "general",
      undefined,
      ["OpenAISeat"],
      registry,
    );
    expect(result.selectedSeatIds).not.toContain("OpenAISeat");
  });

  it("upgrades SecurityPrivacySeat for security-sensitive prompts", () => {
    const result = selectChamber(
      "How should I handle API key rotation and credential management?",
      "fast",
      "coding",
      undefined,
      undefined,
      registry,
    );
    expect(result.selectedSeatIds).toContain("SecurityPrivacySeat");
  });

  it("provides routing reason", () => {
    const result = selectChamber("test prompt", "micro", "coding", undefined, undefined, registry);
    expect(result.routingReason).toContain("coding");
    expect(result.classifiedTaskType).toBe("coding");
  });

  it("uses coding preset for coding tasks", () => {
    const result = selectChamber(
      "Implement a function",
      "fast",
      "coding",
      undefined,
      undefined,
      registry,
    );
    expect(result.selectedSeatIds).toContain("DijkstraSeat");
  });
});
