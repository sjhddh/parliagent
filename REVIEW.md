# Code Review — Parliagent v1.0.0

## Verdict: CONDITIONAL PASS

Staff-level code review covering all 40+ source files across 6 modules (`core`, `runtime`, `contracts`, `cli`, `evaluation`, `seats`) plus the top-level `src/index.ts` API surface. 19 test files (3834 lines) examined for coverage gaps. The codebase is architecturally mature with strong modular decomposition, typed contracts, and a comprehensive test suite. However, several correctness, validation, and maintainability issues require attention before the v1.0.0 claim is fully justified.

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture | 4/5 | Well-decomposed modules; `Speaker` remains a facade with large surface area |
| Type Safety | 3/5 | Strong Zod contracts at boundaries; provider responses and CLI inputs lack runtime validation |
| Error Handling | 3/5 | Retry logic is solid; multiple silent `catch {}` blocks hide I/O failures |
| Code Quality | 4/5 | Clean module boundaries; significant duplication in `Speaker.debate` vs `debateStream` |
| Security | 3/5 | API keys handled properly; error messages may leak provider details |
| Test Coverage | 4/5 | 263 tests across 19 files; gaps in concurrency, DAG edge cases, and non-English text |
| API Design | 3/5 | `Parliagent` class documents options it does not implement |

---

## Critical Issues (P0)

### C-1: `Parliagent` constructor ignores documented options

- **Severity**: Critical
- **Location**: `src/index.ts` lines 64–70, 95–102
- **Problem**: `ParliagentOptions` declares `topology`, `haltingCondition`, and `harvestExhaust` fields. The JSDoc example (lines 76–89) shows them in use. But the constructor at lines 95–101 only reads `opts.config` and `opts.cache` — the other three options are silently ignored.
- **Impact**: Users who follow the documented example get no error but also no effect. This is a trust and correctness issue for the primary public API.
- **Fix**: Either wire the options into `Speaker` (if the features exist internally) or remove them from the interface and JSDoc until implemented.

### C-2: `Speaker.debate()` vs `debateStream()` large-scale duplication

- **Severity**: Critical
- **Location**: `src/core/speaker.ts` lines 72–296 vs 298–539
- **Problem**: ~240 lines of near-identical logic (safety check, mode selection, routing, cache, budget loop, convergence, synthesis, trace building) are duplicated between the two methods. The only difference is `yield` vs callback invocations.
- **Impact**: Any fix applied to one path can be missed in the other. Bug-for-bug parity is hard to maintain. This is the largest file in the codebase (~624 lines).
- **Fix**: Extract the shared orchestration into a private method that accepts a "sink" strategy (callback vs yield). Both public methods become thin wrappers.

### C-3: Argument DAG attack edges always reference claim index 0

- **Severity**: Critical
- **Location**: `src/core/argument-dag.ts` lines 80–88
- **Problem**: When building attack edges from objections, `from` is hardcoded to `nodeId(stmt.seatId, stmt.round, 0)` — always the first claim of the objecting seat. If a seat has 3 claims, the attack always originates from claim 0 regardless of which claim the objection relates to.
- **Impact**: The DAG `criticalPath` and `resilience` scores are structurally wrong for any multi-claim statement. The "Proof of Logic" feature produces misleading results.
- **Fix**: Either attribute the attack to the correct source claim (via text similarity or explicit linking) or create a dedicated "objection node" type.

---

## High-Severity Issues (P1)

### H-1: `eventBusToCallbacks` hardcodes `stage: "opening"` for all rounds

- **Severity**: High
- **Location**: `src/core/events.ts` line 90
- **Problem**: `onRoundStart: (round) => bus.emit({ type: "round_start", round, stage: "opening" })` — the stage is always `"opening"` even for rebuttal or resolution rounds.
- **Impact**: Consumers of the event bus adapter see incorrect agenda stage for every round after the first. Streaming UI displays wrong phase labels.
- **Fix**: Either pass `stage` through `SpeakerCallbacks.onRoundStart` signature, or remove the `stage` field from the adapter.

