# Parliagent — Agent Skill

Multi-agent deliberation. One call runs a structured debate among expert personas and returns a synthesized answer with disagreement tracking.

This file is intentionally plain Markdown with stable headings so agent runtimes can read it directly.

## Agent Summary

- **Entrypoint:** `debate({...})` from `parliagent`
- **Default mode:** `micro` (~16s, ~$0.01) — controls chamber size
- **Default profile:** `federated` — each seat uses its preferred provider's best model
- **Good for:** architecture tradeoffs, planning, risk review, security-sensitive decisions, strategy under uncertainty
- **Avoid for:** trivial factual questions, pure drafting, low-latency iteration
- **If prompt is security-sensitive:** system auto-upgrades to `fast`
- **If you want all seats on one designated provider:** set `executionProfile: "supreme"`
- **If `decisionType` is `split` or `uncertain`:** surface `minorityReport` and `openQuestions` to the user
- **Never suppress `warnings`** — they are the primary safety signal
- **Output language:** set `outputLanguage` for non-English users. Internal debate is always English; only the final output is rendered in the target language.

## Canonical Invocation Contract

```typescript
import { debate } from "parliagent";

const response = await debate({
  prompt,                    // string (required)
  mode?,                     // "micro" | "fast" | "balanced" | "deep"        — chamber size
  fullParliagent?,           // boolean — activate all 33 seats (explicit opt-in, ~$1.50/run)
  executionProfile?,         // "available" | "federated" | "supreme"         — model backend
  taskType?,                 // "general" | "writing" | "planning" | "analysis" | "coding" | "strategy" | "ethics"
  answerMode?,               // "answer" | "memo" | "plan" | "review" | "transcript"
  outputLanguage?,           // BCP-47 code (e.g. "zh", "ja", "es") — output only, debate stays English
  trace?,                    // "none" | "summary" | "full"
});
```

**Four independent controls:**
- `mode` = how many seats and rounds (chamber shape)
- `fullParliagent` = override mode and activate all 33 seats
- `executionProfile` = which models run behind those seats (substrate)
- `outputLanguage` = final output language (internal debate is always English)

**Response consumption rules:**

1. Always read `response.finalAnswer`
2. If `response.decisionType !== "consensus"`, inspect `response.minorityReport` and `response.openQuestions`
3. Never suppress `response.warnings`

## When to Invoke

Call Parliagent when a problem has **genuine tradeoffs, competing concerns, or risk surfaces** that benefit from multiple expert perspectives.

**Good triggers:**
- Architecture decisions with >1 viable path
- Security-sensitive designs (auth, credentials, data handling)
- Strategy questions with competing priorities
- Planning under uncertainty or resource constraints
- Risk reviews where you need objections surfaced, not suppressed
- Decisions where the user will ask "what are we missing?"

**Do NOT invoke when:**
- The question has a single factual answer (use your own knowledge)
- The task is pure writing or drafting (debate adds nothing — benchmarked: 0 disagreements on writing)
- The user needs fast iteration — even micro mode takes ~16s
- The question is trivial or the user hasn't asked for deliberation
- You already know the answer and just need to explain it

## Mode Selection Decision Tree

```
Is the question trivial or factual?
  → Don't call Parliagent. Answer directly.

Does it involve security, auth, credentials, or data privacy?
  → mode: "fast", taskType: "coding"

Is the user asking for a plan, roadmap, or next steps?
  → mode: "fast", taskType: "planning", answerMode: "plan"

Is the user asking for a critique, review, or risk assessment?
  → mode: "fast", taskType: "analysis", answerMode: "review"

Is this a high-stakes decision with significant consequences?
  → mode: "balanced"
  → If it spans multiple disciplines (tech + legal + ethics + business): fullParliagent: true

Is this a routine technical or strategy question with real tradeoffs?
  → mode: "micro"

Default:
  → mode: "micro", let the system classify taskType automatically
```

**Cost/latency reference:**
- `micro` — ~16s, ~$0.01, 3 disagreements avg
- `fast` — ~34s, ~$0.04, 10 disagreements avg
- `balanced` — ~37s, ~$0.08, high cost with diminishing returns vs fast
- `deep` — not yet benchmarked, budget cap 60k tokens / 60s
- `fullParliagent` — ~44s, ~$1.50, 133 disagreements avg, 32 speaking seats, 1 round — only for consequential multi-disciplinary decisions

## Execution Profile Selection

Profile is independent of mode. Pick mode for chamber size, pick profile for model backend.

