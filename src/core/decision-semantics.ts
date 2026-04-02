import type { DecisionType } from "../contracts/response.js";
import type { RoundResult, SeatStatement, StopReason } from "../contracts/trace.js";

/**
 * Derive decision type from dispute state and stance alignment.
 * In large chambers, unresolved pairwise disputes can remain high even when
 * directional agreement is strong. We model that state as majority, not uncertain.
 */
export function determineDecisionType(lastRound?: RoundResult): DecisionType {
  if (!lastRound) return "uncertain";

  const total = lastRound.disagreements.length;
  const resolved = lastRound.resolvedCount ?? 0;
  const splits = lastRound.acceptedSplitCount ?? 0;
  const unresolved = lastRound.unresolvedCount ?? 0;
  const ratio = lastRound.agreementRatio;
  const objectionCount = lastRound.objectionCount;
  const distinctViewCount = lastRound.distinctViewCount;
  const unresolvedRatio = total > 0 ? unresolved / total : 0;

  // Fully closed disputes with no accepted split.
  if (total > 0 && unresolved === 0 && splits === 0) return "consensus";
  // Fully closed but some accepted splits indicates residual disagreement.
  if (total > 0 && unresolved === 0 && splits > 0) return "majority";

  // Strong directional alignment with low objections.
  if (ratio >= 0.85 && objectionCount === 0 && unresolvedRatio <= 0.35) {
    return "consensus";
  }

  // Majority with reservations: high alignment but unresolved issues remain.
  if (ratio >= 0.7) {
    return "majority";
  }

  // Medium alignment in large chambers should avoid over-collapsing to uncertain.
  if (ratio >= 0.6 && distinctViewCount <= 3) {
    return "majority";
  }

  if (total > 0 && resolved + splits > unresolved) return "split";
  if (distinctViewCount >= 3 || ratio < 0.45) return "uncertain";
  return "split";
}

export function buildMinorityReport(
  statements: SeatStatement[],
  decisionType: DecisionType,
): string | undefined {
  if (decisionType === "consensus") return undefined;

  const weightedStances = statements.reduce<Record<string, number>>(
    (acc, s) => {
      const weight = s.confidenceScore ?? ((s.confidence - 1) / 4);
      acc[s.stance] = (acc[s.stance] ?? 0) + weight;
      return acc;
    },
    {},
  );

  const majorityStance = Object.entries(weightedStances).sort((a, b) => b[1] - a[1])[0]?.[0];
  const minorities = statements.filter((s) => s.stance !== majorityStance && s.stance !== "uncertain");
  if (minorities.length === 0) return undefined;

  return minorities
    .map((s) => `${s.seatId} (${s.stance}): ${s.summary} [${s.claims.join("; ")}]`)
    .join("\n");
}

export function extractOpenQuestions(rounds: RoundResult[]): string[] {
  const lastRound = rounds[rounds.length - 1];
  if (!lastRound) return [];
  return lastRound.disagreements.filter((d) => d.status === "open").map((d) => d.topic);
}

export function extractWarnings(rounds: RoundResult[]): string[] {
  const warnings = new Set<string>();
  for (const round of rounds) {
    for (const stmt of round.statements) {
      stmt.warnings?.forEach((w) => warnings.add(w));
    }
  }
  return Array.from(warnings);
}

export function buildDebateSummary(rounds: RoundResult[], stopReason: StopReason): string {
  const lines: string[] = [];
  for (const round of rounds) {
    const stageLabel = round.stage ? ` [${round.stage}]` : "";
    lines.push(`Round ${round.round}${stageLabel}:`);
    for (const stmt of round.statements) {
      lines.push(`  ${stmt.seatId}: ${stmt.stance} (confidence ${stmt.confidence}/5) — ${stmt.summary}`);
    }
    lines.push(`  Agreement: ${Math.round(round.agreementRatio * 100)}%, Objections: ${round.objectionCount}`);
    if (round.resolvedCount !== undefined) {
      lines.push(
        `  Issues: ${round.resolvedCount} resolved, ${round.acceptedSplitCount ?? 0} accepted splits, ${round.unresolvedCount ?? 0} unresolved`,
      );
    }
    if (round.parseRecoveryCount !== undefined || round.degradedParseCount !== undefined) {
      lines.push(
        `  Structured output: ${round.parseRecoveryCount ?? 0} retries, ${round.degradedParseCount ?? 0} degraded`,
      );
    }
  }
  lines.push(`\nStopped: ${stopReason}`);
  return lines.join("\n");
}

export function buildFallbackSynthesis(rounds: RoundResult[], decisionType: DecisionType): string {
  const lastRound = rounds[rounds.length - 1];
  if (!lastRound) return "No debate data available.";
  const claims = lastRound.statements.flatMap((s) => s.claims);
  return `Decision: ${decisionType}. Key points: ${claims.join(". ")}`;
}
