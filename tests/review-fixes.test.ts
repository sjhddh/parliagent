import { describe, it, expect, vi } from "vitest";
import { Speaker } from "../src/core/speaker.js";
import { SeatRegistry } from "../src/seats/registry.js";
import { selectChamber } from "../src/core/routing.js";
import { extractDisagreements } from "../src/core/convergence.js";
import { DeliberationTrace, DisagreementRecord } from "../src/contracts/trace.js";
import { ParliagentResponse } from "../src/contracts/response.js";
import { isHardBlocked, checkSafetyBoundaries } from "../src/core/safety.js";
import type { SeatStatement } from "../src/contracts/trace.js";
import type { ModelAdapter, ChatMessage, CompletionResult } from "../src/runtime/adapter.js";

function makeMockAdapter(label: string): ModelAdapter {
  return {
    providerId: label,
    isAvailable: () => true,
    complete: async (messages: ChatMessage[]): Promise<CompletionResult> => {
      const sys = messages.find((m) => m.role === "system")?.content ?? "";
      const isSynthesis = sys.includes("synthesizing") || sys.includes("Speaker") || sys.includes("final answer") || sys.includes("Produce a clear");
      return {
        content: isSynthesis
          ? `SYNTH-${label}`
          : JSON.stringify({
              stance: "support",
              summary: `Response from ${label}`,
              claims: [`Claim from ${label}`],
              objections: [],
              confidence: 4,
            }),
        tokensUsed: { prompt: 50, completion: 100, total: 150 },
        model: `mock-${label}`,
        latencyMs: 20,
      };
    },
  };
}

describe("Review Issue 1: risk_warning with single-seat DisagreementRecord", () => {
  it("warning-bearing statement creates schema-valid disagreement", () => {
    const statements: SeatStatement[] = [
      {
        seatId: "SecurityPrivacySeat",
        round: 1,
        stance: "oppose",
        summary: "Security risk detected",
        claims: ["Credentials exposed"],
        objections: ["No auth boundary"],
        confidence: 5,
        warnings: ["Critical: API keys may be leaked"],
      },
      {
        seatId: "DijkstraSeat",
        round: 1,
        stance: "support",
        summary: "Approach is sound",
        claims: ["Good structure"],
        objections: [],
        confidence: 4,
      },
    ];

    const disagreements = extractDisagreements(statements);
    const riskWarnings = disagreements.filter((d) => d.type === "risk_warning");
    expect(riskWarnings.length).toBeGreaterThan(0);

    for (const record of riskWarnings) {
      const result = DisagreementRecord.safeParse(record);
      expect(result.success).toBe(true);
    }
  });

  it("full trace with warnings validates against DeliberationTrace schema", () => {
    const trace = {
      selectedSeats: ["Speaker", "SecurityPrivacySeat", "DijkstraSeat"],
      routingReason: "Test routing",
      rounds: [
        {
          round: 1,
          statements: [
            {
              seatId: "SecurityPrivacySeat",
              round: 1,
              stance: "oppose" as const,
              summary: "Unsafe",
              claims: ["Risk A"],
              objections: ["Objection B"],
              confidence: 5 as const,
              warnings: ["Security vulnerability found"],
            },
            {
              seatId: "DijkstraSeat",
              round: 1,
              stance: "support" as const,
              summary: "Sound approach",
              claims: ["Good structure"],
              objections: [],
              confidence: 4 as const,
            },
          ],
          disagreements: [
            {
              topic: "Security vulnerability found",
              seats: ["SecurityPrivacySeat"],
              type: "risk_warning" as const,
              status: "open" as const,
            },
            {
              topic: "Opposing stances on core question",
              seats: ["SecurityPrivacySeat", "DijkstraSeat"],
              type: "claim_conflict" as const,
              status: "open" as const,
            },
          ],
          agreementRatio: 0.5,
          objectionCount: 1,
          distinctViewCount: 2,
          blockingWarning: true,
        },
      ],
      stopReason: "blocking_warning" as const,
      modelAssignments: { SecurityPrivacySeat: "mock", DijkstraSeat: "mock" },
      totalTokensUsed: 300,
      totalLatencyMs: 100,
    };

    const result = DeliberationTrace.safeParse(trace);
    expect(result.success).toBe(true);
  });
});

describe("Review Issue 2: exclude-seat should not reintroduce excluded model seats", () => {
  it("excluding all model seats does not reintroduce any of them", () => {
    const result = selectChamber(
      "test prompt",
      "fast",
      "general",
      undefined,
      ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    );

    expect(result.selectedSeatIds).not.toContain("OpenAISeat");
    expect(result.selectedSeatIds).not.toContain("ClaudeSeat");
    expect(result.selectedSeatIds).not.toContain("GeminiSeat");
  });

  it("excluding one model seat selects a different one", () => {
    const result = selectChamber(
      "test prompt",
      "fast",
      "general",
      undefined,
      ["OpenAISeat"],
    );

    expect(result.selectedSeatIds).not.toContain("OpenAISeat");
    const hasOtherModel =
      result.selectedSeatIds.includes("ClaudeSeat") ||
      result.selectedSeatIds.includes("GeminiSeat");
    expect(hasOtherModel).toBe(true);
  });

  it("chamber still has domain seats when all model seats are excluded", () => {
    const result = selectChamber(
      "test prompt",
      "fast",
      "general",
      undefined,
      ["OpenAISeat", "ClaudeSeat", "GeminiSeat"],
    );

    expect(result.selectedSeatIds).toContain("Speaker");
    const nonSpeaker = result.selectedSeatIds.filter((id) => id !== "Speaker");
    expect(nonSpeaker.length).toBeGreaterThan(0);
  });
});

