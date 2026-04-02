# Handoff

## Status

| Phase | Status | Evidence |
|-------|--------|---------|
| Phase 0+1: Spec, Constitution, Core | **complete** | 151 tests |
| Phase 2: CLI and SDK Polish | **complete** | 6 commands, 5 answer modes, config |
| Phase 2.5: Execution Profiles | **complete** | available/federated/supreme profiles |
| Code review fixes (2 rounds) | **complete** | 14 issues resolved |
| Phase 3A: Live Provider Validation | **complete** | 10/10 Anthropic |
| Phase 3B: Benchmarking | **complete** | 10 prompts × 3 modes |
| Phase 3C: Tuning | **complete** | Security auto-upgrade, defaults validated |
| Phase 4: Release Readiness | **complete** | Package artifact verified |
| Phase 5: 33-Seat Complete Parliament | **complete** | All 33 production-grade, benchmarked |
| **Parliagent Upgrade (v0.3)** | **complete** | Protocol + convergence + evidence + evaluation |

## Upgrade Summary (v0.3)

### Track 5: Product Truth Alignment
- Fixed `fullParliagent` Zod default (`true` → `false`) to match documented "explicit opt-in" behavior
- Fixed `executionProfile` drift: Speaker runtime now defaults to `"federated"` (matching Zod and docs)
- Removed self-dependency `"parliagent": "^0.2.4"` from package.json
- Fixed version strings in README/SKILL.md deep-mode references
- Aligned SKILL.md execution profile decision tree (removed `"available"` vs `"federated"` contradiction)
- Fixed README env comment (`PARLIAGENT_EXECUTION_PROFILE=federated`)

### Track 1: Procedural Parliament Protocol
- Added agenda stages (`opening`, `rebuttal`, `resolution`) to `RoundResult`
- Speaker now determines round stage based on dispute state:
  - Round 1: always `opening` (all seats parallel)
  - Round 2+: `resolution` if ≥2 open claim_conflicts (targeted exchange), else `rebuttal`
- Resolution rounds use a dedicated `RESOLUTION_PROMPT` that references specific open disputes
- Targeted exchanges: resolution rounds only include seats involved in top unresolved disputes
- `DisagreementRecord` now has optional `id` for lifecycle tracking

### Track 3: Issue-Level Convergence
- Convergence now tracks dispute lifecycle: `open` → `resolved` | `accepted_split`
- Reconciliation logic: compares current-round stances against prior-round disputes
  - Both seats agree → `resolved`
  - Both move to `mixed` → `accepted_split`
  - No more opposing stances → `accepted_split`
  - Warning seat drops warnings → `resolved`
- New `StopReason`: `issues_resolved` (all disputes closed)
- Resolution metrics added to `RoundResult`: `resolvedCount`, `acceptedSplitCount`, `unresolvedCount`
- `decisionType` now derived primarily from dispute resolution state, with stance-ratio fallback

### Track 2: Evidence-Grounded Deliberation
- `SeatStatement` extended with `claimProvenance`: `supported` | `inferred` | `speculative` | `missing_evidence`
- Statement prompt instructs seats to classify each claim's evidence quality
- Parser validates and normalizes provenance labels
- Synthesis prompts updated across all answer modes to distinguish evidenced vs unverified conclusions
- `buildTraceText` includes provenance labels for each claim

### Track 4: Outcome-Based Evaluation
- New `src/evaluation/rubric.ts`: 5-dimension evaluation framework
  - **Completeness**: answer quality, decision clarity, seat participation, routing rationale
  - **Tradeoff quality**: disagreement surfacing, minority reports, open questions
  - **Risk recall**: warning count vs expectations, risk topic coverage
  - **Calibration**: dispute lifecycle activity, evidence distinction
  - **Actionability**: structured output, concrete actions, risk-alongside-actions
- 8 evaluation fixtures covering: factual, tradeoff, risk, calibration, actionability categories
- `parliamentBeatBaseline` flag compares parliament score vs baseline estimate

## Test Suite