### H-2: `checkSafetyBoundaries` ignores `_safetyMode` parameter

- **Severity**: High
- **Location**: `src/core/safety.ts` lines 120–140
- **Problem**: The JSDoc (lines 120–124) documents different behavior for "default" vs "strict" modes. The implementation at lines 132–137 treats all modes identically — every keyword match in every category generates a warning regardless of mode.
- **Impact**: Safety policy cannot be tuned. Documentation is misleading.
- **Fix**: Implement the documented branching or remove the parameter and update docs.

### H-3: All provider adapters cast `response.json()` without runtime validation

- **Severity**: High
- **Location**: `src/runtime/providers/openai.ts` lines 97–111, `src/runtime/providers/google.ts` lines 69–76, `src/runtime/providers/flock.ts` lines 83–87, `src/runtime/providers/anthropic.ts` lines 76–85
- **Problem**: All four adapters do `const data = await response.json() as SomeShape` with no validation. If a provider returns an unexpected shape (error envelope, schema change, empty response), the code proceeds with garbage data.
- **Impact**: Silent corruption instead of clear error. Particularly dangerous for the `usage` fields used in token accounting.
- **Fix**: Add a lightweight runtime check for expected top-level fields (`choices`, `content`, `candidates`, `usage`). A Zod schema per provider would be ideal; a manual guard is acceptable.

### H-4: `fetchWithRetry` overwrites caller's `AbortSignal`

- **Severity**: High
- **Location**: `src/runtime/fetch.ts` lines 51–54
- **Problem**: `{ ...init, signal: controller.signal }` replaces any `init.signal` the caller provides. External cooperative cancellation (e.g., request timeout from orchestrator) is silently lost.
- **Impact**: Callers cannot cancel in-flight requests from outside `fetchWithRetry`. In a large chamber, stuck requests cannot be aborted.
- **Fix**: Compose signals using `AbortSignal.any([controller.signal, init?.signal])` (Node 20+) or manual listener forwarding.

### H-5: `Speaker` instance is not concurrency-safe

- **Severity**: High
- **Location**: `src/core/speaker.ts` lines 45, 73, 299
- **Problem**: `highestStage` is an instance field reset at the start of both `debate()` and `debateStream()`. If two concurrent debates share a `Speaker` instance, one corrupts the other's stage tracking.
- **Impact**: In server/SDK scenarios where `Speaker` is reused, overlapping calls produce incorrect agenda progression.
- **Fix**: Move `highestStage` into a per-debate context object passed through the round loop, not instance state.

### H-6: CLI does not validate user input against Zod schemas

- **Severity**: High
- **Location**: `src/cli/run-debate.ts` lines 40–65
- **Problem**: CLI option values (`mode`, `trace`, `answerMode`, `taskType`) are cast directly to enum types with `as DebateMode`, `as TraceLevel`, etc. No Zod `.parse()` or enum membership check is performed.
- **Impact**: Invalid CLI values like `--mode typo` propagate silently, causing undefined behavior downstream (e.g., `MODE_CONFIGS[mode]` returns `undefined`).
- **Fix**: Use `ParliagentRequest.parse()` on the assembled request object before passing to `Speaker`.

---

## Medium-Severity Issues (P2)

### M-1: Cache `readCache` has no runtime schema validation

- **Severity**: Medium
- **Location**: `src/core/cache.ts` line 63
- **Problem**: `JSON.parse(raw)` is cast to `CacheEntry` without validation. Corrupt or tampered cache files produce garbage objects that pass as valid.
- **Fix**: Add a Zod schema for `CacheEntry` or at minimum check presence of `version`, `response`, and `timestamp` fields.

### M-2: Cache and harvester use empty `catch {}` blocks

