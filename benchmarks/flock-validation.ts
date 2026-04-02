#!/usr/bin/env npx tsx

/**
 * FLOCK Provider Validation — single-provider, federated, and supreme scenarios.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Speaker } from "../src/core/speaker.js";
import { ParliamentResponse } from "../src/contracts/response.js";
import type { RuntimeConfig } from "../src/runtime/policy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestResult {
  test: string;
  passed: boolean;
  latencyMs: number;
  tokensUsed: number;
  details: string;
  error?: string;
}

const results: TestResult[] = [];
let passCount = 0;
let failCount = 0;

async function test(
  name: string,
  config: RuntimeConfig,
  overrides: Record<string, unknown> = {},
) {
  const start = Date.now();
  try {
    const speaker = new Speaker(config);
    const response = await speaker.debate({
      prompt: "What are the key tradeoffs between SQL and NoSQL databases for a new SaaS product?",
      mode: "micro" as const,
      trace: "full" as const,
      ...overrides,
    });

    const valid = ParliamentResponse.safeParse(response);
    if (!valid.success) throw new Error("Schema validation failed");

    const latency = Date.now() - start;
    const tokens = response.traceArtifact?.totalTokensUsed ?? 0;
    const models = response.traceArtifact?.modelAssignments ?? {};

    results.push({
      test: name,
      passed: true,
      latencyMs: latency,
      tokensUsed: tokens,
      details: `${response.decisionType}, models: ${JSON.stringify(models)}`,
    });
    console.log(`✓ ${name} — ${latency}ms, ${tokens} tokens, ${response.decisionType}`);
    passCount++;
  } catch (error) {
    const latency = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    results.push({
      test: name,
      passed: false,
      latencyMs: latency,
      tokensUsed: 0,
      details: "FAILED",
      error: msg.slice(0, 300),
    });
    console.log(`✗ ${name} — FAILED: ${msg.slice(0, 150)}`);
    failCount++;
  }
}

async function main() {
  console.log("=== FLOCK Provider Validation ===\n");

  if (!process.env.FLOCK_API_KEY) {
    console.error("FLOCK_API_KEY not set");
    process.exit(1);
  }

  // --- FLOCK-only ---
  console.log("--- FLOCK-only (all seats on FLOCK) ---\n");
  const flockOnly: RuntimeConfig = {
    flock: { apiKey: process.env.FLOCK_API_KEY },
    primaryProvider: "flock",
  };

  await test("FLOCK-only micro", flockOnly);
  await test("FLOCK-only fast + seed", flockOnly, { mode: "fast", seed: "flock-test" });
  await test("FLOCK-only plan mode", flockOnly, { answerMode: "plan", taskType: "planning" });

  // --- Federated: FLOCK primary + Anthropic ---
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("\n--- Federated (FLOCK primary + Anthropic) ---\n");
    const federated: RuntimeConfig = {
      flock: { apiKey: process.env.FLOCK_API_KEY },
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
      primaryProvider: "flock",
    };

    await test("Federated micro (FLOCK primary)", federated);
    await test("Federated fast (federated profile)", federated, {
      mode: "fast",
      executionProfile: "federated",
    });
  }

  // --- Supreme: FLOCK as supreme ---
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("\n--- Supreme (FLOCK as supreme provider) ---\n");
    const supreme: RuntimeConfig = {
      flock: { apiKey: process.env.FLOCK_API_KEY },
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
      primaryProvider: "anthropic",
      supremeProvider: "flock",
    };

    await test("Supreme (FLOCK supreme, Anthropic primary)", supreme, {
      executionProfile: "supreme",
    });
  }

  // --- Summary ---
  console.log(`\n=== RESULTS: ${passCount} passed, ${failCount} failed ===`);

  const outputDir = resolve(__dirname, "results");
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `flock-validation-${timestamp}.json`);
  writeFileSync(outputFile, JSON.stringify({
    timestamp: new Date().toISOString(),
    passed: passCount,
    failed: failCount,
    results,
  }, null, 2));
  console.log(`\nResults: ${outputFile}`);

  if (failCount > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
