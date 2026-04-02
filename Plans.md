# Parliagent — Plans.md

## Overview

Parliagent is a skill-first multi-agent deliberation engine. A Speaker receives a user problem, routes it to selected parliamentary seats, manages debate rounds, and converges on a final answer with traceable reasoning. V1 ships as an npm package with CLI (`parliagent`) and programmatic SDK.

## Features

### 1. Problem Framing and Chamber Selection

- [x] Converts raw prompt into normalized brief (goal, constraints, unknowns, answer mode)
- [x] Speaker selects justified subset of seats per question
- [x] Supports modes: micro (3), fast (5), balanced (7-9), deep (11-13)
- [x] Output includes which seats were activated and why

### 2. Persona Registry and Seat Contracts

- [x] Every seat has structured profile: domain, worldview, strengths, blind spots, speaking style, voting behavior
- [x] Supports named historical personas and abstract functional personas
- [x] Three model self-representatives (OpenAI, Claude, Gemini) as first-class seats
- [x] Registry extensible without changing core protocol

### 3. Multi-Round Debate and Convergence

- [x] Supports opening statements, rebuttals, cross-examination, final synthesis
- [x] Speaker detects: consensus, majority, split, or uncertain
- [x] Configurable stopping: convergence score, disagreement threshold, round/budget limit
- [x] Final answer distinguishes agreed conclusions, contested points, unresolved questions
- [x] Fast-path convergence when first-round is already strong and aligned
- [x] Explicit disagreement records (not flattened into bland merge)

### 4. Output Modes

- [x] Answer modes: answer, memo, plan, review, transcript
- [x] Machine-usable outputs with optional transcript expansion
- [x] Human-readable terminal output and structured JSON
- [x] Verbosity: short, standard, long

### 5. Governance, Safety, and Practicality

- [x] Speaker suppresses duplicate arguments and collapses low-signal speakers
- [x] Safety-sensitive content boundary handling
- [x] Trace data for comparing settings, seat mixes, answer quality
- [x] Deterministic test harness for routing, stopping, output shaping
- [x] Anti-fake-debate: private first response, mandatory disagreement extraction, anti-collapse checks
- [x] Budget circuit breaker with best-effort synthesis (applies between rounds; single parallel rounds may use the full cap)

### 6. Skill-First Packaging

- [x] One shared core powers SDK and CLI
- [x] npm package with stable programmatic interface and CLI entrypoint
- [x] Both surfaces support all debate modes
- [x] Both surfaces expose final-answer-only or answer-plus-trace
- [x] Thin handler adapter for serverless deployment

### 7. Seat Substrate and Model Policy

- [x] Every seat has a predefined substrate policy, not just a persona definition
- [x] If provider-native seats are unavailable, the system falls back deterministically to whatever configured providers exist
- [x] A dedicated `supreme` execution profile routes all seats and synthesis to the operator-designated supreme provider (defaults to primary)
- [x] Chamber-size modes and model-execution profiles are treated as separate controls
- [ ] FLOCK is supported as a fourth provider option via its OpenAI-compatible endpoint

### 8. Language Control and Agent-Native Localization

- [x] The request contract supports an explicit output-language setting (`outputLanguage`)
- [x] Internal debate language is fixed to English and is not user-configurable
- [x] Final answer, warnings, minority reports, open questions, and transcript output can be rendered in one explicit output language
- [x] Output-language selection is available in SDK (`outputLanguage`), CLI (`--language`/`--lang`), config (`defaults.outputLanguage`), and documented in README and SKILL.md
- [x] The system uses English as the stable internal reasoning/debate language, with one output rendering pass into the requested language

## Phases

### Phase 0+1: Spec, Constitution, and Core Slice

**Deliverables:**
- TypeScript interfaces for all contracts
- 33-seat constitution established as the release target
- Speaker, routing, round orchestration, convergence, synthesis
- Budget circuit breaker and anti-fake-debate scaffolding
- Model adapter interface with provider implementations
- Basic CLI (ask, debate, seats)
- Deterministic + fixture-based tests