- **Severity**: Medium
- **Location**: `src/core/cache.ts` lines 71–72, 106–108; `src/core/harvester.ts` lines 119–121
- **Problem**: I/O failures (disk full, permission denied, JSON corruption) are swallowed silently. No telemetry, no warning, no debug log.
- **Fix**: At minimum `console.warn` or emit a `DebateEvent` of type `warning`.

### M-3: `convergence.ts` type union includes `"entropy_converged"` but never produces it

- **Severity**: Medium
- **Location**: `src/core/convergence.ts` line 16
- **Problem**: `ConvergenceResult.reason` includes `"entropy_converged"` in its type, but `evaluateConvergence` never returns this value. It is set externally in `speaker.ts` by overwriting the result. The type implies `evaluateConvergence` can produce it.
- **Fix**: Remove `"entropy_converged"` from `ConvergenceResult.reason` type. Let `Speaker` use a separate `StopReason` assignment.

### M-4: `textSimilarity` in argument DAG drops non-Latin characters

- **Severity**: Medium
- **Location**: `src/core/argument-dag.ts` lines 38–44
- **Problem**: `replace(/[^a-z0-9\s]/g, "")` strips CJK, Cyrillic, Arabic, etc. For non-English debates, all tokens become empty strings, yielding `similarity = 0` or `NaN`.
- **Impact**: Support matching and critical path extraction are broken for non-English debates. The product supports `--language` flag including Chinese.
- **Fix**: Use Unicode-aware tokenization (e.g., `Intl.Segmenter` or split on whitespace without stripping non-ASCII).

### M-5: `buildMinorityReport` uses count-based majority, not confidence-weighted

- **Severity**: Medium
- **Location**: `src/core/decision-semantics.ts` lines 52–61
- **Problem**: Minority stance is determined by raw count of seats, but the consensus system uses confidence-weighted voting. This inconsistency can mislabel the minority in weighted chambers.
- **Fix**: Weight stance counts by `confidenceScore` for consistency with `computeRoundResult`.

### M-6: `getDisputeParticipants` has no ordering guarantee

- **Severity**: Medium
- **Location**: `src/core/convergence.ts` lines 361–362
- **Problem**: `open.slice(0, maxDisputes)` takes the first N disputes by array order, which is arbitrary (insertion order of `disagreements`). High-severity disputes may be excluded in favor of lower-priority ones.
- **Fix**: Sort by severity or confidence before slicing.

### M-7: Google adapter does not URL-encode model name

- **Severity**: Medium
- **Location**: `src/runtime/providers/google.ts` lines 41–42
- **Problem**: Model string is interpolated directly into the URL path. Model names containing `/`, `:`, or spaces break the URL.
- **Fix**: Use `encodeURIComponent(model)`.

### M-8: `classifyTask` tie-breaking depends on object iteration order

- **Severity**: Medium
- **Location**: `src/core/routing.ts` lines 62–68
- **Problem**: When multiple task types have the same keyword score, the winner depends on `Object.entries()` order, which is insertion order for string keys in V8. This is deterministic but fragile and undocumented.
- **Fix**: Add an explicit priority order or secondary sort.

### M-9: Provider error messages may leak sensitive details

- **Severity**: Medium
- **Location**: `src/runtime/providers/openai.ts` lines 92–94, `src/runtime/providers/google.ts` lines 65–67, `src/runtime/providers/flock.ts` lines 78–80, `src/runtime/providers/anthropic.ts` lines 71–73
- **Problem**: Error messages include the full `response.text()` body from the provider, which may contain internal error details, account info, or rate limit metadata.
- **Fix**: Truncate error bodies and strip potentially sensitive fields before including in thrown errors.

### M-10: `normalizeSchema` does not handle tuple-style `items`

- **Severity**: Medium
- **Location**: `src/runtime/schema-middleware.ts` lines 37–41
- **Problem**: JSON Schema `items` as an array (tuple validation) is not handled. Only single-object `items` is normalized. Tuple schemas pass through unnormalized, potentially causing provider rejection.
- **Fix**: Handle `Array.isArray(node.items)` case.