```
Do you have only one API key?
  → Profile doesn't matter — all resolve to the same provider. Default "federated" works fine.

Do you have multiple keys and want model-family diversity (OpenAI vs Claude vs Gemini arguing)?
  → executionProfile: "federated"

Do you want all seats on one operator-designated provider, ignoring provider diversity?
  → executionProfile: "supreme" (uses PARLIAGENT_SUPREME_PROVIDER, defaults to primary)

Default:
  → executionProfile: "federated" (each seat uses its preferred provider)
```

With a single provider, `available`, `federated`, and `supreme` produce identical assignments.

## taskType Selection

If you know the domain, set `taskType` for better seat routing. If unsure, omit it — the system classifies automatically.

| taskType | Seats prioritized | Use when |
|----------|------------------|----------|
| `coding` | DijkstraSeat, SecurityPrivacySeat, ShannonSeat | Code architecture, API design, debugging strategy |
| `planning` | ProductStrategySeat, OperatorSeat, KahnemanSeat | Roadmaps, migration plans, project scoping |
| `writing` | FeynmanSeat, ShannonSeat, AristotleSeat | Documentation, explanation (consider whether debate adds value) |
| `analysis` | KahnemanSeat, AristotleSeat, ShannonSeat | Comparisons, evaluations, tradeoff analysis |
| `strategy` | ProductStrategySeat, OperatorSeat, KahnemanSeat | Business decisions, pricing, positioning |
| `ethics` | AristotleSeat, KahnemanSeat, SecurityPrivacySeat | Fairness, bias, governance, responsible AI |
| `general` | AristotleSeat, FeynmanSeat, KahnemanSeat | Anything that doesn't fit above |

## answerMode Selection

| answerMode | Output shape | Use when |
|-----------|-------------|----------|
| `answer` | Direct response | Default. User wants an answer, not a document. |
| `memo` | Situation → Options → Analysis → Recommendation | User needs to decide between options |
| `plan` | Goal → Steps → Dependencies → Risks | User needs actionable next steps |
| `review` | Verdict → Strengths → Issues → Recommendations | User wants problems found, not solutions proposed |
| `transcript` | Per-seat debate record | You need to show how the deliberation unfolded |

## Consuming the Response

### Fields to always use

```typescript
response.finalAnswer      // The synthesized answer. Present this to the user.
response.decisionType     // "consensus" | "majority" | "split" | "uncertain"
```

### Fields to use conditionally

```typescript
response.minorityReport   // Present when decisionType != "consensus". Don't hide dissent.
response.openQuestions    // Unresolved disagreements. Surface if present.
response.warnings         // Safety/security/legal concerns. Never suppress.
```

### Interpreting decisionType

| Type | Meaning | What to do |
|------|---------|------------|
| `consensus` | All seats agreed. | Present the answer directly. |
| `majority` | Most agreed, some dissented. | Present the answer. Mention minority report if relevant. |
| `split` | Roughly even disagreement. | Present both sides. Don't pretend there's a clear answer. |
| `uncertain` | No clear position emerged. | Present with caveats. Surface open questions. Consider asking user for more constraints. |

### Chaining with downstream steps

```typescript
const result = await debate({ prompt, mode: "fast", taskType: "planning", answerMode: "plan" });

if (result.warnings?.length) {
  // A seat raised safety/security/legal concerns — surface before proceeding
}

if (result.decisionType === "split" || result.decisionType === "uncertain") {
  // Parliament couldn't converge — ask user for clarification instead of picking a side
}

if (result.minorityReport) {
  // Dissenting view — often where the most valuable insight lives
}

// Use finalAnswer as primary input for the next step
```

## Error Handling

```typescript
try {
  const response = await debate({ prompt, mode: "micro" });
} catch (error) {
  // "No model provider configured" → missing API key
  // Provider errors → retried once internally, then seat marked unavailable.
  //   Debate continues if enough seats respond.
}
```

A hard-blocked safety prompt returns a response with `activatedSeats: []` and a warning — it does not throw.

## Provider Status

| Provider | Status | Key |
|----------|--------|-----|
| Anthropic | Live-validated + benchmarked | `ANTHROPIC_API_KEY` |
| OpenAI | Live-validated | `OPENAI_API_KEY` |
| Google/Gemini | Live-validated | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| FLOCK | Live-validated (OpenAI-compatible) | `FLOCK_API_KEY` + `FLOCK_MODEL` |

All four providers are production-validated individually and in federated/supreme combinations. FLOCK uses `x-litellm-api-key` header auth and requires `FLOCK_MODEL` explicitly.