**Exit Criteria:**
- [x] Draft TS interfaces exist for ParliagentRequest, ParliagentResponse, SeatProfile, SeatStatement, DisagreementRecord, DeliberationTrace
- [x] Convergence heuristic, routing decision tree, and circuit breaker thresholds implemented
- [x] System produces valid ParliagentResponse JSON for benchmark prompts
- [x] At least 2 seats produce materially distinct opening statements per prompt
- [x] Circuit breakers, round limits, stop reasons observable in trace
- [x] Hello World milestone: 1 prompt, Speaker+2 seats, 1 round, valid JSON
- [x] `parliagent ask` returns valid response in micro mode
- [x] `--json` output validates against response schema
- [x] Deterministic tests pass for routing, convergence, budget, schema validation

### Phase 2: Full CLI and SDK Polish ✓

**Deliverables:**
- [x] Complete CLI command set (ask, debate, plan, review, seats, inspect)
- [x] Presets for common tasks (plan→planning taskType+plan answerMode, review→analysis+review answerMode)
- [x] Progressive output during debate (callbacks on seat selection, round start, speaking, completion)
- [x] JSON output for scripting (`--json` on all commands)
- [x] Configuration file / env-var contract (`parliagent.config.json`, `PARLIAGENT_*` env vars)
- [x] Handler adapter for serverless (`src/handler.ts` — Vercel/Lambda/Workers compatible)

### Phase 2.7: Language Support

**Goal:** Make Parliagent language-stable across different host agents while preserving English as the fixed internal debate language and exposing an explicit output-language control.

**Exit Criteria:**
- [ ] `ParliagentRequest` supports `outputLanguage`
- [ ] CLI supports `--language` / `--lang` as an alias for output language
- [ ] Config supports a default output language
- [ ] Seat prompts and debate trace generation remain in English internally
- [ ] Final answer surfaces are rendered in the resolved output language
- [ ] README and `SKILL.md` document the difference between internal debate language and output language

### Phase 2.6: Full Parliament Completion

**Goal:** Ship Parliagent as a genuine 33-seat parliament, not a 12-seat starter plus deferred expansion pack.

**Exit Criteria:**
- [ ] All 33 seats have complete production-grade profiles, not placeholder constitutional definitions
- [ ] All 33 seats have substrate policy metadata (`preferredProvider`, `fallbackChain`, `modelClass`)
- [ ] The registry, CLI, SDK, and docs treat all 33 seats as first-class available seats
- [ ] No public-facing docs refer to the remaining 21 seats as "expansion only" for the release version
- [ ] At least one explicit `full-parliament` invocation path exists for users who want the complete chamber
- [ ] Routing logic can intentionally select any of the 33 seats when relevant

### Phase 2.5: Model Execution Profiles

**Goal:** Make seat identity, fallback behavior, and supreme-provider execution explicit and user-controllable.

**Exit Criteria:**
- [x] Each starter seat has a declared substrate policy: preferred provider, fallback chain, and model class
- [x] If only one provider key exists, all seats still run via deterministic fallback
- [x] If multiple provider keys exist, provider-native seats use their own family when the execution profile permits it
- [x] `supreme` execution profile routes all seats and synthesis to the operator-designated supreme provider
- [x] README and SKILL.md document the difference between chamber mode and execution profile
- [ ] Deterministic fallback behavior validated for 1-provider and provider-native-unavailable scenarios with live calls

### Phase 3A: Live Provider Validation ✓

**Goal:** Prove the engine works outside mocks with real provider behavior, real latency, and real failure surfaces.

**Exit Criteria:**
- [x] `parliagent ask` succeeds in `micro` mode against at least one real provider (Anthropic, 2026-04-02)
- [x] At least one multi-seat run completes with real provider responses and valid JSON output
- [x] Budget circuit breaker verified with real tokens (stopReason=budget at 1885 tokens)
- [x] Provider validation scope documented in README and PUBLISH_CHECKLIST
- [ ] Deterministic fallback behavior validated for 1-provider and provider-native-unavailable scenarios

**Provider scope:** All 4 providers live-validated. Anthropic (10/10 + benchmarked). OpenAI (3/3). Google/Gemini (3/3). FLOCK (6/6). Federated (4/4 with all 4 providers).

### Phase 3A.5: Full Provider Validation

**Goal:** Upgrade provider support from "Anthropic battle-tested, others implemented" to evidence-backed validation across all shipped adapters.

