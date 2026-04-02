import { describe, it, expect, vi } from "vitest";
import { Speaker } from "../src/core/speaker.js";
import { SeatRegistry } from "../src/seats/registry.js";
import { ParliamentResponse } from "../src/contracts/response.js";
import type { ModelAdapter, ChatMessage, CompletionResult } from "../src/runtime/adapter.js";

function createMockAdapter(responses: Record<string, string>): ModelAdapter {
  let callCount = 0;
  return {
    providerId: "mock",
    isAvailable: () => true,
    complete: async (messages: ChatMessage[]): Promise<CompletionResult> => {
      callCount++;
      const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";

      let seatId = "unknown";
      for (const [id, _] of Object.entries(responses)) {
        if (systemPrompt.toLowerCase().includes(id.toLowerCase())) {
          seatId = id;
          break;
        }
      }

      const responseContent = responses[seatId] ?? responses["default"] ?? '{"stance":"uncertain","summary":"No response","claims":["No response"],"objections":[],"confidence":1}';

      return {
        content: responseContent,
        tokensUsed: { prompt: 100, completion: 150, total: 250 },
        model: "mock-model",
        latencyMs: 50,
      };
    },
  };
}

describe("Hello World Milestone", () => {
  it("produces valid ParliamentResponse from Speaker + 2 seats in 1 round", async () => {
    const mockResponses: Record<string, string> = {
      default: JSON.stringify({
        stance: "support",
        summary: "Quicksort is generally the best general-purpose sorting algorithm due to its average O(n log n) performance and cache-friendly access patterns.",
        claims: [
          "Quicksort has O(n log n) average case",
          "Cache-friendly memory access makes it fast in practice",
        ],
        objections: ["Worst case is O(n²) without careful pivot selection"],
        confidence: 4,
      }),
      synthesis: "Based on the parliamentary debate, quicksort is recommended as the best general-purpose sorting algorithm. It offers O(n log n) average performance with excellent cache behavior. However, the parliament notes that merge sort may be preferred when stability is required or worst-case guarantees matter.",
    };

    const mockAdapter = createMockAdapter(mockResponses);

    vi.spyOn(mockAdapter, "complete").mockImplementation(
      async (messages: ChatMessage[]): Promise<CompletionResult> => {
        const userContent = messages.find((m) => m.role === "user")?.content ?? "";
        const systemContent = messages.find((m) => m.role === "system")?.content ?? "";

        let content: string;
        if (systemContent.includes("synthesizing")) {
          content = mockResponses["synthesis"];
        } else if (systemContent.includes("Dijkstra") || systemContent.includes("correctness")) {
          content = JSON.stringify({
            stance: "mixed",
            summary: "The choice depends on correctness requirements. Merge sort guarantees O(n log n) and is stable. Quicksort is faster in practice but requires careful implementation.",
            claims: [
              "Merge sort provides guaranteed O(n log n) worst case",
              "Stability matters for complex data structures",
            ],
            objections: ["Quicksort's worst case is avoidable but not guaranteed"],
            confidence: 4,
          });
        } else {
          content = JSON.stringify({
            stance: "support",
            summary: "Quicksort is the practical choice for most sorting needs. Its in-place operation and cache behavior outweigh theoretical concerns.",
            claims: [
              "Quicksort requires O(1) extra space vs O(n) for merge sort",
              "In practice, quicksort is 2-3x faster than merge sort on modern hardware",
            ],
            objections: [],
            confidence: 4,
          });
        }

        return {
          content,
          tokensUsed: { prompt: 100, completion: 200, total: 300 },
          model: "mock-model",
          latencyMs: 30,
        };
      },
    );

    const registry = new SeatRegistry();

    const mockPolicy = {
      isReady: () => true,
      primaryAdapter: mockAdapter,
      availableProviders: ["mock"],
      getSynthesisAdapter: () => mockAdapter,
      assignModel: (seat: any) => ({ seatId: seat.id, adapter: mockAdapter }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) map.set(s.id, { seatId: s.id, adapter: mockAdapter });
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) result[s.id] = "mock";
        return result;
      },
    };

    const speaker = Speaker.withPolicy(mockPolicy as any, registry);

    const response = await speaker.debate({
      prompt: "What is the best sorting algorithm?",
      mode: "micro" as const,
      taskType: "coding" as const,
      trace: "full" as const,
    });

    expect(response.finalAnswer).toBeTruthy();
    expect(response.finalAnswer.length).toBeGreaterThan(20);

    expect(["consensus", "majority", "split", "uncertain"]).toContain(
      response.decisionType,
    );

    expect(response.activatedSeats).toContain("Speaker");
    expect(response.activatedSeats.length).toBeGreaterThanOrEqual(3);

    expect(response.whyTheseSeats).toBeTruthy();
    expect(response.whyTheseSeats).toContain("coding");

    const validationResult = ParliamentResponse.safeParse(response);
    expect(validationResult.success).toBe(true);

    expect(response.traceArtifact).toBeDefined();
    if (response.traceArtifact) {
      expect(response.traceArtifact.rounds.length).toBeGreaterThanOrEqual(1);
      expect(response.traceArtifact.stopReason).toBeTruthy();

      const firstRound = response.traceArtifact.rounds[0];
      expect(firstRound.statements.length).toBeGreaterThanOrEqual(2);

      const stances = firstRound.statements.map((s) => s.stance);
      expect(stances.length).toBeGreaterThanOrEqual(2);

      const hasConvergenceData =
        firstRound.agreementRatio !== undefined &&
        firstRound.objectionCount !== undefined &&
        firstRound.distinctViewCount !== undefined;
      expect(hasConvergenceData).toBe(true);
    }
  });

  it("anti-fake-debate: seats produce distinct positions", async () => {
    const mockAdapter: ModelAdapter = {
      providerId: "mock",
      isAvailable: () => true,
      complete: async (messages: ChatMessage[]): Promise<CompletionResult> => {
        const systemContent = messages.find((m) => m.role === "system")?.content ?? "";

        let content: string;
        if (systemContent.includes("synthesizing")) {
          content = "Synthesis of the debate positions.";
        } else if (systemContent.includes("Security") || systemContent.includes("adversar")) {
          content = JSON.stringify({
            stance: "oppose",
            summary: "This approach has significant security risks that have not been addressed.",
            claims: ["API keys could be exposed", "No rate limiting proposed"],
            objections: ["The architecture lacks proper auth boundaries"],
            confidence: 5,
            warnings: ["Security vulnerability: no credential management plan"],
          });
        } else {
          content = JSON.stringify({
            stance: "support",
            summary: "The architecture is sound and well-structured.",
            claims: ["Clean separation of concerns", "Good testability"],
            objections: [],
            confidence: 4,
          });
        }

        return {
          content,
          tokensUsed: { prompt: 100, completion: 200, total: 300 },
          model: "mock-model",
          latencyMs: 30,
        };
      },
    };

    const registry = new SeatRegistry();
    const mockPolicy = {
      isReady: () => true,
      primaryAdapter: mockAdapter,
      availableProviders: ["mock"],
      getSynthesisAdapter: () => mockAdapter,
      assignModel: (seat: any) => ({ seatId: seat.id, adapter: mockAdapter }),
      assignAll: (seats: any[]) => {
        const map = new Map();
        for (const s of seats) map.set(s.id, { seatId: s.id, adapter: mockAdapter });
        return map;
      },
      describeAssignments: (seats: any[]) => {
        const result: Record<string, string> = {};
        for (const s of seats) result[s.id] = "mock";
        return result;
      },
    };

    const speaker = Speaker.withPolicy(mockPolicy as any, registry);

    const response = await speaker.debate({
      prompt: "How should we handle API key rotation and credential management?",
      mode: "fast" as const,
      taskType: "coding" as const,
      trace: "full" as const,
    });

    expect(response.traceArtifact).toBeDefined();
    const firstRound = response.traceArtifact!.rounds[0];
    const stances = new Set(firstRound.statements.map((s) => s.stance));
    expect(stances.size).toBeGreaterThanOrEqual(2);

    expect(response.warnings).toBeDefined();
    expect(response.warnings!.length).toBeGreaterThan(0);
  });
});
