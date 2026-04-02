import { describe, it, expect } from "vitest";
import { selectFullParliagent } from "../src/core/routing.js";
import { FULL_PARLIAGENT_CONFIG, CHAMBER_PRESETS } from "../src/core/config.js";
import { defaultRegistry } from "../src/seats/registry.js";

describe("Full Parliagent", () => {
  describe("selectFullParliagent", () => {
    it("activates all 33 seats including Speaker", () => {
      const result = selectFullParliagent("test prompt");
      expect(result.selectedSeatIds.length).toBe(33);
      expect(result.selectedSeatIds[0]).toBe("Speaker");
      expect(result.isFullParliagent).toBe(true);
    });

    it("respects excludeSeats", () => {
      const result = selectFullParliagent("test prompt", undefined, ["TuringSeat", "KantSeat"]);
      expect(result.selectedSeatIds).not.toContain("TuringSeat");
      expect(result.selectedSeatIds).not.toContain("KantSeat");
      expect(result.selectedSeatIds.length).toBe(31);
    });

    it("always includes Speaker", () => {
      const result = selectFullParliagent("test prompt");
      expect(result.selectedSeatIds[0]).toBe("Speaker");
    });

    it("classifies task type", () => {
      const result = selectFullParliagent("How to implement a REST API?", "coding");
      expect(result.classifiedTaskType).toBe("coding");
    });

    it("routing reason mentions full parliagent", () => {
      const result = selectFullParliagent("test prompt");
      expect(result.routingReason).toContain("Full parliagent");
      expect(result.routingReason).toContain("32 debate seats");
    });
  });

  describe("FULL_PARLIAGENT_CONFIG", () => {
    it("has correct seat count for 32 debate seats", () => {
      expect(FULL_PARLIAGENT_CONFIG.seatCount.max).toBe(32);
    });

    it("has budget limits accommodating one 32-seat round", () => {
      expect(FULL_PARLIAGENT_CONFIG.defaultMaxTokens).toBe(300000);
      expect(FULL_PARLIAGENT_CONFIG.defaultMaxLatencyMs).toBe(120000);
    });

    it("defaults to 1 round (sufficient with 32 voices)", () => {
      expect(FULL_PARLIAGENT_CONFIG.maxRounds).toBe(1);
    });
  });

  describe("all seats reachable via presets", () => {
    it("every non-Speaker seat appears in at least one chamber preset", () => {
      const allPresetSeats = new Set<string>();
      for (const preset of Object.values(CHAMBER_PRESETS)) {
        for (const id of preset.modelSeatPool) allPresetSeats.add(id);
        for (const id of preset.domainSeats) allPresetSeats.add(id);
      }

      const allSeatIds = defaultRegistry.listAll()
        .filter((s) => s.id !== "Speaker")
        .map((s) => s.id);

      const unreachable = allSeatIds.filter((id) => !allPresetSeats.has(id));
      expect(unreachable).toEqual([]);
    });
  });

  describe("all seats are first-class", () => {
    it("no seats have isStarter=false", () => {
      const nonStarter = defaultRegistry.listAll().filter((s) => !s.isStarter);
      expect(nonStarter.length).toBe(0);
    });

    it("all 33 seats have production-grade system prompts (>100 chars)", () => {
      for (const seat of defaultRegistry.listAll()) {
        expect(seat.systemPrompt.length).toBeGreaterThan(100);
      }
    });

    it("all 33 seats have substrate policies", () => {
      for (const seat of defaultRegistry.listAll()) {
        expect(seat.substrate).toBeDefined();
        expect(seat.substrate!.fallbackChain.length).toBeGreaterThan(0);
      }
    });

    it("all 33 seats have 4+ strengths and 2+ blind spots", () => {
      for (const seat of defaultRegistry.listAll()) {
        expect(seat.strengths.length).toBeGreaterThanOrEqual(3);
        expect(seat.blindSpots.length).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