**Exit Criteria:**
- [ ] OpenAI live-validation run completed with real API key and recorded result artifact
- [ ] Google live-validation run completed with real API key and recorded result artifact
- [ ] FLOCK live-validation run completed with real API key and recorded result artifact
- [ ] At least one provider-native / multi-provider run is executed where `OpenAISeat`, `ClaudeSeat`, and `GeminiSeat` resolve to their own families under `federated`
- [ ] At least one FLOCK-backed run is executed with a user-defined FLOCK model name
- [ ] At least one single-provider-FLOCK run demonstrates that the full system works when only FLOCK credentials are configured
- [ ] Provider comparison notes are documented for Anthropic, OpenAI, and Google:
  latency, response-shape quirks, failure modes, and any degraded-seat behavior
- [ ] Provider comparison notes also cover FLOCK as an OpenAI-compatible aggregator:
  model naming, auth, latency, and interoperability notes
- [ ] README, `SKILL.md`, `HANDOFF.md`, and publish docs all use the same provider-support wording
- [ ] No public-facing docs say "implemented but not battle-tested" once validation evidence exists

### Phase 3B: Benchmarking and Evaluation ✓

**Goal:** Measure whether Parliagent is actually better than a flat assistant for the intended task classes.

**Exit Criteria:**
- [x] Benchmark fixtures committed and repeatable (`benchmarks/prompts.json`, 10 prompts)
- [x] Baseline, micro, fast, and balanced modes benchmarked with recorded cost/latency envelopes
- [x] Divergence example: security prompts in fast mode produce 10-11 disagreements and 5-6 warnings vs 0 from baseline
- [x] Diminishing returns example: balanced is 13.3x cost but 9/10 uncertain vs fast at 6.5x cost
- [ ] Full-parliament mode benchmarked on at least a small high-stakes prompt set

**Benchmark scope:** Deep mode was not benchmarked due to cost ($0.15+/run estimated). It is implemented with budget limits (60k tokens / 60s) but not validated with live data.

### Phase 3C: Tuning and Default Policy ✓

**Goal:** Turn evaluation findings into stable defaults rather than leaving the system in an exploratory state.

**Exit Criteria:**
- [x] Default modes documented and justified: `ask`→micro, `plan`/`review`→fast
- [x] Security auto-upgrade applied: micro→fast when security keywords detected
- [x] Balanced documented as "high-stakes only" with evidence
- [x] README and PUBLISH_CHECKLIST reflect final operating model

### Phase 4: Release Readiness and Publish ✓

**Goal:** Ship a trustworthy `npm` package rather than an internally successful prototype.

**Exit Criteria:**
- [x] `npm pack` output reviewed — 60KB, dist/ + README.md + package.json only
- [x] SDK import, CLI bin, and handler adapter validated from packaged artifact
- [x] Publish checklist complete with all evidence items checked
- [x] Package is ready for `npm publish`

### Phase 4.1: Multi-Provider Release Wording

**Goal:** Ensure provider-support claims are evidence-backed and consistent across all user-facing surfaces.

**Exit Criteria:**
- [ ] Provider support matrix in `README.md` matches benchmark/live-validation artifacts
- [ ] `SKILL.md` provider-status section matches `README.md`
- [ ] `HANDOFF.md` provider claims match current artifacts
- [ ] Publish checklist includes explicit verification for Anthropic, OpenAI, Google, and FLOCK support status
- [ ] If any provider remains partially validated, docs clearly distinguish:
  implemented, live-validated, and benchmarked

### Phase 5: 33-Seat Complete Parliament ✓

**Goal:** Upgrade from starter-only release to full 33-seat parliament where every seat is production-grade and invokable.

**Exit Criteria:**
- [x] All 33 seats have production-grade profiles (system prompts, strengths, blind spots, speaking style)
- [x] All 33 seats have substrate policies (preferredProvider, fallbackChain, modelClass)
- [x] All 33 seats are first-class invokable (`isStarter: true`, no expansion-only designation)
- [x] `--full-parliament` flag activates all 33 seats as explicit opt-in
- [x] Chamber presets updated to draw from full roster (not just former starters)
- [x] Full parliament benchmarked: 3 prompts, ~247k tokens, ~44s, 133 avg disagreements
- [x] Documentation updated: README, SKILL.md, Plans.md no longer describe any seats as deferred

