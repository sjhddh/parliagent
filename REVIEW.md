# Review — Parliagent Upgrade (v0.3)

## Verdict: FAIL

This review was performed as a CLI/library code review with shell verification and code inspection. `npm run typecheck` and `npm test` both pass on the current worktree, but the upgraded protocol/evaluation claims in `HANDOFF.md` are not fully supported by the implementation. Two logic bugs are directly reproducible at runtime, and the current package artifact is not aligned with the claimed release state.

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Functionality | 2/5 | Core upgrade semantics are not reliable: issue-centered convergence can still stop with open disputes, and the new baseline comparison metric is broken. |
| Design quality | 3/5 | Direction is stronger than v0.2, but the resolution protocol is still only partially realized in code. |
| Code quality | 3/5 | Modules are tidy and tests are extensive, but several tests are too weak to catch the main regressions. |
| Security & robustness | 3/5 | No secret leaks or validation failures found in reviewed files, but package/release truth is drifting from the actual artifact. |
| Accessibility | 3/5 | No web UI changes were part of this review; score held neutral. |

## Issues Found

### Issue 1: Debate can stop as `converged` while disputes remain open
- **Severity**: Critical
- **Location**: `src/core/convergence.ts:271-291`
- **Verification**: Runtime-verified
- **Expected**: The new issue-centered convergence model should not return a successful convergence stop reason while any dispute is still open.
- **Actual**: After the `issues_resolved` check, the code still falls through to the old stance-ratio branch and can return `reason: "converged"` even when `unresolvedCount > 0`.
- **Reproduction**:
  1. Run:
     ```bash
     node --input-type=module -e "import { evaluateConvergence } from './dist/core/convergence.js'; import { MODE_CONFIGS } from './dist/core/config.js'; const statements=[{seatId:'A',round:2,stance:'support',summary:'s',claims:['c'],objections:[],confidence:4,warnings:['warn']},{seatId:'B',round:2,stance:'support',summary:'s',claims:['c'],objections:[],confidence:4}]; const prior=[{id:'D1',topic:'risk',seats:['A'],type:'risk_warning',status:'open'}]; console.log(JSON.stringify(evaluateConvergence({statements,modeConfig:MODE_CONFIGS.fast,currentRound:2,priorDisagreements:prior}), null, 2));"
     ```
  2. Observe the result returns `"reason": "converged"` while the round still contains an open `risk_warning`.
- **Suggested fix**: Gate the stance-based convergence branches on `unresolvedCount === 0`, or only allow them when `roundResult.disagreements.length === 0`.

### Issue 2: `parliamentBeatBaseline` is mathematically inconsistent and gives contradictory results
- **Severity**: Critical
- **Location**: `src/evaluation/rubric.ts:57-72`, `src/evaluation/rubric.ts:275-288`
- **Verification**: Runtime-verified
- **Expected**: Baseline comparison should use the same unit and rubric scale on both sides, so the flag meaningfully answers whether parliament outperformed baseline.
- **Actual**: The code compares raw `totalScore` against two incompatible baseline units:
  - with `baselineResponse`, a rough 0-5 side score
  - without `baselineResponse`, `percentScore * 0.6` on a 0-60 scale
  The same response can therefore produce `parliamentBeatBaseline: true` in one branch and `false` in the other.
- **Reproduction**:
  1. Run:
     ```bash
     npx tsx -e "import { evaluateResponse, EVALUATION_FIXTURES } from './src/evaluation/rubric.ts'; const fixture=EVALUATION_FIXTURES.find(f=>f.id==='arch-tradeoff'); const response={finalAnswer:'Use a modular monolith first, then extract services later. This balances team size, complexity, and scale concerns while preserving delivery speed.',decisionType:'majority',activatedSeats:['Speaker','DijkstraSeat','OperatorSeat'],whyTheseSeats:'Architecture tradeoff',minorityReport:'OperatorSeat: microservices too early',openQuestions:['How fast will the team grow?'],warnings:['Complexity risk for small team'],debateSummary:'Round 1 debate'}; console.log('withBaseline', JSON.stringify(evaluateResponse(fixture,response,'Just use microservices.'), null, 2)); console.log('withoutBaseline', JSON.stringify(evaluateResponse(fixture,response), null, 2));"
     ```
  2. Observe the same response yields `parliamentBeatBaseline: true` with a baseline string and `false` without one.