---

## Low-Severity Issues (P3)

### L-1: `Parliagent.debate()` uses `response!` non-null assertion

- **Severity**: Low
- **Location**: `src/index.ts` line 137
- **Problem**: If the async generator finishes without a return value, `response` stays `undefined` and `!` hides the bug at compile time.
- **Fix**: `if (!response) throw new Error("Debate stream ended without response")`.

### L-2: Dead code — `formatProgress` exported but never called

- **Severity**: Low
- **Location**: `src/cli/format.ts` lines 70–72
- **Fix**: Remove or integrate into the stream renderer.

### L-3: Dead field — `CommandDefaults.progressPrefix` is unused

- **Severity**: Low
- **Location**: `src/cli/run-debate.ts` line 18; set in `ask.ts:17`, `debate.ts:17`, `plan.ts:16`, `review.ts:16` but never read in `runDebate`.
- **Fix**: Remove from interface and all command files.

### L-4: `"Speaker"` magic string used as filter sentinel in multiple files

- **Severity**: Low
- **Location**: `src/cli/format.ts` lines 34–36, 84; `src/core/speaker.ts` line 341
- **Fix**: Extract to a named constant (`SPEAKER_SEAT_ID`).

### L-5: `OpenAIAdapter` and `FlockAdapter` near-duplication

- **Severity**: Low
- **Location**: `src/runtime/providers/openai.ts` vs `src/runtime/providers/flock.ts`
- **Problem**: ~80% structural overlap. Flock lacks the `max_completion_tokens` branch for reasoning models.
- **Fix**: Extract a shared `OpenAICompatibleAdapter` base. Flock overrides auth header and model resolution.

### L-6: `normalizeMessages` uses hardcoded fallback strings

- **Severity**: Low
- **Location**: `src/runtime/messages.ts` lines 12–13, 20, 34
- **Problem**: `"You are a helpful assistant."`, `"Please respond."`, `"Please continue."` are baked in as default messages. These may not be appropriate for all debate contexts.
- **Fix**: Make defaults configurable or co-locate with other prompt constants.

### L-7: Contracts barrel omits DAG schemas

- **Severity**: Low
- **Location**: `src/contracts/index.ts`
- **Problem**: `ArgumentNodeSchema`, `ArgumentEdgeSchema`, `ArgumentDAGSchema` from `trace.ts` are not re-exported. Consumers must import from deep paths.
- **Fix**: Add to barrel exports.

### L-8: `entropy.ts` naming is misleading

- **Severity**: Low
- **Location**: `src/core/entropy.ts`
- **Problem**: Functions named `computeInformationGain` and `isEntropyConverged` actually compute Jaccard distance on token sets, not Shannon entropy or information-theoretic gain.
- **Fix**: Rename to `computeTokenDivergence` / `isTokenConverged` or add a clear module-level doc comment explaining the naming choice.

---

## Test Coverage Gaps

| Area | Gap |
|------|-----|
| `Speaker` concurrency | No test for overlapping `debate()` / `debateStream()` on same instance |
| `debate` vs `debateStream` parity | No test verifying both paths produce identical results for same input |
| `argument-dag` multi-claim | No test with seats having 2–3 claims and objections targeting specific claims |
| Non-English text | `textSimilarity`, `normalizeText` in entropy/DAG untested with CJK/Cyrillic |
| `cache.ts` corruption | No test for malformed JSON, wrong version, concurrent writes |
| `safety.ts` mode branching | No test for `strict` vs `default` mode (since implementation ignores it) |
| `events.ts` adapter stage | No test verifying `eventBusToCallbacks` emits correct stage per round |
| CLI invalid input | No test for `--mode invalidValue` propagation |
| Provider response validation | No test for malformed provider JSON responses |
| `routing.ts` tied scores | No test for task classification with equal keyword counts |

---

## Architecture Observations