**Deferred to future:**
- `deep` mode benchmarking — implemented but not validated with live data
- FLOCK and Google/Gemini benchmarking — live-validated but not benchmarked at scale
- Named celebrity overlays — only revisit after core engine proves value

## Full Parliament Roster (33 seats)

### Core procedural
1. Speaker — process chair, routing, convergence

### Model representatives
2. OpenAISeat — OpenAI model representative
3. ClaudeSeat — Claude model representative
4. GeminiSeat — Gemini model representative

### Computing foundations
5. TuringSeat — computation, universality, formal limits
6. KnuthSeat — algorithms, rigor, engineering judgment
7. DijkstraSeat — correctness, structure, disciplined design
8. ShannonSeat — signal/noise, compression, communication

### Modern computing
9. DistributedSystemsSeat — reliability, scale, failure modes
10. MLSystemsSeat — training, inference, evaluation, compute tradeoffs
11. HumanComputerInteractionSeat — usability, interface clarity, interaction design
12. SecurityPrivacySeat — adversaries, privacy, trust boundaries

### Philosophy
13. AristotleSeat — categories, practical reasoning, virtue
14. KantSeat — principles, duties, universalizable rules
15. NietzscheSeat — hidden motives, value inversion, anti-complacency

### Mathematics
16. EuclidSeat — formal clarity, proof decomposition
17. GaussSeat — elegance, hidden mathematical order
18. VonNeumannSeat — game theory, systems abstraction, applied mathematics

### Physics
19. NewtonSeat — first-principles decomposition
20. EinsteinSeat — conceptual reframing, thought experiments
21. FeynmanSeat — explanation quality, simplification

### Economics and strategy
22. SmithSeat — incentives, coordination, market dynamics
23. KeynesSeat — macro tradeoffs, intervention logic, institutional uncertainty
24. StrategySeat — competition, negotiation, strategic posture

### Psychology and cognition
25. KahnemanSeat — bias detection, judgment pitfalls
26. JungSeat — symbolic framing, archetypes, narrative psychology
27. CognitiveScienceSeat — learning, memory, attention, human constraints

### Product and operations
28. ProductStrategySeat — user value, prioritization, scope
29. DesignCommunicationSeat — explanation, persuasion, presentation
30. OperatorSeat — execution realism, process, bottlenecks

### Civic and ethics
31. LawGovernanceSeat — compliance, legitimacy, institutional rules
32. EthicsHumanImpactSeat — harms, fairness, externalities
33. CitizenPragmatistSeat — common-sense reality check

## Full Parliament Release Rule

For the release to count as the "complete parliament" version:

- all 33 seats must exist in production-grade form
- all 33 must be listable and invokable
- no seat should remain publicized as "future expansion" or "definition only"
- default task routing may still prefer smaller active chambers
- complete parliament does **not** mean all 33 speak on every prompt

This preserves practical runtime cost while making the release genuinely the full constitutional parliament.

## Provider Validation Strategy

Provider support should be described in three separate levels:

1. `implemented`
   Adapter exists, typechecks, unit tests pass.
2. `live-validated`
   Real API key used successfully in at least one end-to-end validation flow.
3. `benchmarked`
   Included in comparative benchmark or quality/cost/latency measurements.

The docs should never blur these.

### Minimum validation matrix

For each provider (`Anthropic`, `OpenAI`, `Google`, `FLOCK`), run:

- one `micro` ask
- one multi-seat debate
- one schema-valid `trace=full` run
- one failure-path observation if feasible (timeout, bad key, retry, or degraded seat)

For multi-provider behavior, run at least:

- one `federated` profile call with multiple keys present
- verify that `OpenAISeat`, `ClaudeSeat`, and `GeminiSeat` resolve to their own families when available
- one FLOCK-backed call with a user-specified model name
- one "FLOCK only" environment where all seats resolve cleanly through FLOCK fallback

### Required artifacts

Store results as reproducible evidence in `benchmarks/results/`, with one artifact per provider and at least one federated artifact.

### Documentation rule

Once OpenAI and Google have live validation artifacts, replace wording like:

- "implemented but not battle-tested"

with provider-specific status language based on evidence:

