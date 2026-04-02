import { Command } from "commander";
import { runDebate, addCommonOptions } from "../run-debate.js";

export const planCommand = addCommonOptions(
  new Command("plan")
    .description("Deliberate with planning bias — structured next steps and milestones")
    .argument("<prompt>", "The planning question or goal")
    .option("--mode <mode>", "Debate mode", "fast")
    .option("--trace <level>", "Trace level", "summary"),
).action((prompt: string, opts: Record<string, unknown>) =>
  runDebate(prompt, opts, {
    mode: "fast",
    trace: "summary",
    answerMode: "plan",
    taskType: "planning",
    progressPrefix: "Planning chamber",
  }),
);
