# Lessons Learned

## Review Round 2

## Pattern: Schema constraints must match all production code paths

**Trigger**: Review Issue 1 — `DisagreementRecord.seats` had `min(2)` but `risk_warning` records only carry 1 seat.

**Rule**: When a schema defines a minimum cardinality, verify that *every* code path creating that type can satisfy it. Risk/warning records are fundamentally single-party; two-party minimums should not apply to them.

**Test**: Add schema validation tests for every data path that constructs schema objects, not just the happy path.

---

## Pattern: Fallback logic must respect exclusion constraints

**Trigger**: Review Issue 2 — `?? preset.modelSeatPool[0]` reintroduced an excluded seat.

**Rule**: Never use a fallback that bypasses the filter that preceded it. If `find()` returns `undefined` after applying exclusions, the fallback must either be `undefined` (skip), or draw from a pre-filtered set. The `??` operator after a `.find()` that checks exclusions effectively *undoes* the exclusion.

**Test**: Test edge cases where all items in a pool are excluded.

---

## Pattern: Separate orchestration adapter from member adapters

**Trigger**: Review Issue 3 — synthesis used `assignments.values().next().value` which picked a random speaking seat.

**Rule**: The Speaker/orchestration model is conceptually separate from debate members. Never infer the orchestration backend from a member assignment map. Use `primaryAdapter` explicitly.

**Test**: Test with distinct mock adapters for primary vs member seats and verify synthesis uses the primary.

---

## Pattern: Safety helpers must be called, not just defined

**Trigger**: Review Issue 4 — `isHardBlocked()` existed as a pure function but had no call site.

**Rule**: If a safety function exists, it must be wired into the main execution path. Dead safety code is worse than no safety code because it creates false confidence. Every safety function must have an integration test proving it is actually invoked.

**Test**: Test that hard-blocked prompts never reach the LLM (spy on adapter.complete, assert 0 calls).

---

## Pattern: Exposed contract fields must have runtime effect or be removed

**Trigger**: Review Issue 5 — `safetyMode` was in the request schema and config but unused.

**Rule**: Public API surface should not include fields with no runtime behavior. Either wire them in or defer them to a future version. Documented-but-dead options mislead users into thinking they have control they don't.

**Test**: For every field in the public request/config schema, ensure at least one test verifies its runtime effect.

---

## Review Round 3

## Pattern: Never discard provider-reported metrics

**Trigger**: Review Issue 1 — `CompletionResult.tokensUsed` was discarded; budget tracked heuristic estimates.

**Rule**: When a provider returns actual usage data (tokens, latency, cost), always feed it back into the budget/tracking system. Heuristic estimates should only be fallbacks for when the provider returns 0 or null.

---

## Pattern: Contract fields must be threaded end-to-end

**Trigger**: Review Issue 2 — `seed` accepted in request schema and CLI but never passed to adapter.

**Rule**: When adding a field to a public contract, trace its path from user input → request → core logic → external call → response. If the path is incomplete, the field is dead code. Grep for the field name across the codebase after implementation.

---

## Pattern: Build tools belong in devDependencies

**Trigger**: Review Issue 3 — `typescript` and `tsx` in production dependencies inflated install by 50MB.

**Rule**: Any tool that only runs at build/dev time (compilers, test runners, bundlers, formatters) goes in devDependencies. Check `npm pack --dry-run` to verify what ships.

---

## Pattern: Network calls need retry, timeout, and backoff

**Trigger**: Review Issue 4 — single `fetch()` with no timeout, no retry.

**Rule**: Every external HTTP call should have: (1) a timeout via AbortController, (2) at least 1 retry for transient errors (429, 5xx), (3) exponential backoff. Create a shared utility rather than duplicating per-provider.

---

## Pattern: Extract command pattern when >2 commands share structure

**Trigger**: Review Issue 5 — 4 CLI commands sharing ~80% identical code.

**Rule**: When multiple commands share request construction, error handling, and output formatting, extract a `runCommand(prompt, opts, defaults)` utility. Each command becomes a thin wrapper that sets its defaults.

---

## Pattern: API keys belong in headers, not URLs

**Trigger**: Review Issue 6 — Google API key in URL query parameter leaks into logs.

**Rule**: Always prefer header-based authentication. URL query params appear in server logs, CDN logs, and error reporting. If a provider's documentation shows query param auth, check if header auth is also supported.

---

## Pattern: Enable strict compiler checks from the start

**Trigger**: Review Issue 7 — dead code survived because `noUnusedLocals` was off.

**Rule**: Enable `noUnusedLocals: true` and `noUnusedParameters: true` from project setup. It catches dead code at compile time. Prefix intentionally unused params with `_`.

---

## Pattern: Config loading should warn, not silently fail

**Trigger**: Review Issue 11 — malformed config file silently ignored.

**Rule**: When a user creates a config file, they expect it to be used. If parsing fails, emit a `console.warn` so the user knows. Silent fallback to defaults is invisible and confusing.

---

## Pattern: Validate env vars through the schema, not `as any`

**Trigger**: Review Issue 12 — env values cast with `as any` bypassed Zod validation.

**Rule**: When an env var maps to a Zod-validated field, always parse it through the Zod schema first. `as any` defeats the purpose of having runtime validation.
