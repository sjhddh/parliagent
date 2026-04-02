import { Command } from "commander";
import chalk from "chalk";
import { defaultRegistry } from "../../seats/registry.js";

export const seatsCommand = new Command("seats")
  .description("List available parliamentary seats")
  .option("--category <name>", "Filter by category")
  .option("--json", "Output as JSON", false)
  .action((opts: { category?: string; json?: boolean }) => {
    let seats = defaultRegistry.listAll();

    if (opts.category) {
      seats = seats.filter((s) => s.category === opts.category);
      if (seats.length === 0) {
        const categories = [...new Set(defaultRegistry.listAll().map((s) => s.category))];
        console.error(`No seats in category "${opts.category}". Available: ${categories.join(", ")}`);
        process.exit(1);
      }
    }

    if (opts.json) {
      console.log(
        JSON.stringify(
          seats.map((s) => ({
            id: s.id,
            name: s.name,
            role: s.role,
            domain: s.domain,
            category: s.category,
          })),
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      chalk.bold.cyan(
        `\n━━━ Parliagent — ${seats.length} Seats ━━━\n`,
      ),
    );

    const grouped = new Map<string, typeof seats>();
    for (const seat of seats) {
      const group = grouped.get(seat.category) ?? [];
      group.push(seat);
      grouped.set(seat.category, group);
    }

    for (const [category, categorySeats] of grouped) {
      console.log(chalk.bold.yellow(`  ${category}`) + chalk.dim(` (${categorySeats.length})`));
      for (const seat of categorySeats) {
        console.log(`  ${chalk.green("•")} ${chalk.bold(seat.id)} — ${seat.role}`);
      }
      console.log();
    }

    console.log(chalk.dim(`${seats.length} seats across ${grouped.size} categories`));
    console.log();
  });
