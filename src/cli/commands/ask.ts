import { Command } from "commander";
import { runDebate, addCommonOptions } from "../run-debate.js";

export const askCommand = addCommonOptions(
  new Command("ask")
    .description("Quick deliberation (defaults to micro mode)")
    .argument("<prompt>", "The question or problem to deliberate on")
    .option("--mode <mode>", "Debate mode: micro, fast, balanced, deep", "micro")
    .option("--task <type>", "Task type hint: general, writing, planning, analysis, coding, strategy, ethics")
    .option("--answer <mode>", "Answer mode: answer, memo, plan, review, transcript", "answer")
    .option("--trace <level>", "Trace level: none, summary, full", "summary"),
).action((prompt: string, opts: Record<string, unknown>) =>
  runDebate(prompt, opts, {
    mode: "micro",
    trace: "summary",
    answerMode: "answer",
  }),
);
