import { Command } from "commander";
import chalk from "chalk";
import { classifyTask, selectChamber } from "../../core/routing.js";
import { MODE_CONFIGS } from "../../core/config.js";
import { defaultRegistry } from "../../seats/registry.js";
import { checkSafetyBoundaries } from "../../core/safety.js";
import type { DebateMode, TaskType } from "../../contracts/request.js";

export const inspectCommand = new Command("inspect")
  .description("Explain routing decisions without running a debate")
  .argument("<prompt>", "The prompt to inspect")
  .option("--mode <mode>", "Debate mode to inspect", "micro")
  .option("--task <type>", "Override task type classification")
  .option("--seat <seats...>", "Seat hints to apply")
  .option("--exclude-seat <seats...>", "Seats to exclude")
  .option("--json", "JSON output", false)
  .action((prompt: string, opts: Record<string, unknown>) => {
    const mode = (opts.mode as DebateMode) ?? "micro";
    const taskType = opts.task as TaskType | undefined;
    const seatHints = opts.seat as string[] | undefined;
    const excludeSeats = opts.excludeSeat as string[] | undefined;

    const classifiedType = taskType ?? classifyTask(prompt);
    const modeConfig = MODE_CONFIGS[mode];

    const routing = selectChamber(
      prompt,
      mode,
      taskType,
      seatHints,
      excludeSeats,
    );

    const safetyWarnings = checkSafetyBoundaries(prompt);

    const seatDetails = routing.selectedSeatIds
      .filter((id) => id !== "Speaker")
      .map((id) => {
        const seat = defaultRegistry.get(id);
        return seat
          ? { id: seat.id, role: seat.role, category: seat.category }
          : { id, role: "unknown", category: "unknown" };
      });

    if (opts.json) {
      console.log(
        JSON.stringify(
          {
            prompt: prompt.slice(0, 200),
            classifiedTaskType: classifiedType,
            mode,
            modeConfig,
            selectedSeats: seatDetails,
            routingReason: routing.routingReason,
            safetyWarnings,
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(chalk.bold.cyan("\n━━━ Sun Parliament — Inspect ━━━\n"));
    console.log(chalk.bold("Prompt: ") + chalk.dim(prompt.slice(0, 120) + (prompt.length > 120 ? "..." : "")));
    console.log(chalk.bold("Classified as: ") + chalk.yellow(classifiedType));
    console.log(chalk.bold("Mode: ") + `${mode} (${modeConfig.seatCount.min}-${modeConfig.seatCount.max} seats, max ${modeConfig.maxRounds} rounds)`);
    console.log(chalk.bold("Budget: ") + `${modeConfig.defaultMaxTokens} tokens / ${modeConfig.defaultMaxLatencyMs}ms`);
    console.log(chalk.bold("Convergence target: ") + `${Math.round(modeConfig.targetAgreementRatio * 100)}% agreement`);

    console.log(chalk.bold("\nSelected Chamber:"));
    for (const seat of seatDetails) {
      console.log(`  ${chalk.green("•")} ${chalk.bold(seat.id)} — ${seat.role} ${chalk.dim(`[${seat.category}]`)}`);
    }

    console.log(chalk.bold("\nRouting Reason:"));
    console.log(chalk.dim("  " + routing.routingReason));

    if (safetyWarnings.length > 0) {
      console.log(chalk.bold.red("\nSafety Warnings:"));
      safetyWarnings.forEach((w) => console.log(`  ${chalk.red("⚠")} ${w}`));
    }

    console.log(chalk.bold.cyan("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n"));
  });
