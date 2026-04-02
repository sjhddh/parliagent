# Plan Review — Sun Parliament v1

## Verdict: CONDITIONAL PASS

The plan demonstrates strong product vision, well-considered constitutional design, and genuine intellectual rigor. It is one of the more thoughtful multi-agent deliberation specs I have seen. However, it over-indexes on rationale and philosophical justification at the expense of actionable implementation detail. Several critical engineering concerns are absent or hand-waved. The plan needs a focused tightening pass before Phase 1 implementation begins.

---

## Scores

| Dimension | Score | Notes |
|-----------|-------|-------|
| Vision and product clarity | 5/5 | Exceptional. The "skill-first" framing, CLI shape, and active-chamber policy are sharp and well-argued. |
| Scope discipline | 3/5 | Acceptable but strained. Out-of-scope is explicit, but the in-scope surface is still very large for a v1. |
| Actionability | 2/5 | Below bar. Phase deliverables and exit criteria are too soft to drive implementation without guesswork. |
| Technical depth | 2/5 | Below bar. Core algorithmic problems (convergence, routing) are named but not defined. No tech stack, no data model, no error handling design. |
| Risk management | 3/5 | Risks are listed but mitigations are absent. Cost estimation is missing despite budget being a stated first-class concern. |

---

## Critical Issues

### Issue 1: Convergence algorithm is undefined

- **Severity**: Critical
- **Location**: Feature 3 (Multi-Round Debate and Convergence), lines 436-448
- **Problem**: The plan states "the Speaker can detect consensus, majority position, split decision, or irreducible uncertainty" and mentions "convergence score, disagreement threshold, round limit, or budget limit" as stopping inputs. But it never defines what a convergence score IS, how it is computed, what threshold values look like, or what algorithm drives it. This is the single hardest engineering problem in the system and it receives the least specification.
- **Impact**: An implementer facing this spec will have to invent the convergence mechanism from scratch, with no guidance on whether it should be embedding-similarity-based, claim-extraction-based, voting-based, or something else. This will cause rework.
- **Suggested fix**: Add a dedicated "Convergence Model" section defining at minimum: (a) how agreement/disagreement is measured between seat outputs, (b) what numeric or categorical signal the Speaker uses to decide whether another round is needed, (c) concrete threshold defaults for each mode. Even a simple heuristic definition would be better than none.

### Issue 2: No concrete data model or schema

- **Severity**: Critical
- **Location**: Skill Contract section (lines 617-666), npm Package Plan (lines 668-696)
- **Problem**: The plan lists field names (`prompt`, `mode`, `finalAnswer`, `decisionType`, etc.) but provides no TypeScript interfaces, JSON Schema definitions, or structural validation rules. The `traceArtifact` field — arguably the most complex data structure in the system — is mentioned once and never defined.
- **Impact**: Without a schema, the "one input schema, one deliberation trace schema, and one output schema" promise (line 34) is aspirational, not specified. Phase 0 exit criteria ("the input/output contract is agreed") cannot be verified.
- **Suggested fix**: Define draft TypeScript interfaces for `ParliamentRequest`, `ParliamentResponse`, `DeliberationTrace`, `SeatStatement`, and `DisagreementObject`. These do not need to be final, but they need to exist.

### Issue 3: Multi-provider integration is assumed but not designed

- **Severity**: Critical
- **Location**: Model Self-Representation Layer (lines 289-298), v1 Starter Roster (lines 824-854)
- **Problem**: The plan requires `OpenAISeat`, `ClaudeSeat`, and `GeminiSeat` each backed by their "corresponding best-available model family." This implies the v1 system must integrate with three different LLM provider APIs (OpenAI, Anthropic, Google). This is a significant engineering effort involving three different authentication schemes, three different streaming/completion APIs, three different rate limiting behaviors, and three different error surfaces. The plan treats this as a roster design decision but never discusses it as an engineering problem.
- **Impact**: If multi-provider integration is a v1 requirement, it probably doubles the Phase 1 timeline. If it can be deferred (all seats on one provider initially), the plan should say so explicitly.
- **Suggested fix**: Add a "Provider Integration Strategy" section. Decide whether v1 ships with one provider (Policy A default) or three. If three, scope the adapter layer explicitly. If one, clarify that model-seat provider-native behavior is a v1.1 goal.

---

## Major Issues

### Issue 4: Phase exit criteria are too soft

