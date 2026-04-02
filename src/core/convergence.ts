import type { SeatStatement, DisagreementRecord, RoundResult } from "../contracts/trace.js";
import type { ModeConfig } from "./config.js";

export interface ConvergenceInput {
  statements: SeatStatement[];
  modeConfig: ModeConfig;
  currentRound: number;
}

export interface ConvergenceResult {
  shouldStop: boolean;
  reason: "converged" | "round_limit" | "blocking_warning" | null;
  roundResult: RoundResult;
}

/**
 * Extract disagreements by comparing claims and stances across seats.
 */
export function extractDisagreements(
  statements: SeatStatement[],
): DisagreementRecord[] {
  const disagreements: DisagreementRecord[] = [];

  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i];
      const b = statements[j];

      if (
        (a.stance === "support" && b.stance === "oppose") ||
        (a.stance === "oppose" && b.stance === "support")
      ) {
        disagreements.push({
          topic: `Opposing stances on core question`,
          seats: [a.seatId, b.seatId],
          type: "claim_conflict",
          status: "open",
        });
      }
    }
  }

  for (const stmt of statements) {
    if (stmt.objections.length > 0) {
      for (const objection of stmt.objections) {
        const targets = statements
          .filter((s) => s.seatId !== stmt.seatId)
          .map((s) => s.seatId);
        if (targets.length > 0) {
          disagreements.push({
            topic: objection,
            seats: [stmt.seatId, targets[0]],
            type: "claim_conflict",
            status: "open",
          });
        }
      }
    }

    if (stmt.warnings && stmt.warnings.length > 0) {
      disagreements.push({
        topic: stmt.warnings.join("; "),
        seats: [stmt.seatId],
        type: "risk_warning",
        status: "open",
      });
    }
  }

  return deduplicateDisagreements(disagreements);
}

function deduplicateDisagreements(
  records: DisagreementRecord[],
): DisagreementRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${r.type}:${r.seats.sort().join(",")}:${r.topic.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Compute round-level convergence metrics.
 */
export function computeRoundResult(
  round: number,
  statements: SeatStatement[],
): RoundResult {
  const disagreements = extractDisagreements(statements);

  const stances = statements.map((s) => s.stance);
  const supportCount = stances.filter((s) => s === "support").length;
  const opposeCount = stances.filter((s) => s === "oppose").length;
  const mixedCount = stances.filter((s) => s === "mixed").length;

  const totalSeats = statements.length;
  const agreementRatio =
    totalSeats > 0
      ? Math.max(supportCount, opposeCount, mixedCount) / totalSeats
      : 0;

  const objectionCount = statements.reduce(
    (sum, s) => sum + s.objections.length,
    0,
  );

  const blockingWarning = statements.some(
    (s) => s.warnings && s.warnings.length > 0,
  );

  const allClaims = statements.flatMap((s) => s.claims);
  const claimClusters = countDistinctClusters(allClaims);
  const stanceCount = new Set(stances.filter((s) => s !== "uncertain")).size;
  const distinctViewCount = Math.max(1, stanceCount, claimClusters);

  return {
    round,
    statements,
    disagreements,
    agreementRatio: Math.round(agreementRatio * 100) / 100,
    objectionCount,
    distinctViewCount,
    blockingWarning,
  };
}

/**
 * V1 stopping heuristic — explicit, inspectable, tunable.
 */
export function evaluateConvergence(
  input: ConvergenceInput,
): ConvergenceResult {
  const roundResult = computeRoundResult(input.currentRound, input.statements);

  if (
    roundResult.blockingWarning &&
    roundResult.agreementRatio < 0.5
  ) {
    return {
      shouldStop: true,
      reason: "blocking_warning",
      roundResult,
    };
  }

  if (
    roundResult.agreementRatio >= input.modeConfig.targetAgreementRatio &&
    roundResult.objectionCount <= 1
  ) {
    return {
      shouldStop: true,
      reason: "converged",
      roundResult,
    };
  }

  if (
    roundResult.distinctViewCount <= 1 &&
    roundResult.objectionCount === 0
  ) {
    return {
      shouldStop: true,
      reason: "converged",
      roundResult,
    };
  }

  if (input.currentRound >= input.modeConfig.maxRounds) {
    return {
      shouldStop: true,
      reason: "round_limit",
      roundResult,
    };
  }

  return {
    shouldStop: false,
    reason: null,
    roundResult,
  };
}

/**
 * Naive claim clustering by word overlap.
 * Counts how many materially distinct claim groups exist.
 */
function countDistinctClusters(claims: string[]): number {
  if (claims.length === 0) return 0;

  const normalized = claims.map((c) =>
    new Set(c.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/)),
  );

  const clusters: number[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < normalized.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [i];
    assigned.add(i);

    for (let j = i + 1; j < normalized.length; j++) {
      if (assigned.has(j)) continue;
      const overlap = jaccardSimilarity(normalized[i], normalized[j]);
      if (overlap > 0.4) {
        cluster.push(j);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters.length;
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
