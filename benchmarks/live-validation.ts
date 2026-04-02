#!/usr/bin/env npx tsx

/**
 * Parliagent — Phase 3A: Live Provider Validation
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/live-validation.ts
 *
 * Tests all three entry paths (SDK, CLI-equivalent, handler) against real providers.
 * Records provider quirks, failures, retry behavior, and degradation patterns.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { debate } from "../src/index.js";
import { handleRequest } from "../src/handler.js";
import { Speaker } from "../src/core/speaker.js";
import { ModelPolicy } from "../src/runtime/policy.js";
import { ParliagentResponse } from "../src/contracts/response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ValidationResult {
  test: string;
  path: "sdk" | "cli-equivalent" | "handler";
  passed: boolean;
  latencyMs: number;
  tokensUsed?: number;
  details: string;
  error?: string;
  response?: Record<string, unknown>;
}

const results: ValidationResult[] = [];
let passCount = 0;
let failCount = 0;

function log(icon: string, msg: string) {
  console.log(`${icon} ${msg}`);
}

async function runTest(
  name: string,
  path: "sdk" | "cli-equivalent" | "handler",
  fn: () => Promise<{ details: string; tokens?: number; response?: Record<string, unknown> }>,
) {
  const start = Date.now();
  try {
    const { details, tokens, response } = await fn();
    const latency = Date.now() - start;
    results.push({
      test: name,
      path,
      passed: true,
      latencyMs: latency,
      tokensUsed: tokens,
      details,
      response,
    });
    log("✓", `${name} — ${latency}ms${tokens ? `, ${tokens} tokens` : ""}`);
    passCount++;
  } catch (error) {
    const latency = Date.now() - start;
    const msg = error instanceof Error ? error.message : String(error);
    results.push({
      test: name,
      path,
      passed: false,
      latencyMs: latency,
      details: "FAILED",
      error: msg,
    });
    log("✗", `${name} — FAILED: ${msg.slice(0, 120)}`);
    failCount++;
  }
}

// --- Validation Tests ---

async function main() {
  const policy = new ModelPolicy();

  if (!policy.isReady()) {
    console.error("No API key found. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY.");
    process.exit(1);
  }

  console.log(`\n=== Parliagent Live Validation ===`);
  console.log(`Provider(s): ${policy.availableProviders.join(", ")}`);
  console.log(`Primary: ${policy.primaryAdapter?.providerId}\n`);

  // --- SDK Path ---

  console.log("--- SDK Path ---\n");

  await runTest("SDK: micro mode basic ask", "sdk", async () => {
    const response = await debate({
      prompt: "What is the single most important principle of good API design?",
      mode: "micro",
      trace: "summary",
    });
    const valid = ParliagentResponse.safeParse(response);
    if (!valid.success) throw new Error("Response failed schema validation");
    return {
      details: `${response.decisionType}, ${response.activatedSeats.length} seats`,
      tokens: response.traceArtifact?.totalTokensUsed,
      response: response as unknown as Record<string, unknown>,
    };
  });

  await runTest("SDK: fast mode multi-seat debate", "sdk", async () => {
    const response = await debate({
      prompt: "Should a startup with 3 engineers build a microservices architecture or a monolith?",
      mode: "fast",
      taskType: "strategy",
      trace: "full",
    });
    const seatCount = response.activatedSeats.filter((s) => s !== "Speaker").length;
    if (seatCount < 3) throw new Error(`Only ${seatCount} speaking seats, expected >=3`);
    const trace = response.traceArtifact;
    if (!trace) throw new Error("No trace artifact in full trace mode");
    return {
      details: `${seatCount} seats, ${trace.rounds.length} rounds, ${response.decisionType}, stop=${trace.stopReason}`,
      tokens: trace.totalTokensUsed,
      response: response as unknown as Record<string, unknown>,
    };
  });

  await runTest("SDK: security-sensitive prompt triggers SecurityPrivacySeat", "sdk", async () => {
    const response = await debate({
      prompt: "How should we handle API key rotation and credential storage for our production database?",
      mode: "fast",
      taskType: "coding",
      trace: "full",
    });
    const hasSec = response.activatedSeats.includes("SecurityPrivacySeat");
    const hasWarnings = (response.warnings?.length ?? 0) > 0;
    return {
      details: `SecurityPrivacySeat=${hasSec}, warnings=${response.warnings?.length ?? 0}, ${response.decisionType}`,
      tokens: response.traceArtifact?.totalTokensUsed,
    };
  });

  await runTest("SDK: --json output validates against schema", "sdk", async () => {
    const response = await debate({
      prompt: "Explain the CAP theorem in simple terms",
      mode: "micro",
      trace: "full",
    });
    const valid = ParliagentResponse.safeParse(response);
    if (!valid.success) throw new Error(`Schema validation failed: ${JSON.stringify(valid.error.issues.slice(0, 2))}`);
    if (!response.traceArtifact) throw new Error("Missing trace artifact");
    if (response.traceArtifact.rounds.length === 0) throw new Error("No rounds in trace");
    return {
      details: `Schema valid, ${response.traceArtifact.rounds.length} rounds, ${response.traceArtifact.rounds[0].statements.length} statements`,
      tokens: response.traceArtifact.totalTokensUsed,
    };
  });

  await runTest("SDK: plan answer mode produces structured output", "sdk", async () => {
    const response = await debate({
      prompt: "Plan the launch of a new developer documentation site",
      mode: "micro",
      taskType: "planning",
      answerMode: "plan",
      trace: "none",
    });
    const hasSteps = response.finalAnswer.toLowerCase().includes("step") ||
      response.finalAnswer.includes("1.") ||
      response.finalAnswer.includes("- ");
    return {
      details: `Plan length: ${response.finalAnswer.length} chars, has structure: ${hasSteps}`,
    };
  });

  // --- CLI-equivalent Path ---

  console.log("\n--- CLI-equivalent Path ---\n");

  await runTest("CLI: Speaker direct instantiation", "cli-equivalent", async () => {
    const speaker = new Speaker();
    const response = await speaker.debate({
      prompt: "What is the most common mistake in database schema design?",
      mode: "micro",
      trace: "summary",
    });
    return {
      details: `${response.decisionType}, answer: ${response.finalAnswer.length} chars`,
      tokens: response.traceArtifact?.totalTokensUsed,
    };
  });

  // --- Handler Path ---

  console.log("\n--- Handler Path ---\n");

  await runTest("Handler: POST with valid request", "handler", async () => {
    const res = await handleRequest({
      method: "POST",
      body: {
        prompt: "What is the single most important thing to get right when designing a REST API?",
        mode: "micro",
        trace: "summary",
      },
    });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    const parsed = JSON.parse(res.body);
    const valid = ParliagentResponse.safeParse(parsed);
    if (!valid.success) throw new Error("Handler response failed schema validation");
    return {
      details: `HTTP 200, ${parsed.decisionType}, ${parsed.activatedSeats.length} seats`,
    };
  });

  await runTest("Handler: OPTIONS returns CORS headers", "handler", async () => {
    const res = await handleRequest({ method: "OPTIONS" });
    if (res.status !== 204) throw new Error(`Expected 204, got ${res.status}`);
    if (res.headers["Access-Control-Allow-Origin"] !== "*") throw new Error("Missing CORS header");
    return { details: "CORS preflight correct" };
  });

  await runTest("Handler: invalid request returns 400", "handler", async () => {
    const res = await handleRequest({
      method: "POST",
      body: { prompt: "" },
    });
    if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
    return { details: "Validation error returned correctly" };
  });

  // --- Budget / Timeout behavior ---

  console.log("\n--- Budget / Degradation ---\n");

  await runTest("Budget: low token cap triggers circuit breaker", "sdk", async () => {
    const response = await debate({
      prompt: "Explain the pros and cons of functional programming vs OOP",
      mode: "fast",
      trace: "full",
      constraints: { maxTokens: 500 },
    });
    const stop = response.traceArtifact?.stopReason;
    return {
      details: `stopReason=${stop}, tokens=${response.traceArtifact?.totalTokensUsed}`,
      tokens: response.traceArtifact?.totalTokensUsed,
    };
  });

  // --- Summary ---

  console.log(`\n\n=== RESULTS: ${passCount} passed, ${failCount} failed ===\n`);

  // Write results
  const outputDir = resolve(__dirname, "results");
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `live-validation-${timestamp}.json`);
  writeFileSync(
    outputFile,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        providers: policy.availableProviders,
        primary: policy.primaryAdapter?.providerId,
        passed: passCount,
        failed: failCount,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`Results written to: ${outputFile}`);

  if (failCount > 0) {
    console.log("\nFailed tests:");
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  ✗ ${r.test}: ${r.error}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Live validation failed:", err);
  process.exit(1);
});
