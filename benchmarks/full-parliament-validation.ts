#!/usr/bin/env npx tsx

/**
 * Full Parliament Validation — 3 high-value prompts with all 33 seats.
 *
 * Usage: ANTHROPIC_API_KEY=sk-... npx tsx benchmarks/full-parliament-validation.ts
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { debate } from "../src/index.js";
import { ParliamentResponse } from "../src/contracts/response.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROMPTS = [
  {
    id: "arch-tradeoff",
    category: "coding",
    prompt: "We need to choose between a monolithic architecture and microservices for a new fintech product that will handle payments, user accounts, and compliance reporting. We have 5 engineers and need to launch in 4 months. What architecture should we use and why?",
  },
  {
    id: "strategy-complex",
    category: "strategy",
    prompt: "Our SaaS startup has $2M ARR, 200 customers, and 18 months of runway. A larger competitor just launched a free tier that covers 60% of our features. Should we compete on price, differentiate on features, pivot to enterprise, or seek acquisition? What's the best path forward?",
  },
  {
    id: "security-sensitive",
    category: "security",
    prompt: "We're building a healthcare data platform that processes patient records across multiple hospitals. We need to design the data governance, access control, and audit trail system. How should we architect this to be HIPAA-compliant while still enabling researchers to query anonymized data?",
  },
];

async function main() {
  console.log("=== Full Parliament Validation (33 seats) ===\n");

  const results: Array<{
    id: string;
    category: string;
    tokensUsed: number;
    latencyMs: number;
    seatCount: number;
    stopReason: string;
    decisionType: string;
    disagreementCount: number;
    warningCount: number;
    hasMinorityReport: boolean;
    answerLength: number;
  }> = [];

  for (const p of PROMPTS) {
    process.stdout.write(`  ${p.id}...`);
    const start = Date.now();

    try {
      const response: ParliamentResponse = await debate({
        prompt: p.prompt,
        fullParliament: true,
        trace: "full",
      });

      const trace = response.traceArtifact;
      const latency = Date.now() - start;
      const disagreements = trace
        ? trace.rounds.reduce((sum, r) => sum + r.disagreements.length, 0)
        : 0;

      const result = {
        id: p.id,
        category: p.category,
        tokensUsed: trace?.totalTokensUsed ?? 0,
        latencyMs: latency,
        seatCount: response.activatedSeats.filter((s) => s !== "Speaker").length,
        stopReason: trace?.stopReason ?? "unknown",
        decisionType: response.decisionType,
        disagreementCount: disagreements,
        warningCount: response.warnings?.length ?? 0,
        hasMinorityReport: !!response.minorityReport,
        answerLength: response.finalAnswer.length,
      };

      results.push(result);
      console.log(
        ` ${result.tokensUsed} tokens, ${result.latencyMs}ms, ${result.seatCount} seats, ${result.disagreementCount} disagreements, ${result.decisionType}`,
      );

      const valid = ParliamentResponse.safeParse(response);
      if (!valid.success) {
        console.log("  ⚠ Schema validation FAILED");
      }
    } catch (error) {
      console.log(` ERROR: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Summary
  console.log("\n=== SUMMARY ===\n");
  const successful = results.filter((r) => r.tokensUsed > 0);
  if (successful.length > 0) {
    const avgTokens = Math.round(
      successful.reduce((s, r) => s + r.tokensUsed, 0) / successful.length,
    );
    const avgLatency = Math.round(
      successful.reduce((s, r) => s + r.latencyMs, 0) / successful.length,
    );
    const avgDisagreements = (
      successful.reduce((s, r) => s + r.disagreementCount, 0) / successful.length
    ).toFixed(1);
    const avgSeats = (
      successful.reduce((s, r) => s + r.seatCount, 0) / successful.length
    ).toFixed(1);

    console.log(`  Runs: ${successful.length}/${PROMPTS.length}`);
    console.log(`  Avg tokens: ${avgTokens}`);
    console.log(`  Avg latency: ${avgLatency}ms`);
    console.log(`  Avg seats: ${avgSeats}`);
    console.log(`  Avg disagreements: ${avgDisagreements}`);

    for (const r of results) {
      console.log(`\n  ${r.id}: ${r.tokensUsed} tokens, ${r.latencyMs}ms, ${r.decisionType}, ${r.disagreementCount} disagreements, ${r.warningCount} warnings`);
    }
  }

  // Write results
  const outputDir = resolve(__dirname, "results");
  mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputFile = resolve(outputDir, `full-parliament-${timestamp}.json`);
  writeFileSync(outputFile, JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2));
  console.log(`\nResults: ${outputFile}`);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