- **Severity**: Major
- **Location**: Phases section (lines 496-547)
- **Problem**: Phase 0 exits when "the roster is stable enough" and "the input/output contract is agreed." Phase 1 exits when the system "can run end-to-end on sample questions." Phase 2 exits when "an agent or CLI user can invoke the parliament in one step." These are directionally correct but not testable. What is "stable enough"? Which sample questions? What does "one step" mean technically?
- **Impact**: Without crisp exit criteria, phases will either never end or be declared done prematurely. This is the most common failure mode in multi-phase projects.
- **Suggested fix**: Define 3-5 concrete, binary pass/fail checks per phase. Example for Phase 1: "The system produces a valid `ParliamentResponse` JSON for the 5 benchmark prompts listed in `benchmarks/v1.json`, with at least 2 seats producing materially distinct opening statements per prompt."

### Issue 5: No testing strategy

- **Severity**: Major
- **Location**: Entire plan — absent
- **Problem**: The plan mentions "a deterministic test harness for non-generation logic" (line 475) as an acceptance criterion, but never discusses how testing will work. There is no mention of: how to mock LLM calls during development, unit test scope, integration test design, how to evaluate debate quality beyond manual reading, or CI strategy.
- **Impact**: Without a test strategy, the "anti-fake-debate" guarantees and convergence behavior cannot be verified systematically. The plan's own emphasis on reproducibility (`seed` parameter) demands a test harness, but none is scoped.
- **Suggested fix**: Add a "Testing Strategy" section covering: (a) deterministic tests for routing, stopping, and output formatting; (b) fixture-based tests with recorded LLM outputs; (c) a small set of golden-file benchmark prompts with expected behavioral properties.

### Issue 6: Cost estimation is completely absent

- **Severity**: Major
- **Location**: Budget circuit breaker references (lines 477, 590), mode definitions (lines 219-228)
- **Problem**: The plan repeatedly emphasizes budget discipline, token control, and latency awareness as first-class concerns. It defines five deliberation modes with different seat counts. But it never estimates what any of these modes cost. How many tokens does a "micro" 3-seat debate consume? What about "deep" with 13 seats and 3 rounds? Without even order-of-magnitude estimates, the circuit breaker thresholds cannot be set, and the product cannot be priced or budgeted.
- **Impact**: Users who adopt the tool will have no cost predictability. The "hard budget circuit breaker" feature cannot be meaningfully implemented without knowing what budgets are reasonable.
- **Suggested fix**: Add a back-of-envelope cost model. Example: if each seat produces ~500 tokens per round, a 5-seat / 2-round "fast" debate consumes ~5000 output tokens + ~2000 system/prompt tokens per seat = ~17k tokens total. This gives implementers and users a frame of reference.

### Issue 7: Routing logic is underspecified

- **Severity**: Major
- **Location**: Active Chamber Policy (lines 217-239), Problem Framing feature (lines 405-417)
- **Problem**: The plan provides example chamber compositions for task types (coding, writing, strategy, ethics) but does not define how the Speaker decides which template to use. Is this keyword matching? LLM classification? User-provided `taskType`? What happens when the question spans multiple task types? What if the user provides `seatHints` that conflict with the Speaker's routing?
- **Suggested fix**: Define the routing decision tree. Even a simple "if `taskType` is provided, use the corresponding preset; otherwise, the Speaker classifies the prompt into one of N categories using a short LLM call" would be sufficient for v1.

---

## Minor Issues

### Issue 8: Plan conflates specification with rationale

- **Severity**: Minor
- **Location**: Throughout — "Why This Mix Works" (lines 189-193), "Why These 12 First" (lines 857-863), "Should It Be Random?" (lines 347-362)
- **Problem**: The document is ~900 lines. Roughly 30-40% is justification for decisions rather than the decisions themselves. This is valuable as a design rationale document, but it makes the plan harder to use as an implementation reference. An implementer searching for "what do I build" has to skim past "why we decided this."
- **Suggested fix**: Consider splitting into two documents: a concise `Plans.md` (features, phases, schemas, exit criteria) and a `DESIGN_RATIONALE.md` (the "why" sections). The plan stays actionable; the rationale stays available for context.

### Issue 9: Contradictory starting point recommendation

- **Severity**: Minor
- **Location**: Recommended Starting Point (lines 601-611), specifically line 605
- **Problem**: Line 605 says "finalize the first overlay pack for startup, product, crypto, and internet-native discourse." But line 893 says "The first package should not ship named overlays. Overlay exploration belongs in a later release." These directly contradict each other.
- **Suggested fix**: Remove the overlay reference from the Recommended Starting Point section, or clarify that "finalize" means "design for future use" not "implement."