### Strengths

- **Modular decomposition**: `round-execution`, `statement-parser`, `decision-semantics`, `convergence` each own a clear slice of the debate lifecycle.
- **Contract-first design**: Zod schemas at the boundary enforce structure. `ParliagentRequest` and `ParliagentResponse` are well-typed.
- **Execution profiles**: `federated/supreme/available` with per-profile concurrency is a clean scaling model.
- **Trace-level observability**: `full` trace with per-round metrics, DAG, and harvester is strong for debugging and production monitoring.
- **Safety layering**: Hard block + soft warnings + security keyword upgrade is a reasonable defense-in-depth pattern.

### Concerns

- **`Speaker` as god-object facade**: Despite the decomposition, `Speaker` still imports 15+ modules and orchestrates the entire debate lifecycle. The `debate`/`debateStream` duplication is the most visible symptom.
- **`ModelPolicy` factory coupling**: `ModelPolicy` hardcodes all four provider constructors. Adding a fifth provider requires editing `policy.ts`.
- **Keyword-based routing and safety**: Task classification, security upgrade, and safety boundaries all rely on keyword lists embedded in code. This works but does not scale to new domains or languages without code changes.
- **No adapter registry pattern**: Providers are instantiated by name in `ModelPolicy` rather than through a registry or plugin system.

---

## Issue Summary

| Severity | Count | Key Examples |
|----------|-------|--------------|
| Critical (P0) | 3 | Ignored API options, debate/stream duplication, DAG edge attribution |
| High (P1) | 6 | Event stage bug, safety mode ignored, no provider validation, signal overwrite, concurrency, CLI validation |
| Medium (P2) | 10 | Cache validation, silent catches, non-Latin text, minority report weighting, URL encoding |
| Low (P3) | 8 | Non-null assertion, dead code, magic strings, adapter duplication, naming |
| Test gaps | 10 | Concurrency, parity, i18n, corruption, invalid input |

**Total: 27 code issues + 10 test coverage gaps.**

## Recommendations

1. **Public API honesty** (C-1): Remove or implement `topology`, `haltingCondition`, and `harvestExhaust` from `ParliagentOptions` before promoting v1.0.0 externally.
2. **DRY the debate loop** (C-2): Extract shared orchestration from `debate()`/`debateStream()` into a private pipeline. This is the single highest-ROI refactor for maintainability.
3. **DAG correctness** (C-3): Fix attack edge attribution so "Proof of Logic" produces meaningful results for multi-claim statements.
4. **Runtime validation at trust boundaries** (H-3, H-6, M-1): Add validation for provider response shapes and CLI input values. These are the most likely sources of silent runtime corruption.
5. **Surface I/O failures** (M-2): Replace empty `catch {}` blocks with at minimum `console.warn` so disk errors are observable.
6. **Non-English support** (M-4): Fix `textSimilarity` tokenization to support CJK and other non-Latin scripts. The product advertises `--language` support.

---

# Review — Parliagent v0.4.1 (+ vNext reliability refactor on main)

## Verdict: PASS (with caveats)

This review focuses on reliability and architecture maturity. The current tree passes `npm run typecheck` and `npm test` (224 tests across 18 files), and the previous critical gaps are materially reduced by the latest refactor: core orchestration is decomposed, structured-output enforcement is stronger at provider level, and decision semantics are less likely to collapse semantic majority into `uncertain`.

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 4/5 | Core flows and contracts are stable; full-chamber behavior is measurable with new trace metrics. |
| Design quality | 4/5 | `Speaker` responsibilities are split into dedicated modules, reducing change-risk concentration. |
| Code quality | 4/5 | Modular boundaries and typed contracts remain strong; tests are comprehensive and passing. |
| Security & robustness | 3/5 | Improved by schema-first output and concurrency controls, but still depends on external provider behavior. |
| Accessibility | 3/5 | No major UI surface in scope. |

## Improvements Verified

