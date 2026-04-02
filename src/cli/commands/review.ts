import { Command } from "commander";
import { runDebate, addCommonOptions } from "../run-debate.js";

export const reviewCommand = addCommonOptions(
  new Command("review")
    .description("Critical review — find problems, risks, and objections")
    .argument("<prompt>", "What to review or critique")
    .option("--mode <mode>", "Debate mode", "fast")
    .option("--trace <level>", "Trace level", "summary"),
).action((prompt: string, opts: Record<string, unknown>) =>
  runDebate(prompt, opts, {
    mode: "fast",
    trace: "summary",
    answerMode: "review",
    taskType: "analysis",
  }),
);
