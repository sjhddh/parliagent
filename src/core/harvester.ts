import { mkdirSync, appendFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { RoundResult } from "../contracts/trace.js";
import type { DecisionType } from "../contracts/response.js";
import type { ArgumentDAG } from "./argument-dag.js";

export interface ExhaustConversation {
  from: string;
  value: string;
}

export interface ExhaustEntry {
  id: string;
  prompt: string;
  decisionType: DecisionType;
  conversations: ExhaustConversation[];
  metadata: {
    rounds: number;
    seats: string[];
    attackedClaims: string[];
    abandonedClaims: string[];
    survivingClaims: string[];
    timestamp: number;
  };
}

const DEFAULT_EXHAUST_DIR = join(process.cwd(), ".parliagent", "exhaust");

export interface HarvesterConfig {
  enabled: boolean;
  directory: string;
}

export function defaultHarvesterConfig(): HarvesterConfig {
  const envVal = (process.env.PARLIAGENT_HARVEST ?? "").toLowerCase();
  return {
    enabled: envVal === "on" || envVal === "true" || envVal === "1",
    directory: process.env.PARLIAGENT_EXHAUST_DIR ?? DEFAULT_EXHAUST_DIR,
  };
}

/**
 * Harvest the "reasoning exhaust" from a debate: rejected arguments,
 * compromises, and the full chain-of-thought across seats.
 * Output is in ShareGPT-compatible JSONL format.
 */
export function harvestDebateExhaust(
  prompt: string,
  rounds: RoundResult[],
  decisionType: DecisionType,
  config: HarvesterConfig,
  dag?: ArgumentDAG,
): void {
  if (!config.enabled) return;

  try {
    mkdirSync(config.directory, { recursive: true });

    const conversations: ExhaustConversation[] = [];
    conversations.push({ from: "human", value: prompt });

    for (const round of rounds) {
      for (const stmt of round.statements) {
        const stmtValue = [
          `[${stmt.stance}] ${stmt.summary}`,
          `Claims: ${stmt.claims.join("; ")}`,
          stmt.objections.length > 0 ? `Objections: ${stmt.objections.join("; ")}` : "",
          `Confidence: ${stmt.confidenceScore ?? ((stmt.confidence - 1) / 4)}`,
        ]
          .filter(Boolean)
          .join("\n");
        conversations.push({ from: stmt.seatId, value: stmtValue });
      }
    }

    const attackedClaims: string[] = [];
    const survivingClaims: string[] = [];
    const abandonedClaims: string[] = [];

    if (dag) {
      const attackTargets = new Set(dag.edges.filter((e) => e.type === "attack").map((e) => e.to));
      for (const node of dag.nodes) {
        if (attackTargets.has(node.id)) {
          attackedClaims.push(node.claim);
          if (node.resilience > 0.5) {
            survivingClaims.push(node.claim);
          } else {
            abandonedClaims.push(node.claim);
          }
        } else if (node.resilience > 0.3) {
          survivingClaims.push(node.claim);
        }
      }
    }

    const allSeats = [...new Set(rounds.flatMap((r) => r.statements.map((s) => s.seatId)))];

    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    const timestamp = Date.now();

    const entry: ExhaustEntry = {
      id: `${hash}-${timestamp}`,
      prompt,
      decisionType,
      conversations,
      metadata: {
        rounds: rounds.length,
        seats: allSeats,
        attackedClaims,
        abandonedClaims,
        survivingClaims,
        timestamp,
      },
    };

    const filePath = join(config.directory, `${hash}-${timestamp}.jsonl`);
    appendFileSync(filePath, JSON.stringify(entry) + "\n");
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[parliagent] exhaust harvest failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