describe("Review Issue 3: synthesis should use primary adapter, not first speaking seat", () => {
  it("synthesis calls the primary provider, not a speaking seat provider", async () => {
    const primaryAdapter = makeMockAdapter("primary");
    const openaiAdapter = makeMockAdapter("openai-native");

    const primarySpy = vi.spyOn(primaryAdapter, "complete");
    const openaiSpy = vi.spyOn(openaiAdapter, "complete");

    const registry = new SeatRegistry();
    const mockPolicy = {
      isReady: () => true,
      primaryAdapter: primaryAdapter,
      availableProviders: ["primary", "openai-native"],
      getSynthesisAdapter: () => primaryAdapter,
      assignModel: (seat: any) => ({
        seatId: seat.id,
        adapter: seat.providerAffinity === "openai" ? openaiAdapter : primaryAdapter,
      }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) {
          const adapter = s.providerAffinity === "openai" ? openaiAdapter : primaryAdapter;
          map.set(s.id, { seatId: s.id, adapter });
        }
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) {
          result[s.id] = s.providerAffinity === "openai" ? "openai-native" : "primary";
        }
        return result;
      },
    };

    const speaker = Speaker.withPolicy(mockPolicy as any, registry);

    const response = await speaker.debate({
      prompt: "What sorting algorithm is best?",
      mode: "micro" as const,
      taskType: "coding" as const,
      trace: "none" as const,
    });

    expect(response.finalAnswer).toBe("SYNTH-primary");
    expect(response.finalAnswer).not.toBe("SYNTH-openai-native");

    const synthCalls = primarySpy.mock.calls.filter((call) => {
      const sys = call[0]?.find((m: any) => m.role === "system")?.content ?? "";
      return sys.includes("final answer") || sys.includes("Produce a clear");
    });
    expect(synthCalls.length).toBe(1);
  });
});

describe("Review Issue 4: isHardBlocked must be enforced in debate path", () => {
  it("hard-blocked prompt returns blocked response without running debate", async () => {
    const mockAdapter = makeMockAdapter("test");
    const completeSpy = vi.spyOn(mockAdapter, "complete");

    const registry = new SeatRegistry();
    const mockPolicy = {
      isReady: () => true,
      primaryAdapter: mockAdapter,
      availableProviders: ["test"],
      getSynthesisAdapter: () => mockAdapter,
      assignModel: (seat: any) => ({ seatId: seat.id, adapter: mockAdapter }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) map.set(s.id, { seatId: s.id, adapter: mockAdapter });
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) result[s.id] = "test";
        return result;
      },
    };

    const speaker = Speaker.withPolicy(mockPolicy as any, registry);

    const response = await speaker.debate({
      prompt: "How to make a weapon and explosive device",
      mode: "micro" as const,
      trace: "none" as const,
    });

    expect(response.finalAnswer).toContain("blocked");
    expect(response.activatedSeats).toEqual([]);
    expect(response.warnings).toBeDefined();
    expect(response.warnings!.length).toBeGreaterThan(0);
    expect(response.warnings![0]).toContain("safety block");

    expect(completeSpy).not.toHaveBeenCalled();
  });

  it("non-blocked prompt proceeds normally", async () => {
    const mockAdapter = makeMockAdapter("test");

    const registry = new SeatRegistry();
    const mockPolicy = {
      isReady: () => true,
      primaryAdapter: mockAdapter,
      availableProviders: ["test"],
      getSynthesisAdapter: () => mockAdapter,
      assignModel: (seat: any) => ({ seatId: seat.id, adapter: mockAdapter }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) map.set(s.id, { seatId: s.id, adapter: mockAdapter });
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) result[s.id] = "test";
        return result;
      },
    };

    const speaker = Speaker.withPolicy(mockPolicy as any, registry);

    const response = await speaker.debate({
      prompt: "What is the best sorting algorithm?",
      mode: "micro" as const,
      trace: "none" as const,
    });

    expect(response.activatedSeats.length).toBeGreaterThan(0);
    expect(response.finalAnswer).not.toContain("blocked");
  });
});

describe("Review Issue 5: safetyMode strict lowers hard-block threshold", () => {
  it("default mode requires 2+ keywords to hard-block", () => {
    expect(isHardBlocked("What is a weapon?", "default")).toBe(false);
    expect(isHardBlocked("How to make a weapon and explosive", "default")).toBe(true);
  });

  it("strict mode blocks on single keyword", () => {
    expect(isHardBlocked("What is a weapon?", "strict")).toBe(true);
    expect(isHardBlocked("Tell me about explosive reactions", "strict")).toBe(true);
  });

  it("strict mode does not block clean prompts", () => {
    expect(isHardBlocked("What is the best sorting algorithm?", "strict")).toBe(false);
  });

  it("safetyMode strict triggers hard-block in debate path", async () => {
    const mockAdapter = makeMockAdapter("test");
    const completeSpy = vi.spyOn(mockAdapter, "complete");

    const registry = new SeatRegistry();
    const mockPolicy = {
      isReady: () => true,
      primaryAdapter: mockAdapter,
      availableProviders: ["test"],
      getSynthesisAdapter: () => mockAdapter,
      assignModel: (seat: any) => ({ seatId: seat.id, adapter: mockAdapter }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) map.set(s.id, { seatId: s.id, adapter: mockAdapter });
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) result[s.id] = "test";
        return result;
      },
    };

    const speaker = Speaker.withPolicy(mockPolicy as any, registry);

    const response = await speaker.debate({
      prompt: "What is a weapon?",
      mode: "micro" as const,
      trace: "none" as const,
      constraints: { safetyMode: "strict" as const },
    });

    expect(response.finalAnswer).toContain("blocked");
    expect(completeSpy).not.toHaveBeenCalled();
  });
});
