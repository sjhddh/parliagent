# Publish Checklist — sun-parliament v0.1.0

## Pre-publish Verification

### Code Quality
- [x] `npm run typecheck` passes (noUnusedLocals, noUnusedParameters enabled)
- [x] `npm test` — 151 tests pass across 14 files
- [x] `npm run build` — clean TypeScript compilation
- [x] No `as any` casts in production code
- [x] typescript/tsx in devDependencies only

### Package Artifact
- [x] `npm pack --dry-run` shows only dist/ + README.md + package.json
- [x] Package size: ~60 KB packed / ~254 KB unpacked
- [x] Production dependencies: chalk, commander, zod only
- [x] `dist/index.js` — SDK entry point exists and exports all public API
- [x] `dist/index.d.ts` — TypeScript declarations exist
- [x] `dist/cli/index.js` — CLI bin entry exists with shebang
- [x] `dist/handler.js` — Serverless handler exists

### Functional Verification (from built artifact)
- [x] SDK: all major exports resolvable (`debate`, `Speaker`, `defaultRegistry`, `handleRequest`, etc.)
- [x] CLI: `--help` shows 6 commands
- [x] CLI: `seats --json` returns 33 seats
- [x] CLI: `inspect` returns valid routing decision
- [x] Handler: CORS, validation, and error responses tested (6 handler tests)

### Live Provider Validation (Phase 3A)
- [x] `npm run validate` passes — 10/10 tests passed (2026-04-02, Anthropic Claude)
- [x] At least one `trace=full` output validated against schema
- [x] Budget circuit breaker verified with real tokens (stopReason=budget at 1885 tokens)
- [x] Provider scope documented (see Provider Validation Scope below)
- Results: `benchmarks/results/live-validation-2026-04-02T10-22-38-929Z.json`

### Benchmarking (Phase 3B)
- [x] `npm run benchmark` completed — 40/40 runs succeeded (2026-04-02, Anthropic Claude)
- [x] Divergence example: security prompts in fast mode produce 10-11 disagreements and 5-6 warnings vs 0 from baseline
- [x] Cost/latency envelopes recorded for baseline, micro, fast, balanced
- [x] Analysis written: `benchmarks/ANALYSIS.md`
- Results: `benchmarks/results/benchmark-2026-04-02T10-39-45-987Z.json`

### Documentation
- [x] README.md — installation, SDK, CLI, config, deployment, roster, benchmark-backed mode guidance
- [x] CHANGELOG.md — v0.1.0 release notes
- [x] Plans.md — all Phase 0+1, Phase 2, Phase 3, Phase 4 checkboxes complete
- [x] HANDOFF.md — 5 core questions answered with evidence

## Provider Validation Scope

| Provider | Adapter | Live-Validated | Notes |
|----------|---------|---------------|-------|
| **Anthropic** | `src/runtime/providers/anthropic.ts` | **Yes** — 10/10 validation, 40/40 benchmark | Primary provider for all v0.1.0 testing |
| OpenAI | `src/runtime/providers/openai.ts` | No | Adapter implemented and type-checked. Not live-tested in v0.1.0. |
| Google | `src/runtime/providers/google.ts` | No | Adapter implemented. Uses `x-goog-api-key` header auth. Not live-tested in v0.1.0. |

## Benchmark Scope

| Mode | Benchmarked | Prompts | Result |
|------|------------|---------|--------|
| **Baseline** | Yes | 10 | Avg 822 tokens, 14.5s |
| **Micro** | Yes | 10 | Avg 1,318 tokens, 16.4s, 1.6x cost |
| **Fast** | Yes | 10 | Avg 5,336 tokens, 33.6s, 6.5x cost |
| **Balanced** | Yes | 10 | Avg 10,898 tokens, 36.5s, 13.3x cost |
| Deep | **Not benchmarked** | — | Implemented, budget limits defined (60k tokens / 60s), not run due to cost. Estimated ~25k+ tokens, ~30x+ baseline cost. |

## Publish Steps

```bash
# 1. Final evidence check
npm run typecheck && npm test && npm run build && npm pack --dry-run

# 2. Publish
npm publish

# 3. Post-publish verification
npm install sun-parliament
npx sun-parliament seats
```

## Post-publish

- [ ] Verify package page on npmjs.com
- [ ] Test install in a clean project
- [ ] Tag git: `git tag v0.1.0 && git push --tags`