- **Suggested fix**: Score the baseline with the same five dimensions and compare normalized percentages, or remove the flag until there is a valid apples-to-apples baseline rubric.

### Issue 3: The resolution protocol is still gated away from the common one-dispute case
- **Severity**: Major
- **Location**: `src/core/speaker.ts:308-332`
- **Verification**: Code-inspection-only
- **Expected**: Once the system advertises a dedicated resolution round, the common case of a single open seat-vs-seat conflict should be eligible for that path.
- **Actual**: `determineStage()` only upgrades to `resolution` when there are at least 2 open `claim_conflict` records. A normal 2-seat disagreement produces 1 conflict and remains in generic `rebuttal`, which undercuts the stated “procedural parliament protocol” upgrade.
- **Reproduction**:
  1. Read the threshold in `determineStage()`.
  2. Compare it with the upgrade claim in `HANDOFF.md` that resolution rounds are used for dispute resolution and targeted exchange.
- **Suggested fix**: Trigger `resolution` on any meaningful open `claim_conflict`, or explicitly narrow the product claim and tests to match the current threshold.

### Issue 4: `package-lock.json` still contains the removed self-dependency
- **Severity**: Major
- **Location**: `package-lock.json:11-15`, `package-lock.json:210-225`
- **Verification**: Code-inspection-only
- **Expected**: After removing the self-dependency from `package.json`, the lockfile root package should no longer list `parliagent`, and there should not be a nested `node_modules/parliagent` entry caused by the old dependency.
- **Actual**: `package.json` no longer includes `"parliagent": "^0.2.4"`, but `package-lock.json` still does. This directly contradicts `HANDOFF.md`, which claims Track 5 removed the self-dependency cleanly.
- **Reproduction**:
  1. Compare `package.json` dependencies with `package-lock.json`.
  2. Observe the root lock entry still lists `parliagent`, and a nested `node_modules/parliagent` package remains present.
- **Suggested fix**: Regenerate `package-lock.json` after the dependency removal and verify that the self-reference disappears from the root package entry.

### Issue 5: Current source changes are not reflected in the built artifact
- **Severity**: Major
- **Location**: `src/evaluation/rubric.ts`, `dist/`
- **Verification**: Runtime-verified
- **Expected**: A handoff that claims final verification and a completed upgrade should have a current build artifact matching the reviewed source tree.
- **Actual**: The new evaluation source exists, but the built artifact does not contain `dist/evaluation/`. On the current worktree, `ls dist/evaluation` fails.
- **Reproduction**:
  1. Run:
     ```bash
     ls "/Users/JiahaoRBC/Git/sun-parliament/dist/evaluation"
     ```
  2. Observe `No such file or directory`.
- **Suggested fix**: Rebuild before handoff and verify the packaged artifact, or avoid claiming final verification/package readiness until the artifact matches source.

## Passed Checks
- Runtime-verified: `npm run typecheck` passes on the current worktree.
- Runtime-verified: `npm test` passes with `210` tests across `17` files.
- Code inspection: `fullParliagent` request default is now `false` in `src/contracts/request.ts`, matching the documented “explicit opt-in” behavior.
- Code inspection: `Speaker` now defaults `executionProfile` to `"federated"`, aligning runtime with the request schema and docs.
- Code inspection: `claimProvenance`, `AgendaStage`, and dispute lifecycle fields are wired through contracts, synthesis, and tests.

## Recommendations
- Fix the convergence stop-order first; it invalidates the main protocol claim.
- Rework `parliamentBeatBaseline` before using it in any benchmark, dashboard, or release narrative.
- Regenerate the lockfile and rerun build/package verification so the artifact matches the source and handoff claims.
