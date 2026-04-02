import { describe, it, expect } from "vitest";
import { SeatRegistry, defaultRegistry } from "../src/seats/registry.js";

describe("SeatRegistry", () => {
  it("has 33 total seats", () => {
    expect(defaultRegistry.size).toBe(33);
  });

  it("all 33 seats are production-grade (no expansion-only seats)", () => {
    expect(defaultRegistry.listStarter().length).toBe(33);
  });

  it("includes Speaker in starter roster", () => {
    const starters = defaultRegistry.starterIds();
    expect(starters).toContain("Speaker");
  });

  it("includes all three model seats in starter roster", () => {
    const starters = defaultRegistry.starterIds();
    expect(starters).toContain("OpenAISeat");
    expect(starters).toContain("ClaudeSeat");
    expect(starters).toContain("GeminiSeat");
  });

  it("includes all 33 constitutional seats", () => {
    const all = defaultRegistry.listAll().map((s) => s.id);
    const expected = [
      "Speaker", "OpenAISeat", "ClaudeSeat", "GeminiSeat",
      "DijkstraSeat", "ShannonSeat", "AristotleSeat", "FeynmanSeat",
      "KahnemanSeat", "ProductStrategySeat", "OperatorSeat", "SecurityPrivacySeat",
      "TuringSeat", "KnuthSeat", "DistributedSystemsSeat", "MLSystemsSeat",
      "HumanComputerInteractionSeat", "KantSeat", "NietzscheSeat",
      "EuclidSeat", "GaussSeat", "VonNeumannSeat", "NewtonSeat", "EinsteinSeat",
      "SmithSeat", "KeynesSeat", "StrategySeat", "JungSeat", "CognitiveScienceSeat",
      "DesignCommunicationSeat", "LawGovernanceSeat", "EthicsHumanImpactSeat",
      "CitizenPragmatistSeat",
    ];
    for (const id of expected) {
      expect(all).toContain(id);
    }
  });

  it("can retrieve seat by id", () => {
    const seat = defaultRegistry.get("DijkstraSeat");
    expect(seat).toBeDefined();
    expect(seat!.name).toBe("Dijkstra");
    expect(seat!.category).toBe("computing-foundations");
  });

  it("throws on unknown seat id", () => {
    expect(() => defaultRegistry.getOrThrow("NonExistentSeat")).toThrow(
      "Unknown seat: NonExistentSeat",
    );
  });

  it("lists by category", () => {
    const philosophy = defaultRegistry.listByCategory("philosophy");
    expect(philosophy.length).toBeGreaterThan(0);
    expect(philosophy.every((s) => s.category === "philosophy")).toBe(true);
  });

  it("every seat has required fields", () => {
    for (const seat of defaultRegistry.listAll()) {
      expect(seat.id).toBeTruthy();
      expect(seat.name).toBeTruthy();
      expect(seat.role).toBeTruthy();
      expect(seat.domain).toBeTruthy();
      expect(seat.systemPrompt).toBeTruthy();
      expect(seat.strengths.length).toBeGreaterThan(0);
      expect(seat.blindSpots.length).toBeGreaterThan(0);
    }
  });
});
