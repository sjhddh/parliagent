import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ModelPolicy } from "../src/runtime/policy.js";
import { defaultRegistry } from "../src/seats/registry.js";

describe("Execution Profiles", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY"]) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val !== undefined) process.env[key] = val;
      else delete process.env[key];
    }
  });

  describe("substrate policy on all seats", () => {
    it("every seat has a substrate policy", () => {
      for (const seat of defaultRegistry.listAll()) {
        expect(seat.substrate).toBeDefined();
        expect(seat.substrate!.preferredProvider).toBeTruthy();
        expect(seat.substrate!.fallbackChain.length).toBeGreaterThan(0);
        expect(seat.substrate!.modelClass).toBeTruthy();
      }
    });

    it("Speaker has chair model class", () => {
      const speaker = defaultRegistry.getOrThrow("Speaker");
      expect(speaker.substrate!.modelClass).toBe("chair");
      expect(speaker.substrate!.preferredProvider).toBe("primary");
    });

    it("model seats have provider-native preferred provider", () => {
      expect(defaultRegistry.getOrThrow("OpenAISeat").substrate!.preferredProvider).toBe("openai");
      expect(defaultRegistry.getOrThrow("ClaudeSeat").substrate!.preferredProvider).toBe("anthropic");
      expect(defaultRegistry.getOrThrow("GeminiSeat").substrate!.preferredProvider).toBe("google");
    });

    it("non-model starter seats prefer primary", () => {
      const nonModel = ["DijkstraSeat", "ShannonSeat", "AristotleSeat", "FeynmanSeat", "KahnemanSeat", "ProductStrategySeat", "OperatorSeat", "SecurityPrivacySeat"];
      for (const id of nonModel) {
        const seat = defaultRegistry.getOrThrow(id);
        expect(seat.substrate!.preferredProvider).toBe("primary");
      }
    });
  });

  describe("single-provider deterministic fallback", () => {
    it("all seats resolve to the only available provider", () => {
      const policy = new ModelPolicy({
        anthropic: { apiKey: "test-key" },
      });

      for (const seat of defaultRegistry.listStarter()) {
        const assignment = policy.assignModel(seat, "available");
        expect(assignment.adapter.providerId).toBe("anthropic");
      }
    });

    it("model-native seats fall back when their provider is unavailable", () => {
      const policy = new ModelPolicy({
        anthropic: { apiKey: "test-key" },
      });

      const openaiSeat = defaultRegistry.getOrThrow("OpenAISeat");
      const assignment = policy.assignModel(openaiSeat, "available");
      expect(assignment.adapter.providerId).toBe("anthropic");
      expect(assignment.resolvedVia).not.toBe("preferred");
    });
  });

  describe("available profile", () => {
    it("uses preferred provider when available", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
      });

      const openaiSeat = defaultRegistry.getOrThrow("OpenAISeat");
      const assignment = policy.assignModel(openaiSeat, "available");
      expect(assignment.adapter.providerId).toBe("openai");
      expect(assignment.resolvedVia).toBe("preferred");
    });

    it("falls back to primary when preferred is unavailable", () => {
      const policy = new ModelPolicy({
        anthropic: { apiKey: "test-anthropic" },
      });

      const googleSeat = defaultRegistry.getOrThrow("GeminiSeat");
      const assignment = policy.assignModel(googleSeat, "available");
      expect(assignment.adapter.providerId).toBe("anthropic");
    });
  });

  describe("federated profile", () => {
    it("provider-native seats use their own family", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
      });

      const claudeSeat = defaultRegistry.getOrThrow("ClaudeSeat");
      const assignment = policy.assignModel(claudeSeat, "federated");
      expect(assignment.adapter.providerId).toBe("anthropic");
      expect(assignment.resolvedVia).toBe("federated-native");
    });

    it("non-native seats still use primary", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
      });

      const dijkstra = defaultRegistry.getOrThrow("DijkstraSeat");
      const assignment = policy.assignModel(dijkstra, "federated");
      expect(assignment.adapter.providerId).toBe("anthropic");
    });

    it("native seats fall back gracefully when their provider is missing", () => {
      const policy = new ModelPolicy({
        anthropic: { apiKey: "test-anthropic" },
      });

      const openaiSeat = defaultRegistry.getOrThrow("OpenAISeat");
      const assignment = policy.assignModel(openaiSeat, "federated");
      expect(assignment.adapter.providerId).toBe("anthropic");
    });
  });

  describe("supreme profile", () => {
    it("all seats use the supreme adapter", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
      });

      const starters = defaultRegistry.listStarter();
      for (const seat of starters) {
        const assignment = policy.assignModel(seat, "supreme");
        expect(assignment.resolvedVia).toBe("supreme");
      }
    });

    it("supreme defaults to primary when supremeProvider not set", () => {
      const policy = new ModelPolicy({
        anthropic: { apiKey: "test-anthropic" },
      });

      const seat = defaultRegistry.getOrThrow("OpenAISeat");
      const assignment = policy.assignModel(seat, "supreme");
      expect(assignment.adapter.providerId).toBe("anthropic");
    });

    it("respects explicit supremeProvider", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
        supremeProvider: "openai",
      });

      const seat = defaultRegistry.getOrThrow("ClaudeSeat");
      const assignment = policy.assignModel(seat, "supreme");
      expect(assignment.adapter.providerId).toBe("openai");
    });

    it("synthesis uses supreme adapter", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
        supremeProvider: "openai",
      });

      const adapter = policy.getSynthesisAdapter("supreme");
      expect(adapter?.providerId).toBe("openai");
    });

    it("synthesis uses primary for non-supreme profiles", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
      });

      const available = policy.getSynthesisAdapter("available");
      const federated = policy.getSynthesisAdapter("federated");
      expect(available?.providerId).toBe("anthropic");
      expect(federated?.providerId).toBe("anthropic");
    });
  });

  describe("mode and profile are independent", () => {
    it("same seat gets same profile assignment regardless of mode context", () => {
      const policy = new ModelPolicy({
        openai: { apiKey: "test-openai" },
        anthropic: { apiKey: "test-anthropic" },
      });

      const seat = defaultRegistry.getOrThrow("DijkstraSeat");
      const availableAssignment = policy.assignModel(seat, "available");
      const supremeAssignment = policy.assignModel(seat, "supreme");

      expect(availableAssignment.adapter.providerId).toBe("anthropic");
      expect(supremeAssignment.resolvedVia).toBe("supreme");
    });
  });
});
