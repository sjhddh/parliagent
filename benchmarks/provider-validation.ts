#!/usr/bin/env npx tsx

/**
 * Provider-specific live validation.
 * Tests each available provider individually, then tests federated mode with multiple providers.
 *
 * Usage: ANTHROPIC_API_KEY=... OPENAI_API_KEY=... npx tsx benchmarks/provider-validation.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Speaker } from "../src/core/speaker.js";
import { ModelPolicy } from "../src/runtime/policy.js";
import { ParliagentResponse } from "../src/contracts/response.js";
import type { RuntimeConfig } from "../src/runtime/policy.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ProviderTestResult {
  provider: string;
  test: string;
  passed: boolean;
  latencyMs: number;
  tokensUsed?: number;
  details: string;
  error?: string;
}

const results: ProviderTestResult[] = [];
let passCount = 0;
let failCount = 0;

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

async function runTest(
  provider: string,
  name: string,
  config: RuntimeConfig,
  requestOverrides: Record<string, unknown> = {},
) {
  const start = Date.now();
  try {
    const speaker = new Speaker(config);
    const response: ParliagentResponse = await speaker.debate({
      prompt: "What are the key tradeoffs between SQL and NoSQL databases for a new SaaS product?",
      mode: "micro" as const,
      trace: "full" as const,
      ...requestOverrides,
    });

    const valid = ParliagentResponse.safeParse(response);
    if (!valid.success) throw new Error("Schema validation failed");

    const latency = Date.now() - start;
    const tokens = response.traceArtifact?.totalTokensUsed ?? 0;
    const seats = response.activatedSeats.filter((s) => s !== "Speaker").length;
    const models = response.traceArtifact?.modelAssignments ?? {};

    results.push({
      provider,
      test: name,
      passed: true,
      latencyMs: latency,
      tokensUsed: tokens,
      details: `${seats} seats, ${response.decisionType}, models: ${JSON.stringify(models)}`,
    });
    log("✓", `[${provider}] ${name} — ${latency}ms, ${tokens} tokens`);
    passCount++;
  } catch (error) {
    const latency = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    results.push({
      provider,
      test: name,
      passed: false,
      latencyMs: latency,
      details: "FAILED",
      error: msg.slice(0, 300),
    });
    log("✗", `[${provider}] ${name} — FAILED: ${msg.slice(0, 120)}`);
    failCount++;
  }
}

async function main() {
  const globalPolicy = new ModelPolicy();
  console.log(`\n=== Provider Validation ===`);
  console.log(`Available: ${globalPolicy.availableProviders.join(", ")}\n`);

  // --- Single-provider: Anthropic ---
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("--- Anthropic (single-provider) ---\n");

    const config: RuntimeConfig = {
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
      primaryProvider: "anthropic",
    };

    await runTest("anthropic", "micro mode basic", config);
    await runTest("anthropic", "fast mode with seed", config, {
      mode: "fast",
      seed: "test-seed-123",
    });
    await runTest("anthropic", "plan answer mode", config, {
      answerMode: "plan",
      taskType: "planning",
    });
  }

  // --- Single-provider: OpenAI ---
  if (process.env.OPENAI_API_KEY) {
    console.log("\n--- OpenAI (single-provider) ---\n");

    const config: RuntimeConfig = {
      openai: { apiKey: process.env.OPENAI_API_KEY },
      primaryProvider: "openai",
    };

    await runTest("openai", "micro mode basic", config);
    await runTest("openai", "fast mode with seed", config, {
      mode: "fast",
      seed: "test-seed-456",
    });
    await runTest("openai", "review answer mode", config, {
      answerMode: "review",
      taskType: "analysis",
    });
  }

  // --- Single-provider: Google ---
  const googleKey = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (googleKey) {
    console.log("\n--- Google/Gemini (single-provider) ---\n");

    const config: RuntimeConfig = {
      google: { apiKey: googleKey },
      primaryProvider: "google",
    };

    await runTest("google", "micro mode basic", config);
    await runTest("google", "fast mode with seed", config, {
      mode: "fast",
      seed: "test-seed-789",
    });
    await runTest("google", "plan answer mode", config, {
      answerMode: "plan",
      taskType: "planning",
    });
  }

  // --- Single-provider: FLOCK ---
  if (process.env.FLOCK_API_KEY && process.env.FLOCK_MODEL) {
    console.log("\n--- FLOCK (single-provider) ---\n");

    const config: RuntimeConfig = {
      flock: { apiKey: process.env.FLOCK_API_KEY, defaultModel: process.env.FLOCK_MODEL },
      primaryProvider: "flock",
    };

    await runTest("flock", "micro mode basic", config);
    await runTest("flock", "fast mode", config, { mode: "fast" });
  }

  // --- Federated: multi-provider ---
  const multiProviderKeys = [
    process.env.ANTHROPIC_API_KEY ? "anthropic" : null,
    process.env.OPENAI_API_KEY ? "openai" : null,
    googleKey ? "google" : null,
    (process.env.FLOCK_API_KEY && process.env.FLOCK_MODEL) ? "flock" : null,
  ].filter(Boolean);

  if (multiProviderKeys.length >= 2) {
    console.log(`\n--- Federated (${multiProviderKeys.join(" + ")}) ---\n`);

    const config: RuntimeConfig = {
      ...(process.env.ANTHROPIC_API_KEY
        ? { anthropic: { apiKey: process.env.ANTHROPIC_API_KEY } }
        : {}),
      ...(process.env.OPENAI_API_KEY
        ? { openai: { apiKey: process.env.OPENAI_API_KEY } }
        : {}),
      ...(googleKey ? { google: { apiKey: googleKey } } : {}),
      ...((process.env.FLOCK_API_KEY && process.env.FLOCK_MODEL)
        ? { flock: { apiKey: process.env.FLOCK_API_KEY, defaultModel: process.env.FLOCK_MODEL } }
        : {}),
      primaryProvider: "anthropic",
    };

    await runTest("federated", "micro mode (available profile)", config);

    await runTest("federated", "fast mode (federated profile)", config, {
      mode: "fast",
      executionProfile: "federated",
    });

    await runTest("federated", "micro mode (supreme profile, primary=anthropic)", config, {
      executionProfile: "supreme",
    });

    await runTest("federated", "balanced mode (federated, strategy)", config, {
      mode: "balanced",
      executionProfile: "federated",
      taskType: "strategy",
    });
  }

  // --- Summary ---
  console.log(`\n\n=== RESULTS: ${passCount} passed, ${failCount} failed ===\n`);

  const byProvider = new Map<string, ProviderTestResult[]>();
  for (const r of results) {
    const list = byProvider.get(r.provider) ?? [];
    list.push(r);
    byProvider.set(r.provider, list);
  }

  for (const [provider, providerResults] of byProvider) {
    const passed = providerResults.filter((r) => r.passed).length;
    console.log(`  ${provider}: ${passed}/${providerResults.length} passed`);
  }

  // Write results
  const outputDir = resolve(__dirname, "results");
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `provider-validation-${timestamp}.json`);
  writeFileSync(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        availableProviders: globalPolicy.availableProviders,
        passed: passCount,
        failed: failCount,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nResults: ${outputFile}`);

  if (failCount > 0) {
    console.log("\nFailed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  ✗ [${r.provider}] ${r.test}: ${r.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
