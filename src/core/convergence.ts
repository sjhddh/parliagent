import type { SeatStatement, DisagreementRecord, RoundResult, AgendaStage } from "../contracts/trace.js";
import type { ModeConfig } from "./config.js";
import { randomBytes } from "crypto";

export interface ConvergenceInput {
  statements: SeatStatement[];
  modeConfig: ModeConfig;
  currentRound: number;
  priorDisagreements?: DisagreementRecord[];
  stage?: AgendaStage;
}

export interface ConvergenceResult {
  shouldStop: boolean;
  reason: "converged" | "round_limit" | "blocking_warning" | "issues_resolved" | null;
  roundResult: RoundResult;
}

function makeDisputeId(): string {
  return `D-${randomBytes(4).toString("hex")}`;
}

/**
 * Extract disagreements from current-round statements, then reconcile
 * with prior-round disputes to track lifecycle transitions.
 */
export function extractDisagreements(
  statements: SeatStatement[],
  priorDisagreements?: DisagreementRecord[],
): DisagreementRecord[] {
  const currentRaw = extractRawDisagreements(statements);
  if (!priorDisagreements || priorDisagreements.length === 0) {
    return currentRaw.map((d) => ({ ...d, id: d.id ?? makeDisputeId() }));
  }

  return reconcileDisagreements(currentRaw, priorDisagreements, statements);
}

function extractRawDisagreements(statements: SeatStatement[]): DisagreementRecord[] {
  const disagreements: DisagreementRecord[] = [];

  for (let i = 0; i < statements.length; i++) {
    for (let j = i + 1; j < statements.length; j++) {
      const a = statements[i];
      const b = statements[j];

      if (
        (a.stance === "support" && b.stance === "oppose") ||
        (a.stance === "oppose" && b.stance === "support")
      ) {
        const topic = buildConflictTopic(a, b);
        disagreements.push({
          topic,
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

function buildConflictTopic(a: SeatStatement, b: SeatStatement): string {
  const aClaims = a.claims.join(", ").slice(0, 60);
  const bClaims = b.claims.join(", ").slice(0, 60);
  return `${a.seatId} vs ${b.seatId}: ${aClaims} ↔ ${bClaims}`;
}

/**
 * Reconcile current-round raw disputes with prior-round disputes.
 * Determines lifecycle transitions: open → resolved or accepted_split.
 */
function reconcileDisagreements(
  currentRaw: DisagreementRecord[],
  priorDisagreements: DisagreementRecord[],
  statements: SeatStatement[],
): DisagreementRecord[] {
  const stanceMap = new Map(statements.map((s) => [s.seatId, s]));
  const result: DisagreementRecord[] = [];

  for (const prior of priorDisagreements) {
    if (prior.status === "resolved" || prior.status === "accepted_split") {
      result.push(prior);
      continue;
    }

    const involvedSeats = prior.seats;
    const involvedStatements = involvedSeats
      .map((id) => stanceMap.get(id))
      .filter((s): s is SeatStatement => s !== undefined);

    if (involvedStatements.length < 2 && prior.type === "claim_conflict") {
      result.push(prior);
      continue;
    }

    if (prior.type === "claim_conflict" && involvedStatements.length >= 2) {
      const stances = new Set(involvedStatements.map((s) => s.stance));

      const allMixed = involvedStatements.every((s) => s.stance === "mixed");
      if (allMixed) {
        result.push({ ...prior, status: "accepted_split" });
        continue;
      }

      if (stances.size === 1 && !stances.has("uncertain") && !stances.has("mixed")) {
        result.push({ ...prior, status: "resolved" });
        continue;
      }

      const hasOpposing =
        involvedStatements.some((s) => s.stance === "support") &&
        involvedStatements.some((s) => s.stance === "oppose");

      if (!hasOpposing) {
        result.push({ ...prior, status: "accepted_split" });
        continue;
      }
    }

    if (prior.type === "risk_warning") {
      const warningStmt = stanceMap.get(prior.seats[0]);
      if (warningStmt && (!warningStmt.warnings || warningStmt.warnings.length === 0)) {
        result.push({ ...prior, status: "resolved" });
        continue;
      }
    }

    result.push({ ...prior, status: "open" });
  }

  const priorKeys = new Set(
    priorDisagreements.map((d) => normalizeDisputeKey(d)),
  );

  for (const current of currentRaw) {
    const key = normalizeDisputeKey(current);
    if (!priorKeys.has(key)) {
      result.push({ ...current, id: current.id ?? makeDisputeId() });
    }
  }

  return result;
}

function normalizeDisputeKey(d: DisagreementRecord): string {
  return `${d.type}:${[...d.seats].sort().join(",")}:${d.topic.slice(0, 50)}`;
}

function deduplicateDisagreements(
  records: DisagreementRecord[],
): DisagreementRecord[] {
  const seen = new Set<string>();
  return records.filter((r) => {
    const key = `${r.type}:${[...r.seats].sort().join(",")}:${r.topic.slice(0, 50)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Compute round-level convergence metrics including resolution tracking.
 */
export function computeRoundResult(
  round: number,
  statements: SeatStatement[],
  priorDisagreements?: DisagreementRecord[],
  stage?: AgendaStage,
): RoundResult {
  const disagreements = extractDisagreements(statements, priorDisagreements);

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

  const resolvedCount = disagreements.filter((d) => d.status === "resolved").length;
  const acceptedSplitCount = disagreements.filter((d) => d.status === "accepted_split").length;
  const unresolvedCount = disagreements.filter((d) => d.status === "open").length;

  return {
    round,
    ...(stage ? { stage } : {}),
    statements,
    disagreements,
    agreementRatio: Math.round(agreementRatio * 100) / 100,
    objectionCount,
    distinctViewCount,
    blockingWarning,
    resolvedCount,
    acceptedSplitCount,
    unresolvedCount,
  };
}

/**
 * Issue-level convergence: stops when disputes are resolved or stabilized,
 * not just when stance ratios look favorable.
 */
export function evaluateConvergence(
  input: ConvergenceInput,
): ConvergenceResult {
  const roundResult = computeRoundResult(
    input.currentRound,
    input.statements,
    input.priorDisagreements,
    input.stage,
  );

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

  const totalDisputes = roundResult.disagreements.length;
  const unresolved = roundResult.unresolvedCount ?? 0;

  if (totalDisputes > 0 && unresolved === 0) {
    return {
      shouldStop: true,
      reason: "issues_resolved",
      roundResult,
    };
  }

  if (unresolved === 0) {
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
 * Identify seats involved in the top unresolved disputes for targeted exchange.
 */
export function getDisputeParticipants(
  disagreements: DisagreementRecord[],
  maxDisputes: number = 3,
): string[] {
  const resolvableTypes = new Set(["claim_conflict", "risk_warning", "priority_conflict"]);
  const open = disagreements.filter((d) => d.status === "open" && resolvableTypes.has(d.type));
  const topDisputes = open.slice(0, maxDisputes);
  const seatSet = new Set<string>();
  for (const d of topDisputes) {
    for (const s of d.seats) seatSet.add(s);
  }
  return Array.from(seatSet);
}

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
