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
