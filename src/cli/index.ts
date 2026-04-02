#!/usr/bin/env node

import { Command } from "commander";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { askCommand } from "./commands/ask.js";
import { debateCommand } from "./commands/debate.js";
import { seatsCommand } from "./commands/seats.js";
import { planCommand } from "./commands/plan.js";
import { reviewCommand } from "./commands/review.js";
import { inspectCommand } from "./commands/inspect.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8"));

const program = new Command();

program
  .name("parliagent")
  .description(
    "Parliagent — A skill-first multi-agent deliberation engine that simulates a parliament of expert personas",
  )
  .version(pkg.version);

program.addCommand(askCommand);
program.addCommand(debateCommand);
program.addCommand(planCommand);
program.addCommand(reviewCommand);
program.addCommand(seatsCommand);
program.addCommand(inspectCommand);

program.parse();
