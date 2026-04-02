#!/usr/bin/env npx tsx

/**
 * Sun Parliament Benchmark Runner
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/run.ts
 *   ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/run.ts --modes micro,fast
 *   ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/run.ts --prompts coding-sorting,strategy-pricing
 *   ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/run.ts --baseline-only
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Speaker } from "../src/core/speaker.js";
import { ModelPolicy } from "../src/runtime/policy.js";
import type { DebateMode } from "../src/contracts/request.js";
import type { ParliamentResponse } from "../src/contracts/response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BenchmarkPrompt {
  id: string;
  category: string;
  prompt: string;
  expectedTraits: string[];
}

interface RunResult {
  promptId: string;
  category: string;
  mode: string;
  tokensUsed: number;
  latencyMs: number;
  stopReason: string;
  decisionType: string;
  seatCount: number;
  disagreementCount: number;
  warningCount: number;
  hasMinorityReport: boolean;
  answerLengthChars: number;
  activatedSeats: string[];
  error?: string;
}

interface BaselineResult {
  promptId: string;
  category: string;
  tokensUsed: number;
  latencyMs: number;
  answerLengthChars: number;
  error?: string;
}

// --- Parse CLI args ---

const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}
const baselineOnly = args.includes("--baseline-only");
const modesArg = getArg("modes");
const promptsArg = getArg("prompts");

const MODES_TO_RUN: DebateMode[] = modesArg
  ? (modesArg.split(",") as DebateMode[])
  : ["micro", "fast", "balanced"];

const promptsFile = JSON.parse(
  readFileSync(resolve(__dirname, "prompts.json"), "utf-8"),
);
const ALL_PROMPTS: BenchmarkPrompt[] = promptsFile.prompts;

const selectedPrompts = promptsArg
  ? ALL_PROMPTS.filter((p) => promptsArg.split(",").includes(p.id))
  : ALL_PROMPTS;

// --- Check providers ---

const policy = new ModelPolicy();
if (!policy.isReady()) {
  console.error(
    "ERROR: No API key found. Set at least one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY",
  );
  process.exit(1);
}

console.log(`Providers available: ${policy.availableProviders.join(", ")}`);
console.log(`Primary: ${policy.primaryAdapter?.providerId}`);
console.log(`Prompts: ${selectedPrompts.length}`);
console.log(`Modes: ${baselineOnly ? "baseline only" : MODES_TO_RUN.join(", ")}`);
console.log("---\n");

// --- Baseline: single-agent call ---

async function runBaseline(prompt: BenchmarkPrompt): Promise<BaselineResult> {
  const adapter = policy.primaryAdapter!;
  const start = Date.now();

  try {
    const result = await adapter.complete(
      [
        {
          role: "system",
          content:
            "You are a helpful expert assistant. Answer the question thoroughly and concisely.",
        },
        { role: "user", content: prompt.prompt },
      ],
      { temperature: 0.7, maxTokens: 1024 },
    );

    return {
      promptId: prompt.id,
      category: prompt.category,
      tokensUsed: result.tokensUsed.total,
      latencyMs: Date.now() - start,
      answerLengthChars: result.content.length,
    };
  } catch (error) {
    return {
      promptId: prompt.id,
      category: prompt.category,
      tokensUsed: 0,
      latencyMs: Date.now() - start,
      answerLengthChars: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- Parliament run ---

async function runParliament(
  prompt: BenchmarkPrompt,
  mode: DebateMode,
): Promise<RunResult> {
  const speaker = new Speaker();
  const start = Date.now();

  try {
    const response: ParliamentResponse = await speaker.debate({
      prompt: prompt.prompt,
      mode,
      trace: "full",
    });

    const trace = response.traceArtifact;
    const totalDisagreements = trace
      ? trace.rounds.reduce((sum, r) => sum + r.disagreements.length, 0)
      : 0;

    return {
      promptId: prompt.id,
      category: prompt.category,
      mode,
      tokensUsed: trace?.totalTokensUsed ?? 0,
      latencyMs: Date.now() - start,
      stopReason: trace?.stopReason ?? "unknown",
      decisionType: response.decisionType,
      seatCount: response.activatedSeats.filter((s) => s !== "Speaker").length,
      disagreementCount: totalDisagreements,
      warningCount: response.warnings?.length ?? 0,
      hasMinorityReport: !!response.minorityReport,
      answerLengthChars: response.finalAnswer.length,
      activatedSeats: response.activatedSeats,
    };
  } catch (error) {
    return {
      promptId: prompt.id,
      category: prompt.category,
      mode,
      tokensUsed: 0,
      latencyMs: Date.now() - start,
      stopReason: "error",
      decisionType: "uncertain",
      seatCount: 0,
      disagreementCount: 0,
      warningCount: 0,
      hasMinorityReport: false,
      answerLengthChars: 0,
      activatedSeats: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// --- Main ---

async function main() {
  const baselines: BaselineResult[] = [];
  const results: RunResult[] = [];

  // Run baselines
  console.log("=== BASELINE (single-agent) ===\n");
  for (const prompt of selectedPrompts) {
    process.stdout.write(`  ${prompt.id}...`);
    const result = await runBaseline(prompt);
    baselines.push(result);

    if (result.error) {
      console.log(` ERROR: ${result.error}`);
    } else {
      console.log(
        ` ${result.tokensUsed} tokens, ${result.latencyMs}ms, ${result.answerLengthChars} chars`,
      );
    }
  }

  if (!baselineOnly) {
    // Run parliament modes
    for (const mode of MODES_TO_RUN) {
      console.log(`\n=== MODE: ${mode} ===\n`);
      for (const prompt of selectedPrompts) {
        process.stdout.write(`  ${prompt.id} [${mode}]...`);
        const result = await runParliament(prompt, mode);
        results.push(result);

        if (result.error) {
          console.log(` ERROR: ${result.error}`);
        } else {
          console.log(
            ` ${result.tokensUsed} tokens, ${result.latencyMs}ms, ${result.decisionType}, ${result.seatCount} seats, ${result.disagreementCount} disagreements`,
          );
        }
      }
    }
  }

  // Write results
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = resolve(__dirname, "results");
  mkdirSync(outputDir, { recursive: true });

  const outputFile = resolve(outputDir, `benchmark-${timestamp}.json`);
  const output = {
    timestamp: new Date().toISOString(),
    provider: policy.primaryAdapter?.providerId,
    providers: policy.availableProviders,
    promptCount: selectedPrompts.length,
    modesRun: baselineOnly ? ["baseline"] : MODES_TO_RUN,
    baselines,
    results,
  };

  writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\nResults written to: ${outputFile}`);

  // Print summary
  printSummary(baselines, results);
}

function printSummary(baselines: BaselineResult[], results: RunResult[]) {
  console.log("\n\n========================================");
  console.log("         BENCHMARK SUMMARY");
  console.log("========================================\n");

  // Baseline stats
  const bSuccessful = baselines.filter((b) => !b.error);
  if (bSuccessful.length > 0) {
    const avgTokens = Math.round(
      bSuccessful.reduce((s, b) => s + b.tokensUsed, 0) / bSuccessful.length,
    );
    const avgLatency = Math.round(
      bSuccessful.reduce((s, b) => s + b.latencyMs, 0) / bSuccessful.length,
    );
    console.log(
      `Baseline: ${bSuccessful.length}/${baselines.length} succeeded, avg ${avgTokens} tokens, avg ${avgLatency}ms`,
    );
  }

  // Per-mode stats
  const byMode = new Map<string, RunResult[]>();
  for (const r of results) {
    const list = byMode.get(r.mode) ?? [];
    list.push(r);
    byMode.set(r.mode, list);
  }

  for (const [mode, modeResults] of byMode) {
    const successful = modeResults.filter((r) => !r.error);
    if (successful.length === 0) {
      console.log(`\n${mode}: all failed`);
      continue;
    }

    const avgTokens = Math.round(
      successful.reduce((s, r) => s + r.tokensUsed, 0) / successful.length,
    );
    const avgLatency = Math.round(
      successful.reduce((s, r) => s + r.latencyMs, 0) / successful.length,
    );
    const avgSeats = (
      successful.reduce((s, r) => s + r.seatCount, 0) / successful.length
    ).toFixed(1);
    const avgDisagreements = (
      successful.reduce((s, r) => s + r.disagreementCount, 0) /
      successful.length
    ).toFixed(1);
    const decisions = successful.reduce<Record<string, number>>((acc, r) => {
      acc[r.decisionType] = (acc[r.decisionType] ?? 0) + 1;
      return acc;
    }, {});
    const stops = successful.reduce<Record<string, number>>((acc, r) => {
      acc[r.stopReason] = (acc[r.stopReason] ?? 0) + 1;
      return acc;
    }, {});
    const minorityCount = successful.filter((r) => r.hasMinorityReport).length;

    console.log(`\n${mode.toUpperCase()}: ${successful.length}/${modeResults.length} succeeded`);
    console.log(`  Avg tokens: ${avgTokens} | Avg latency: ${avgLatency}ms | Avg seats: ${avgSeats}`);
    console.log(`  Avg disagreements: ${avgDisagreements} | Minority reports: ${minorityCount}/${successful.length}`);
    console.log(`  Decisions: ${Object.entries(decisions).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    console.log(`  Stop reasons: ${Object.entries(stops).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }

  // Cost comparison
  if (baselines.length > 0 && results.length > 0) {
    console.log("\n--- COST MULTIPLIERS vs BASELINE ---");
    const bAvg =
      bSuccessful.reduce((s, b) => s + b.tokensUsed, 0) / bSuccessful.length;
    for (const [mode, modeResults] of byMode) {
      const successful = modeResults.filter((r) => !r.error);
      if (successful.length === 0) continue;
      const mAvg =
        successful.reduce((s, r) => s + r.tokensUsed, 0) / successful.length;
      console.log(`  ${mode}: ${(mAvg / bAvg).toFixed(1)}x tokens vs baseline`);
    }
  }

  // Security-sensitive analysis
  const secResults = results.filter(
    (r) => r.category === "security-sensitive" && !r.error,
  );
  if (secResults.length > 0) {
    console.log("\n--- SECURITY-SENSITIVE PROMPTS ---");
    for (const r of secResults) {
      const hasSecSeat = r.activatedSeats.includes("SecurityPrivacySeat");
      console.log(
        `  ${r.promptId} [${r.mode}]: SecurityPrivacySeat=${hasSecSeat ? "YES" : "NO"}, warnings=${r.warningCount}, disagreements=${r.disagreementCount}`,
      );
    }
  }

  console.log("\n========================================\n");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