### Issue 10: No streaming or progressive output design

- **Severity**: Minor
- **Location**: CLI Design (lines 698-734), Output Modes (lines 449-461)
- **Problem**: A multi-round debate with 5-13 seats and 2-3 rounds will take significant wall-clock time (potentially 30-120 seconds). The plan describes final output formats but says nothing about what the user sees while waiting. No mention of streaming, progress bars, or intermediate output. For a CLI tool, this is a meaningful UX gap.
- **Suggested fix**: Add a brief note on progressive output: at minimum, the CLI should display which seats are speaking and which round is active as the debate unfolds.

### Issue 11: No error handling or operational failure design

- **Severity**: Minor (but will become Major during implementation)
- **Location**: Absent from plan
- **Problem**: What happens when an LLM provider returns a 429 (rate limit)? When a seat's model call times out? When a response is malformed? When the user's API key is invalid? The plan discusses "budget circuit breakers" for cost control but not operational failure handling.
- **Suggested fix**: Add a "Failure Modes" subsection defining behavior for: provider unavailability, timeout, malformed response, and partial debate completion.

### Issue 12: Versioning discussion is premature

- **Severity**: Minor
- **Location**: Future Evolution (lines 376-385), Versioning Strategy (lines 785-798)
- **Problem**: The plan discusses v1, v1.5, v2, v3 evolution and versioning strategy in detail. None of this is actionable until v1 ships. It adds bulk without aiding implementation.
- **Suggested fix**: Retain one sentence ("Versioning will follow semver; major constitutional changes are release-note-worthy") and move the rest to a future planning document.

---

## What the Plan Gets Right

These are genuine strengths, not participation trophies:

- **The "skill-first" product shape is correct.** Designing for agent invocation first and CLI second is the right priority order for this kind of tool. Most multi-agent projects get this backwards by building a UI first.
- **The active-chamber policy is well-designed.** Separating canonical roster from active chamber is the key insight that makes the system practical rather than a toy. The mode tiers (micro/fast/balanced/deep) are clean.
- **Anti-fake-debate as a first-class concern is rare and valuable.** Most multi-agent debate systems ship impressive demos that collapse into paraphrase mills under scrutiny. The plan's institutional safeguards (private first response, mandatory disagreement extraction, anti-collapse checks) are the right structural answers.
- **The model assignment policy is thoughtful.** Separating seat identity from runtime model assignment, with controlled diversity rather than random assignment, is a mature design decision.
- **Budget and latency as first-class concerns, not afterthoughts.** Many AI system plans treat cost as "we'll optimize later." This plan treats it as constitutional. That is correct for a skill meant to be called programmatically.
- **The CLI command design feels right.** `ask`, `debate`, `plan`, `review`, `seats`, `inspect` is a well-chosen verb set.

---

## Recommendations Before Implementation

1. **Write the TypeScript interfaces now.** Define `ParliamentRequest`, `ParliamentResponse`, `SeatProfile`, `DeliberationTrace`, `RoundOutput`, and `DisagreementRecord` as concrete types. This will expose ambiguities the prose hides.

2. **Define the convergence algorithm.** Even a naive version (e.g., "extract top-3 claims per seat, check pairwise overlap, stop if overlap > 70%") is better than leaving this undefined.

3. **Decide on multi-provider vs single-provider for v1.** This is a binary decision with major implementation impact. Make it now.

4. **Add a back-of-envelope cost model.** Estimate tokens per mode. Set default circuit breaker thresholds. This makes the budget feature implementable.

5. **Harden phase exit criteria.** Convert "stable enough" and "can run end-to-end" into specific, testable conditions with named benchmark prompts.

6. **Trim the plan to ~400 lines.** Move rationale to a separate document. Keep the plan as a "what to build" reference, not a "why we chose this" essay.

7. **Add a Testing Strategy section.** Define how routing, convergence, and output formatting will be tested deterministically, and how LLM calls will be mocked in tests.

8. **Scope a "hello world" milestone.** Define the absolute minimum demo: one prompt, Speaker + 2 seats, one round, one JSON output. This is the first thing to get running, before any of the mode/routing/convergence complexity.

---

## Summary

The plan is strong on vision and weak on engineering specification. It answers "what should this product be?" compellingly but leaves "how do I build it this week?" underspecified. The recommended path forward is: tighten the schemas, define the convergence algorithm, decide on multi-provider scope, add cost estimates, harden exit criteria, and trim the rationale into a companion document. After that tightening pass, this plan is ready to drive a confident Phase 1 implementation.
