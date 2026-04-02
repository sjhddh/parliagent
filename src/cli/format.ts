import chalk from "chalk";
import type { ParliagentResponse } from "../contracts/response.js";
import type { DebateEvent } from "../core/events.js";
import { SPEAKER_SEAT_ID } from "../core/speaker.js";

export function formatResponse(
  response: ParliagentResponse,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify(response, null, 2);
  }

  const lines: string[] = [];

  lines.push(chalk.bold.cyan("\n━━━ Parliagent ━━━\n"));

  lines.push(chalk.bold("Answer:"));
  lines.push(response.finalAnswer);
  lines.push("");

  const decisionColors: Record<string, (s: string) => string> = {
    consensus: chalk.green,
    majority: chalk.yellow,
    split: chalk.red,
    uncertain: chalk.gray,
  };
  const colorFn = decisionColors[response.decisionType] ?? chalk.white;
  lines.push(
    chalk.bold("Decision: ") + colorFn(response.decisionType.toUpperCase()),
  );

  lines.push(
    chalk.bold("Seats: ") +
      response.activatedSeats
        .filter((s) => s !== SPEAKER_SEAT_ID)
        .join(", "),
  );

  lines.push(chalk.dim("Routing: " + response.whyTheseSeats));

  if (response.minorityReport) {
    lines.push("");
    lines.push(chalk.bold.yellow("Minority Report:"));
    lines.push(response.minorityReport);
  }

  if (response.openQuestions && response.openQuestions.length > 0) {
    lines.push("");
    lines.push(chalk.bold("Open Questions:"));
    response.openQuestions.forEach((q) => lines.push(`  • ${q}`));
  }

  if (response.warnings && response.warnings.length > 0) {
    lines.push("");
    lines.push(chalk.bold.red("⚠ Warnings:"));
    response.warnings.forEach((w) => lines.push(`  ${chalk.red("•")} ${w}`));
  }

  if (response.debateSummary) {
    lines.push("");
    lines.push(chalk.bold.dim("Debate Summary:"));
    lines.push(chalk.dim(response.debateSummary));
  }

  lines.push(chalk.bold.cyan("\n━━━━━━━━━━━━━━━━━━━━━\n"));

  return lines.join("\n");
}

const STANCE_ICONS: Record<string, string> = {
  support: chalk.green("✓"),
  oppose: chalk.red("✗"),
  mixed: chalk.yellow("◐"),
  uncertain: chalk.gray("?"),
};

export function formatStreamEvent(event: DebateEvent): string | undefined {
  switch (event.type) {
    case "seat_selected":
      return chalk.dim(`  Chamber: ${event.seats.filter((s) => s !== SPEAKER_SEAT_ID).join(", ")}`);
    case "round_start":
      return chalk.bold(`\n  Round ${event.round} [${event.stage}]`);
    case "seat_speaking":
      return chalk.dim(`    [${event.seatId}] thinking...`);
    case "seat_responded": {
      const icon = STANCE_ICONS[event.statement.stance] ?? "";
      const conf = (event.statement.confidenceScore ?? ((event.statement.confidence - 1) / 4)).toFixed(2);
      return `    ${icon} ${chalk.bold(`[${event.seatId}]`)} (${event.statement.stance}, ${conf}): ${event.statement.summary}`;
    }
    case "objection_raised":
      return chalk.yellow(`      ⚡ Objection from [${event.seatId}]: ${event.objection}`);
    case "round_complete":
      return chalk.dim(`    Agreement: ${Math.round(event.result.agreementRatio * 100)}%, Objections: ${event.result.objectionCount}`);
    case "consensus_reached": {
      const dColors: Record<string, (s: string) => string> = {
        consensus: chalk.green, majority: chalk.yellow,
        split: chalk.red, uncertain: chalk.gray,
      };
      const fn = dColors[event.decisionType] ?? chalk.white;
      return `\n  ${chalk.bold("Decision:")} ${fn(event.decisionType.toUpperCase())}`;
    }
    case "debate_end":
      return chalk.dim(`  Stopped: ${event.reason}`);
    case "synthesis_start":
      return chalk.dim("  Synthesizing final answer...");
    case "synthesis_complete":
      return undefined;
    case "cache_hit":
      return chalk.dim("  Cache hit — returning cached result");
    default:
      return undefined;
  }
}