### 1) Speaker decomposition reduced core coupling
- **Location**: `src/core/speaker.ts`, `src/core/round-execution.ts`, `src/core/statement-parser.ts`, `src/core/decision-semantics.ts`
- **Verification**: Code inspection + test run
- **Result**: round execution, parsing/recovery, and decision/report semantics now live in separate modules with stable API surface.

### 2) Structured-output hardening now prefers provider-native schema paths
- **Location**: `src/runtime/providers/openai.ts`, `src/runtime/providers/flock.ts`, `src/runtime/providers/google.ts`, `src/runtime/providers/anthropic.ts`
- **Verification**: Code inspection
- **Result**:
  - OpenAI/FLOCK: `response_format: json_schema` when schema is supplied
  - Google: `responseSchema` in generation config
  - Anthropic: explicit schema instruction appended in system guidance

### 3) Decision semantics calibrated for majority-with-reservations
- **Location**: `src/core/decision-semantics.ts`
- **Verification**: Unit/integration tests (`tests/review-fixes.integration.test.ts`)
- **Result**: high alignment with remaining unresolved disputes now maps to `majority` more consistently instead of over-collapsing to `uncertain`.

### 4) Concurrency governance added for large chambers
- **Location**: `src/core/round-execution.ts`, `src/core/config.ts`, `src/contracts/request.ts`, `src/config.ts`, `src/runtime/policy.ts`
- **Verification**: Code inspection + test run
- **Result**:
  - round-level cap: `maxConcurrentSeats`
  - optional per-provider caps via env/config
  - bounded parallel execution path replaces all-at-once pressure spikes.

### 5) Reliability metrics added to full trace
- **Location**: `src/contracts/trace.ts`, `src/core/speaker.ts`
- **Verification**: Schema and tests
- **Result**: trace now records per-round and aggregate parse recovery/degradation counts for production monitoring.

## Remaining Risks

- Full parliament remains high-cost/high-latency; one 32-seat round can still be expensive even with concurrency limits.
- Provider-native schema support quality differs by vendor/model, so degraded parsing cannot be eliminated entirely.
- Provider “implemented/live-validated/benchmarked” levels should continue to be kept explicit in docs and release notes.

## Recommendations

- Treat this as “reliability-forward and production-usable,” not “fully robust under all provider/model mixes.”
- Gate full-parliament production usage on `traceArtifact.totalDegradedParses` and timeout/error thresholds.
- Keep benchmark + live-validation artifacts current before changing public support claims.
# Review — Parliagent v0.4.0

## Verdict: FAIL

This review was performed as a CLI/library review with runtime verification and code inspection. `npm run typecheck` and `npm test` both pass on the current tree, and several older issues are clearly fixed. However, the current implementation still does not justify the “robust” maturity implied by the surrounding handoff narrative. The most important remaining gap is not build breakage but reliability: real full-parliament runs still degrade under load, and the product truth surface remains out of sync with the codebase version and current review status.

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 2/5 | Happy-path behavior works, but full-parliament runtime still does not consistently produce a strong machine-readable convergence outcome. |
| Design quality | 4/5 | The protocol architecture is strong and coherent; this is no longer a design-direction problem. |
| Code quality | 4/5 | The code is modular and disciplined, with meaningful contracts and tests. |
| Security & robustness | 2/5 | Evidence grounding and runtime reliability are still below the bar implied by a “robust” claim. |
| Accessibility | 3/5 | No UI-specific changes were under review; neutral score. |

## Issues Found

