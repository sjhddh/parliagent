import chalk from "chalk";
import type { ParliagentResponse } from "../contracts/response.js";

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
        .filter((s) => s !== "Speaker")
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

export function formatProgress(message: string): void {
  process.stderr.write(chalk.dim(`  ${message}\n`));
}
