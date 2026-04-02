import type { SeatProfile, SubstratePolicy } from "../contracts/seats.js";
import type { ExecutionProfile } from "../contracts/request.js";
import type { ModelAdapter } from "./adapter.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { GoogleAdapter } from "./providers/google.js";
import { FlockAdapter } from "./providers/flock.js";

export interface ModelAssignment {
  seatId: string;
  adapter: ModelAdapter;
  resolvedVia: string;
}

export interface RuntimeConfig {
  openai?: { apiKey?: string; baseUrl?: string; defaultModel?: string };
  anthropic?: { apiKey?: string; defaultModel?: string };
  google?: { apiKey?: string; defaultModel?: string };
  flock?: { apiKey?: string; baseUrl?: string; defaultModel?: string };
  primaryProvider?: "openai" | "anthropic" | "google" | "flock";
  supremeProvider?: "openai" | "anthropic" | "google" | "flock";
}

const DEFAULT_SUBSTRATE: SubstratePolicy = {
  preferredProvider: "primary",
  fallbackChain: ["primary", "any-available"],
  modelClass: "frontier",
};

/**
 * Resolves which model adapter each seat uses, respecting execution profiles
 * and per-seat substrate policies with deterministic fallback chains.
 *
 * - `available`: seats follow their fallback chain with whatever providers exist
 * - `federated`: provider-native seats (OpenAI/Claude/Gemini) prefer their own family;
 *                others use primary
 * - `supreme`: all debate seats + synthesis use the single strongest configured model
 */
export class ModelPolicy {
  private adapters: Map<string, ModelAdapter>;
  private primaryProviderId: string;
  private supremeProviderId: string;

  constructor(config: RuntimeConfig = {}) {
    this.adapters = new Map();

    const openai = new OpenAIAdapter(config.openai);
    const anthropic = new AnthropicAdapter(config.anthropic);
    const google = new GoogleAdapter(config.google);
    const flock = new FlockAdapter(config.flock);

    if (openai.isAvailable()) this.adapters.set("openai", openai);
    if (anthropic.isAvailable()) this.adapters.set("anthropic", anthropic);
    if (google.isAvailable()) this.adapters.set("google", google);
    if (flock.isAvailable()) this.adapters.set("flock", flock);

    this.primaryProviderId =
      config.primaryProvider ??
      (anthropic.isAvailable()
        ? "anthropic"
        : openai.isAvailable()
          ? "openai"
          : flock.isAvailable()
            ? "flock"
            : google.isAvailable()
              ? "google"
              : "none");

    this.supremeProviderId =
      config.supremeProvider ?? this.primaryProviderId;
  }

  get primaryAdapter(): ModelAdapter | undefined {
    return this.adapters.get(this.primaryProviderId);
  }

  get supremeAdapter(): ModelAdapter | undefined {
    return this.adapters.get(this.supremeProviderId) ?? this.primaryAdapter;
  }

  get availableProviders(): string[] {
    return Array.from(this.adapters.keys());
  }

  isReady(): boolean {
    return this.adapters.size > 0;
  }

  /**
   * Get the adapter used for synthesis under the given profile.
   * Supreme uses the supreme adapter; others use primary.
   */
  getSynthesisAdapter(profile: ExecutionProfile): ModelAdapter | undefined {
    if (profile === "supreme") return this.supremeAdapter;
    return this.primaryAdapter;
  }

  /**
   * Resolve a single seat's model assignment under the given execution profile.
   */
  assignModel(
    seat: SeatProfile,
    profile: ExecutionProfile = "available",
  ): ModelAssignment {
    if (profile === "supreme") {
      return this.assignSupreme(seat);
    }

    const substrate = seat.substrate ?? DEFAULT_SUBSTRATE;

    if (profile === "federated") {
      return this.assignFederated(seat, substrate);
    }

    return this.assignAvailable(seat, substrate);
  }

  assignAll(
    seats: SeatProfile[],
    profile: ExecutionProfile = "available",
  ): Map<string, ModelAssignment> {
    const assignments = new Map<string, ModelAssignment>();
    for (const seat of seats) {
      assignments.set(seat.id, this.assignModel(seat, profile));
    }
    return assignments;
  }

  describeAssignments(
    seats: SeatProfile[],
    profile: ExecutionProfile = "available",
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const seat of seats) {
      const assignment = this.assignModel(seat, profile);
      result[seat.id] = `${assignment.adapter.providerId} (${assignment.resolvedVia})`;
    }
    return result;
  }

  // --- Private resolution strategies ---

  private assignSupreme(seat: SeatProfile): ModelAssignment {
    const adapter = this.supremeAdapter;
    if (!adapter) {
      throw new Error("No model provider available for supreme profile.");
    }
    return { seatId: seat.id, adapter, resolvedVia: "supreme" };
  }

  private assignFederated(
    seat: SeatProfile,
    substrate: SubstratePolicy,
  ): ModelAssignment {
    if (substrate.preferredProvider !== "primary") {
      const native = this.adapters.get(substrate.preferredProvider);
      if (native) {
        return { seatId: seat.id, adapter: native, resolvedVia: "federated-native" };
      }
    }

    return this.resolveFallbackChain(seat, substrate);
  }

  private assignAvailable(
    seat: SeatProfile,
    substrate: SubstratePolicy,
  ): ModelAssignment {
    return this.resolveFallbackChain(seat, substrate);
  }

  /**
   * Walk the seat's fallback chain until we find an available adapter.
   * Deterministic: same configuration always yields same assignment.
   */
  private resolveFallbackChain(
    seat: SeatProfile,
    substrate: SubstratePolicy,
  ): ModelAssignment {
    for (const step of substrate.fallbackChain) {
      switch (step) {
        case "preferred": {
          if (substrate.preferredProvider !== "primary") {
            const adapter = this.adapters.get(substrate.preferredProvider);
            if (adapter) {
              return { seatId: seat.id, adapter, resolvedVia: "preferred" };
            }
          } else {
            const adapter = this.primaryAdapter;
            if (adapter) {
              return { seatId: seat.id, adapter, resolvedVia: "preferred-as-primary" };
            }
          }
          break;
        }
        case "primary": {
          const adapter = this.primaryAdapter;
          if (adapter) {
            return { seatId: seat.id, adapter, resolvedVia: "primary" };
          }
          break;
        }
        case "any-available": {
          const first = this.adapters.values().next().value;
          if (first) {
            return { seatId: seat.id, adapter: first, resolvedVia: "any-available" };
          }
          break;
        }
      }
    }

    throw new Error(
      `No model provider available for seat ${seat.id}. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, or FLOCK_API_KEY.`,
    );
  }
}
