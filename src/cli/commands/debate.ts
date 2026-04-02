import { Command } from "commander";
import { runDebate, addCommonOptions } from "../run-debate.js";

export const debateCommand = addCommonOptions(
  new Command("debate")
    .description("Full deliberation with visible debate trace")
    .argument("<prompt>", "The question or problem to deliberate on")
    .option("--mode <mode>", "Debate mode: micro, fast, balanced, deep", "balanced")
    .option("--task <type>", "Task type hint")
    .option("--answer <mode>", "Answer mode", "answer")
    .option("--trace <level>", "Trace level", "full"),
).action((prompt: string, opts: Record<string, unknown>) =>
  runDebate(prompt, opts, {
    mode: "balanced",
    trace: "full",
    answerMode: "answer",
  }),
);
