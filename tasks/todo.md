# Parliagent Upgrade Plan — Execution Tracker

## Track 5: Tighten Product Truth and Contracts ✓
- [x] Fix `fullParliagent` Zod default (true→false) to match docs "explicit opt-in"
- [x] Fix `executionProfile` drift: speaker.ts `?? "available"` → `?? "federated"` to match Zod/docs
- [x] Remove self-dependency `"parliagent": "^0.2.4"` from package.json
- [x] Fix version strings: "v0.1.0" → current version in README/SKILL.md deep-mode references
- [x] Align SKILL.md default profile (remove "available" vs "federated" contradiction)
- [x] Fix README env comment that says "available" is default
- [x] Run tests — 151 pass

## Track 1 + 3: Protocol + Convergence ✓
- [x] Add agenda stages to Speaker: opening, rebuttal, resolution
- [x] Add stage-specific prompts (RESOLUTION_PROMPT for dispute resolution)
- [x] Upgrade DisagreementRecord lifecycle (open → resolved | accepted_split)
- [x] Add targeted exchanges: resolution rounds only include dispute participants
- [x] Replace heuristic convergence with issue-level resolution tracking
- [x] Add resolution metrics to RoundResult (resolvedCount, acceptedSplitCount, unresolvedCount)
- [x] Derive decisionType from dispute resolution state, not just stance ratios
- [x] New StopReason: issues_resolved
- [x] Run tests — 177 pass

## Track 2: Evidence-Grounded Deliberation ✓
- [x] Extend SeatStatement with ClaimProvenance (supported, inferred, speculative, missing_evidence)
- [x] Update synthesis to distinguish evidenced vs unverified conclusions
- [x] Surface provenance in trace output
- [x] Run tests — 177 pass

## Track 4: Outcome-Based Evaluation ✓
- [x] Create evaluation rubric (completeness, tradeoff quality, risk recall, calibration, actionability)
- [x] Create 8 evaluation fixtures covering all categories
- [x] parliamentBeatBaseline comparison flag
- [x] Run tests — 187 pass (36 new tests)

## Final verification
- [x] All 187 tests pass
- [x] TypeScript typecheck clean
- [x] HANDOFF.md updated