- implemented
- live-validated
- benchmarked

## FLOCK Provider Strategy

FLOCK should be integrated as a **fourth provider option** using its OpenAI-compatible chat completions endpoint, not as a separate orchestration path. According to the FLOCK API docs, the base URL is `https://api.flock.io/v1`, requests are OpenAI-compatible, and authentication uses the `x-litellm-api-key` header rather than the standard OpenAI bearer token style ([FLOCK API Endpoint](https://docs.flock.io/flock-products/api-platform/api-endpoint)).

### Why FLOCK matters

- It gives users a fourth provider option beyond the three major model vendors.
- It can act as a universal fallback path when a user only has one FLOCK key.
- It can route to models from multiple ecosystems while fitting into the existing OpenAI-compatible adapter shape.
- It reduces the risk that users without direct vendor keys are locked out of the complete parliament experience.

### Integration rule

Treat FLOCK as:

- a first-class provider in config and runtime policy
- an OpenAI-compatible transport at the HTTP layer
- a user-defined model source at the model-name layer

Do **not** treat FLOCK as equivalent to provider-native OpenAI / Anthropic / Google behavior for representative-seat claims. It is a transport/provider option, not evidence that native vendor APIs are unavailable or unnecessary.

### Required config surface

Add support for:

- `FLOCK_API_KEY`
- `FLOCK_BASE_URL` with default `https://api.flock.io/v1`
- `FLOCK_MODEL`
- `PARLIAGENT_PRIMARY_PROVIDER=flock`
- `PARLIAGENT_SUPREME_PROVIDER=flock`

Config file equivalents should also exist.

### Model naming

FLOCK model names should be explicitly user-configurable because the endpoint can expose many upstream models. The runtime must not guess or hardcode a single FLOCK model as globally correct for all users.

### Safe interaction with existing logic

The most efficient design is:

- implement one FLOCK adapter that conforms to the existing adapter interface
- keep seat substrate policies unchanged
- allow FLOCK to satisfy fallback chains via `primary` / `any-available`
- allow `supreme` to point at FLOCK if the operator wants one designated provider for the whole debate

### Testing requirements

Minimum FLOCK validation should include:

- one `micro` ask with `FLOCK_MODEL`
- one multi-seat debate
- one `trace=full` schema-valid run
- one run where FLOCK is the **only** configured provider
- one run where FLOCK is selected as `primary`
- one run where FLOCK is selected as `supreme`

### Documentation sync requirements

When FLOCK lands, update:

- `README.md`
- `SKILL.md`
- `HANDOFF.md`
- publish checklist
- provider status matrix

They must all explain:

- that FLOCK is OpenAI-compatible
- that it uses `x-litellm-api-key`
- that model names are user-configurable
- that FLOCK can act as a universal fallback provider
- that provider-native seat semantics are still distinct from vendor-native APIs

## Seat Substrate Policy

Each seat should have two independent definitions:

1. `seat identity`
   The worldview, method, strengths, and speaking style.
2. `substrate policy`
   Which model family the seat prefers, and how it falls back if that family is unavailable.

For each seat in the 33-seat parliament, define:

- `preferredProvider`: `openai` | `anthropic` | `google` | `primary`
- `fallbackChain`: ordered list such as `["preferred", "primary", "any-available"]`
- `modelClass`: `chair` | `frontier` | `support`

Minimum required policy:

- `Speaker`: `preferredProvider=primary`, `modelClass=chair`
- `OpenAISeat`: `preferredProvider=openai`, fallback to `primary`, then `any-available`
- `ClaudeSeat`: `preferredProvider=anthropic`, fallback to `primary`, then `any-available`
- `GeminiSeat`: `preferredProvider=google`, fallback to `primary`, then `any-available`
- all other seats: `preferredProvider=primary`, fallback to `any-available`

This preserves seat identity even when the user only has one provider configured.

## Language Support Strategy

The most efficient and highest-quality language strategy is:

- **English for internal debate**
- **Configurable language for final output**

### Principle

For each run, keep exactly one canonical internal debate language:

- all opening statements use English
- all rebuttals use English
- all disagreement extraction operates on English seat outputs
- all synthesis reasoning operates on English debate trace

Then render the user-facing output into one resolved output language.

This avoids:

- lower-quality non-English internal debate on frontier models that reason best in English
- mixed-language internal traces when different host agents default differently
- exposing provider-language drift as part of the product behavior

### Request Contract

Add an explicit request field for output only:

- `outputLanguage`
  A user-facing selector for the final rendered output

Recommended behavior:

- if `outputLanguage` is explicitly set, it wins
- if `outputLanguage` is omitted, resolve once using host/user defaults
- do not let individual seats choose their own output language independently
- do not expose user-configurable internal debate language in v1

Recommended shape:

- support simple strings such as `"en"`, `"zh"`, `"ja"`, `"es"` or BCP-47 style tags such as `"en-US"`, `"zh-CN"`
- normalize internally to a single `resolvedOutputLanguage`

### Efficient Runtime Design

Use the following strategy:

1. Keep debate prompts and seat outputs in English
2. Add one output-language instruction to the synthesis/rendering stage:
   "Render the final user-facing output entirely in `<resolvedOutputLanguage>`"
3. Store the resolved output language in trace metadata and/or response metadata
4. If transcript output is requested, render the transcript in the requested output language as a final presentation layer
5. Do not change the internal debate language based on the user's locale

This is cheaper and more reliable than:

- forcing all seats to debate natively in non-English languages
- letting each seat drift into the host agent's language
- trying to infer language separately at each round

### Agent-Native Behavior

Different agent hosts may speak different default languages. Parliagent should therefore expose a clear override rather than relying on host behavior.

Recommended priority order:

1. explicit request `outputLanguage`
2. CLI flag / SDK param
3. config default
4. one-time host/user language inference
5. final fallback: English output

### CLI and Config Surface

Add:

- CLI:
  `--language <code>` and alias `--lang <code>`
- config:
  `PARLIAGENT_DEFAULT_OUTPUT_LANGUAGE`
  `defaults.outputLanguage`

### Documentation Sync Requirement

When language support lands, update all of:

- `README.md`
- `SKILL.md`
- request contract docs
- CLI help text

They must all explain:

- how to force the output language explicitly
- what happens when output language is omitted
- that internal debate remains in English
- that output rendering can be localized without changing the internal debate language

## Execution Profiles

Debate mode and execution profile should be separate knobs.

- `mode`
  Controls chamber size and rounds: `micro` | `fast` | `balanced` | `deep`
- `executionProfile`
  Controls which model backends the seats actually use

V1 execution profiles:

- `available`
  Use whatever providers are configured. Seats follow their fallback chain until a usable adapter is found.
- `federated`
  Prefer provider-native behavior for `OpenAISeat`, `ClaudeSeat`, and `GeminiSeat`. Other seats use the configured primary provider unless unavailable.
- `supreme`
  Ignore seat-native diversity and run every debate seat plus synthesis on the operator-designated supreme provider.

## Full Parliament Mode

In addition to the chamber-size modes, the complete release should expose an explicit way to invoke the full 33-seat parliament for showcase, flagship, or maximal-deliberation runs.

Required behavior:

- support a `full-parliament` invocation path or equivalent flag
- default users should still prefer `micro` / `fast` / `balanced` / `deep`
- full parliament is opt-in because of cost and latency
- benchmark it on a small number of important prompts before recommending it

## Supreme Mode

`supreme` routes all debate seats and synthesis to a single provider for uniform quality. It does **not** automatically detect "the strongest model" — it uses an explicit operator choice.

Resolution rule:

1. If `PARLIAGENT_SUPREME_PROVIDER` is set, use that provider
2. Otherwise, fall back to the configured primary provider
3. If only one provider is configured, `supreme` collapses to that provider (same as `available`)

Config surface:

- `PARLIAGENT_SUPREME_PROVIDER` — env var, explicit provider ID
- `supremeProvider` — config file field
- Model override within the supreme provider follows that provider's `defaultModel` config

Recommended use:

- `available` — general default, seats follow their fallback chain
- `federated` — when you want provider-native seat diversity
- `supreme` — when you want all seats on one designated provider for uniform quality

## Out of Scope (v1)

- Full historical simulation accuracy
- Public web UI
- Running the entire roster on every query by default
- Autonomous tool use by members
- Domain-certified professional advice
- Hosted API service
- Named celebrity overlays