### Issue 1: Full-parliament structured-output reliability is still below the bar for a “robust” claim
- **Severity**: Critical
- **Location**: `src/core/speaker.ts:472-598`, `src/core/speaker.ts:601-733`
- **Verification**: Runtime-verified
- **Expected**: With `jsonMode: true`, multi-strategy extraction, and failed-seat isolation in place, full-parliament runs should mostly yield clean structured seat statements rather than repeated degraded recoveries.
- **Actual**: A real `parliagent` `v0.4.0` full-parliament self-review still produced degraded seat outputs such as partial JSON and `Recovered from partial output`, and still ended as `decisionType: "uncertain"` with many unresolved disputes. This means the runtime is improved, but not yet robust.
- **Reproduction**:
  1. Run a real full-parliament self-review via the built CLI:
     ```bash
     node dist/cli/index.js review "<self-review prompt>" --full-parliagent --profile federated --trace full --json --language zh
     ```
  2. Inspect the trace output. In the latest verified run, seats such as `GeminiSeat` and `SmithSeat` still degraded to truncated or recovered partial output, while the overall run ended with `round_limit` and `decisionType: "uncertain"`.
- **Suggested fix**: Move more aggressively toward provider-native schema enforcement and explicit retry-with-feedback on malformed outputs, rather than relying on parser recovery as the primary reliability mechanism.

### Issue 2: Semantic majority still fails to map cleanly to machine-readable convergence
- **Severity**: Major
- **Location**: `src/core/convergence.ts:250-319`, `src/core/speaker.ts:715-733`
- **Verification**: Runtime-verified
- **Expected**: When a full-parliament run reaches clear semantic alignment, the machine-readable result should usually settle on `majority` or `consensus` rather than remaining `uncertain`.
- **Actual**: In the latest full-parliament self-review, the debate text was effectively a broad “mixed, with reservations” consensus, and the trace showed `agreementRatio: 1`, yet the system still returned `decisionType: "uncertain"` because unresolved disputes remained high and the run hit `round_limit`.
- **Reproduction**:
  1. Run the real self-review command above.
  2. Observe that the trace can show strong textual alignment but still end with many open disputes and an `uncertain` machine result.
- **Suggested fix**: Refine the relationship between dispute extraction, dispute closure, and `determineDecisionType()` so that “majority with reservations” can be represented explicitly instead of collapsing into `uncertain`.

### Issue 3: Version and truth-surface documents are still lagging behind the actual shipped code
- **Severity**: Major
- **Location**: `package.json`, `HANDOFF.md`, `REVIEW.md`
- **Verification**: Code-inspection-only
- **Expected**: The main handoff and review artifacts should describe the same version that is actually running on the branch.
- **Actual**: The codebase is now `v0.4.0`, but `HANDOFF.md` is still framed around `v0.3.x Hardening`, and `REVIEW.md` was previously still a `v0.3` fail report until this overwrite. That means the review/handoff surface was not current with the code that was being validated.
- **Reproduction**:
  1. Compare `package.json` version with the headings and status framing in `HANDOFF.md`.
  2. Observe that the handoff narrative is still anchored to `v0.3.x`, despite the package now being `v0.4.0`.
- **Suggested fix**: Update handoff and related review artifacts every time the product version is advanced, so the repo’s operational truth matches the runtime artifact being reviewed.

## Passed Checks
- Runtime-verified: `npm run typecheck` passes on the current tree.
- Runtime-verified: `npm test` passes with `222` tests across `18` files.
- Code inspection: `package-lock.json` is now aligned with `package.json` at `0.4.0`.
- Code inspection: `OpenAIAdapter` now supports `max_completion_tokens` for o-series models and can request JSON mode.
- Code inspection: `EvidenceItem` / `evidenceBundle` are now part of the public request contract in `src/contracts/request.ts`.
- Code inspection: `dist/evaluation` exists, so the previously missing built evaluation artifact issue is resolved.
- Code inspection: `parliamentBeatBaseline` no longer returns contradictory booleans when no baseline is supplied; it now returns `null` in that case.

## Recommendations
- Treat `v0.4.0` as “architecture solid, reliability still maturing,” not as a fully robust release.
- Prioritize full-parliament structured-output success rate and decision-state calibration before making stronger maturity claims.
- Refresh `HANDOFF.md` so versioned delivery truth matches the currently reviewed package. 
