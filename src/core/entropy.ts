import type { RoundResult } from "../contracts/trace.js";

const DEFAULT_STAGNATION_THRESHOLD = 0.15;

/**
 * Tokenize claims and objections into a normalized word set for comparison.
 */
function tokenizeRound(round: RoundResult): Set<string> {
  const tokens = new Set<string>();
  for (const stmt of round.statements) {
    for (const claim of stmt.claims) {
      for (const word of normalizeText(claim)) tokens.add(word);
    }
    for (const obj of stmt.objections) {
      for (const word of normalizeText(obj)) tokens.add(word);
    }
  }
  return tokens;
}

function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,.;:!?'"()\[\]{}<>]+/)
    .filter((w) => w.length > 1);
}

function jaccardDistance(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return 1 - (intersection.size / union.size);
}

/**
 * Compute information gain between the current round and the previous round.
 * Returns the Jaccard distance of their argument token sets.
 * A low value (< threshold) means the debate is logically stagnant.
 */
export function computeInformationGain(
  currentRound: RoundResult,
  previousRound: RoundResult,
): number {
  const current = tokenizeRound(currentRound);
  const previous = tokenizeRound(previousRound);
  return jaccardDistance(current, previous);
}

/**
 * Check whether the debate has become logically stagnant.
 * Returns true if the information gain between rounds is below the threshold,
 * meaning new rounds are just rephrasing old arguments.
 */
export function isEntropyConverged(
  rounds: RoundResult[],
  threshold: number = DEFAULT_STAGNATION_THRESHOLD,
): boolean {
  if (rounds.length < 2) return false;
  const current = rounds[rounds.length - 1];
  const previous = rounds[rounds.length - 2];
  const gain = computeInformationGain(current, previous);
  return gain < threshold;
}