210 tests across 17 files — all passing. Includes:
- 26 protocol upgrade tests (agenda stages, dispute lifecycle, convergence, evidence)
- 10 evaluation rubric tests
- 23 review-fix integration tests (determineDecisionType, Speaker.debate() integration, calibration with trace, all 8 fixtures exercised)

## Provider Validation Status

| Provider | Implemented | Live-Validated | Benchmarked | Evidence |
|----------|------------|---------------|-------------|---------|
| **Anthropic** | Yes | Yes (3/3 single + 10/10 full) | Yes (10 prompts × 3 modes) | `live-validation-*.json`, `benchmark-*.json` |
| **OpenAI** | Yes | Yes (3/3 single) | No | `provider-validation-*.json` |
| **Google/Gemini** | Yes | Yes (3/3 single) | No | `provider-validation-*.json` |
| **FLOCK** | Yes | Yes (6/6: single + federated + supreme) | No | `flock-validation-*.json` |
| **Federated** (all 4) | Yes | Yes (4/4 with all providers) | No | `provider-validation-*.json` |

## Default Recommendations

| Command | Default Mode | Default Profile | Full Parliament |
|---------|-------------|-----------------|-----------------|
| `ask` | micro (2-3 seats) | federated | No |
| `plan` | fast (3-5 seats) | federated | No |
| `review` | fast (3-5 seats) | federated | No |
| `debate` | balanced (5-9 seats) | federated | No |
| explicit `--full-parliagent` | all 33 seats, 1 round | federated | **Yes** — opt-in only |

## Code Review Fixes Applied

Per staff-level code review, the following issues were fixed:

| Issue | Severity | Fix |
|-------|----------|-----|
| T3-1: Global mutable dispute ID counter | High | Replaced with `crypto.randomBytes()` — no shared state |
| T1-4: No Speaker.debate() integration test | High | Added 5 integration tests proving stages, metrics, provenance in trace |
| T3-7: determineDecisionType() untested | Medium | Added 8 direct unit tests covering all dispute/fallback branches |
| X-1: Parse/contract drift | High | `determineDecisionType` exported; shared validation constants |
| T5-1: CLI version stale | Minor | Reads from `package.json` at runtime |
| T1-3: Unsafe `String.replace` | Medium | Replaced with safe string concatenation |
| T1-5: Stage regression possible | Medium | Monotonic stage progression enforced |
| T2-3: claimProvenance length unchecked | Medium | Zod `.refine()` validates length matches claims |
| T2-2: Silent provenance padding | Medium | Padding uses `"missing_evidence"` instead of `"inferred"` |
| T4-2: Free calibration point | High | `maxScore` scales with fixture requirements |
| T4-4: Risk topic false positives | Medium | Word-boundary regex enforcement |
| T4-3: Calibration with trace untested | Medium | Integration test with `traceArtifact` dispute lifecycle |
| T4-5: 5/8 fixtures unexercised | Medium | All 8 fixtures now exercised in tests |

## Key Architecture Changes

- `fullParliagent` defaults to `false` across all entry points (SDK, CLI, handler)
- `executionProfile` defaults to `"federated"` across all entry points
- Speaker manages agenda stages per round, not just a flat round loop
- Convergence is issue-centered: tracks dispute IDs and lifecycle transitions
- Claims carry provenance metadata for evidence-aware synthesis
- Evaluation rubric enables outcome-based comparison of modes

## Result Traceability

| Evidence | File |
|----------|------|
| Anthropic live validation (Phase 3A) | `benchmarks/results/live-validation-2026-04-02T10-22-38-929Z.json` |
| Benchmark (Phase 3B) | `benchmarks/results/benchmark-2026-04-02T10-39-45-987Z.json` |
| Full parliament benchmark | `benchmarks/results/full-parliament-2026-04-02T11-41-48-750Z.json` |
| Provider validation (Anthropic + OpenAI + federated) | `benchmarks/results/provider-validation-2026-04-02T12-54-53-649Z.json` |
| FLOCK validation (single + federated + supreme) | `benchmarks/results/flock-validation-2026-04-02T13-05-35-106Z.json` |
| Benchmark analysis | `benchmarks/ANALYSIS.md` |
