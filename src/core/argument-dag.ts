import { createHash } from "crypto";
import type { ClaimProvenance, RoundResult } from "../contracts/trace.js";

export interface ArgumentNode {
  id: string;
  seatId: string;
  claim: string;
  provenance: ClaimProvenance;
  confidence: number;
  round: number;
  resilience: number;
}

export interface ArgumentEdge {
  from: string;
  to: string;
  type: "support" | "attack";
  strength: number;
}

export interface ArgumentDAG {
  nodes: ArgumentNode[];
  edges: ArgumentEdge[];
  criticalPath: string[];
}

function nodeId(seatId: string, round: number, claimIndex: number): string {
  const hash = createHash("sha256")
    .update(`${seatId}:${round}:${claimIndex}`)
    .digest("hex")
    .slice(0, 8);
  return `N-${hash}`;
}

/**
 * Compute text similarity between two strings using Unicode-safe word overlap.
 * Supports CJK, Cyrillic, Arabic and other non-Latin scripts.
 */
function textSimilarity(a: string, b: string): number {
  const wordsA = tokenizeUnicode(a);
  const wordsB = tokenizeUnicode(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  const intersection = [...wordsA].filter((w) => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size;
}

function tokenizeUnicode(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[\s,.;:!?'"()\[\]{}<>]+/).filter((w) => w.length > 1),
  );
}

/**
 * Build an argument DAG from completed debate rounds.
 * Claims become nodes, objections become attack edges,
 * and claims supporting similar claims become support edges.
 */
export function buildArgumentDAG(rounds: RoundResult[]): ArgumentDAG {
  const nodes: ArgumentNode[] = [];
  const edges: ArgumentEdge[] = [];
  const nodeMap = new Map<string, ArgumentNode>();

  for (const round of rounds) {
    for (const stmt of round.statements) {
      for (let ci = 0; ci < stmt.claims.length; ci++) {
        const id = nodeId(stmt.seatId, stmt.round, ci);
        const provenance: ClaimProvenance =
          stmt.claimProvenance?.[ci] ?? "inferred";
        const node: ArgumentNode = {
          id,
          seatId: stmt.seatId,
          claim: stmt.claims[ci],
          provenance,
          confidence: stmt.confidenceScore ?? ((stmt.confidence - 1) / 4),
          round: stmt.round,
          resilience: 0,
        };
        nodes.push(node);
        nodeMap.set(id, node);
      }
    }
  }

  for (const round of rounds) {
    for (const stmt of round.statements) {
      for (const objection of stmt.objections) {
        const target = findBestTarget(objection, nodes, stmt.seatId);
        if (target) {
          const sourceIndex = findBestSourceClaim(objection, stmt.claims);
          edges.push({
            from: nodeId(stmt.seatId, stmt.round, sourceIndex),
            to: target.id,
            type: "attack",
            strength: stmt.confidenceScore ?? ((stmt.confidence - 1) / 4),
          });
        }
      }
    }
  }

  buildSupportEdges(nodes, edges);

  computeResilience(nodes, edges);

  const criticalPath = extractCriticalPath(nodes, edges);

  return { nodes, edges, criticalPath };
}

function findBestSourceClaim(objection: string, claims: string[]): number {
  if (claims.length <= 1) return 0;
  let bestIndex = 0;
  let bestScore = -1;
  for (let i = 0; i < claims.length; i++) {
    const score = textSimilarity(objection, claims[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function findBestTarget(
  objection: string,
  nodes: ArgumentNode[],
  excludeSeatId: string,
): ArgumentNode | undefined {
  let best: ArgumentNode | undefined;
  let bestScore = 0;

  for (const node of nodes) {
    if (node.seatId === excludeSeatId) continue;
    const score = textSimilarity(objection, node.claim);
    if (score > bestScore && score > 0.15) {
      bestScore = score;
      best = node;
    }
  }
  return best;
}

function buildSupportEdges(nodes: ArgumentNode[], edges: ArgumentEdge[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[i].seatId === nodes[j].seatId) continue;
      const sim = textSimilarity(nodes[i].claim, nodes[j].claim);
      if (sim > 0.35) {
        const [earlier, later] = nodes[i].round <= nodes[j].round
          ? [nodes[i], nodes[j]]
          : [nodes[j], nodes[i]];
        edges.push({
          from: earlier.id,
          to: later.id,
          type: "support",
          strength: sim,
        });
      }
    }
  }
}

/**
 * Proof of Logic: a node's resilience depends on its own confidence,
 * the support it receives, and the attacks it withstands.
 */
function computeResilience(nodes: ArgumentNode[], edges: ArgumentEdge[]): void {
  const attacksOn = new Map<string, number>();
  const supportsOn = new Map<string, number>();

  for (const edge of edges) {
    if (edge.type === "attack") {
      attacksOn.set(edge.to, (attacksOn.get(edge.to) ?? 0) + edge.strength);
    } else {
      supportsOn.set(edge.to, (supportsOn.get(edge.to) ?? 0) + edge.strength);
    }
  }

  for (const node of nodes) {
    const attacks = attacksOn.get(node.id) ?? 0;
    const supports = supportsOn.get(node.id) ?? 0;
    node.resilience = node.confidence * (1 + supports) / (1 + attacks);
  }
}

/**
 * Extract the critical path: follow the highest-resilience nodes
 * connected by support edges from the strongest root.
 */
function extractCriticalPath(nodes: ArgumentNode[], edges: ArgumentEdge[]): string[] {
  if (nodes.length === 0) return [];

  const sorted = [...nodes].sort((a, b) => b.resilience - a.resilience);
  const supportEdges = edges.filter((e) => e.type === "support");

  const adjacency = new Map<string, string[]>();
  for (const edge of supportEdges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from)!.push(edge.to);
  }

  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = sorted[0]?.id;

  while (current && !visited.has(current)) {
    visited.add(current);
    path.push(current);

    const neighbors = adjacency.get(current) ?? [];
    let bestNext: string | undefined;
    let bestResilience = -1;

    for (const neighbor of neighbors) {
      const node = nodes.find((n) => n.id === neighbor);
      if (node && !visited.has(node.id) && node.resilience > bestResilience) {
        bestResilience = node.resilience;
        bestNext = node.id;
      }
    }

    current = bestNext;
  }

  return path;
}

/**
 * Serialize the critical path into a human-readable summary.
 */
export function describeCriticalPath(dag: ArgumentDAG): string {
  if (dag.criticalPath.length === 0) return "No critical path identified.";

  const nodeMap = new Map(dag.nodes.map((n) => [n.id, n]));
  return dag.criticalPath
    .map((id, i) => {
      const node = nodeMap.get(id);
      if (!node) return `${i + 1}. (unknown)`;
      return `${i + 1}. [${node.seatId}, r${node.round}] ${node.claim} (resilience: ${node.resilience.toFixed(2)})`;
    })
    .join("\n");
}
