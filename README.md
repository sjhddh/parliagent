# Sun Parliament

Multi-agent deliberation engine. One call gets you a structured debate among expert personas — with disagreement tracking, minority reports, and budget controls.

Designed as a **skill**: invoke it from an agent workflow, import it as a library, or run it from the CLI.

## Installation

```bash
npm install sun-parliament
```

Requires Node >= 18 and at least one LLM provider API key.

## When to Use Sun Parliament

**Use it** when you need multiple perspectives before deciding — architecture choices, risk reviews, planning under uncertainty, security-sensitive designs.

**Don't use it** for simple factual questions, pure writing tasks, or anything where a single expert answer is sufficient. Micro mode on a writing prompt reaches consensus in one round with zero disagreements — the debate adds nothing.

## Quick Start

### SDK

```typescript
import { debate } from "sun-parliament";

const response = await debate({
  prompt: "Should we use microservices or a monolith?",
  mode: "fast",
  taskType: "strategy",
});

// Use the result
console.log(response.finalAnswer);
console.log(response.decisionType);    // "consensus" | "majority" | "split" | "uncertain"
console.log(response.minorityReport);  // dissenting views, if any
console.log(response.warnings);        // safety/security concerns raised during debate
```

### CLI

```bash
# Quick question — micro mode, 2-3 seats, 1 round
sun-parliament ask "What's the best approach to rate limiting?"

# Planning — fast mode, structured steps
sun-parliament plan "Migration plan from monolith to microservices"

# Critical review — find problems and risks
sun-parliament review "Our proposed auth schema" --mode balanced

# Full debate with trace
sun-parliament debate "Should we pivot?" --mode fast --trace full --json

# See what seats would be selected without running a debate
sun-parliament inspect "How to handle API key rotation?" --mode fast
```

## Defaults and Mode Selection

These defaults are backed by benchmark data (10 prompts × 3 modes: micro/fast/balanced, Anthropic Claude, 2026-04-02). Deep mode was not benchmarked.

| Command | Default Mode | Cost | Latency | Why This Default |
|---------|-------------|------|---------|------------------|
| `ask` | **micro** | 1.6x baseline | 16s | Best value. 3+ disagreements on average at minimal cost overhead. |
| `plan` | **fast** | 6.5x baseline | 34s | Planning needs deeper conflict surfacing. 10+ disagreements on average. |
| `review` | **fast** | 6.5x baseline | 34s | Reviews benefit from more critical perspectives. |
| `debate` | **balanced** | 13.3x baseline | 37s | Explicit full deliberation. 5 seats, 18+ disagreements, 70% minority reports. |

**Security auto-upgrade:** Prompts containing security/auth/credential keywords auto-upgrade from micro to fast. This ensures SecurityPrivacySeat is included — it can't fit in micro's 2-seat chamber.

**When to override:**
- Use `--mode fast` on `ask` when the question has real tradeoffs
- Use `--mode micro` on `review` when you want a quick sanity check, not a deep critique
- Avoid `balanced` unless you specifically want 5+ perspectives — it costs 13x baseline with diminishing returns vs fast
- `deep` mode is implemented but not benchmarked in v0.1.0. Budget limits (60k tokens / 60s) are enforced. Use at your own cost discretion.

## Provider Support

| Provider | Status | Key Variable |
|----------|--------|-------------|
| **Anthropic** | Live-validated + benchmarked | `ANTHROPIC_API_KEY` |
| **OpenAI** | Live-validated | `OPENAI_API_KEY` |
| Google AI | Implemented, not live-validated (no key provided for testing) | `GOOGLE_API_KEY` |
| **Federated** (Anthropic + OpenAI) | Live-validated | Both keys set |

Set at least one key. The system auto-detects available providers and picks a primary. Anthropic and OpenAI are both live-validated. Federated mode (multiple providers, provider-native seat routing) is validated with Anthropic + OpenAI. Google adapter is implemented and type-checked but not live-tested because no API key was available during validation.

To force a specific primary provider:

```bash
SUN_PARLIAMENT_PRIMARY_PROVIDER=openai
```

## Output Language

Internal debate is always in English for reasoning quality. Output language is configurable — the final synthesis step renders the result in the requested language.

```bash
# CLI
sun-parliament ask "What is the best database for this use case?" --language zh

# SDK
debate({ prompt, outputLanguage: "zh" })
```

Supported: any BCP-47 language code (`en`, `zh`, `zh-CN`, `ja`, `es`, `fr`, `ko`, etc.). English output (`en`) is the default — no translation step is added.

**What gets translated:** `finalAnswer`, `warnings`, `minorityReport`, `openQuestions`, `debateSummary`, transcript output.

**What stays English:** Internal seat statements, disagreement records, trace artifacts. These are reasoning internals, not user-facing output.

## Execution Profiles

Mode controls **how many seats debate**. Profile controls **which models they use**. These are independent knobs.

| Profile | Behavior | When to Use |
|---------|----------|-------------|
| `available` | Seats follow their fallback chain with whatever providers exist | Default. Works with any single provider. |
| `federated` | OpenAISeat/ClaudeSeat/GeminiSeat prefer their native family; others use primary | When you have multiple API keys and want provider-native seat diversity |
| `supreme` | All debate seats + synthesis run on one operator-designated provider (`SUN_PARLIAMENT_SUPREME_PROVIDER`, defaults to primary) | When you want all seats on one provider for uniform quality |

```bash
# CLI
sun-parliament ask "question" --profile supreme

# SDK
debate({ prompt, mode: "fast", executionProfile: "supreme" })
```

With only one API key, all three profiles produce the same assignments — every seat deterministically falls back to that provider.

## Configuration

### Environment Variables

```bash
ANTHROPIC_API_KEY=sk-ant-...                        # Provider key (at least one required)
SUN_PARLIAMENT_PRIMARY_PROVIDER=anthropic            # Force primary provider
SUN_PARLIAMENT_SUPREME_PROVIDER=anthropic            # Override supreme model selection
SUN_PARLIAMENT_EXECUTION_PROFILE=available           # Default profile
SUN_PARLIAMENT_DEFAULT_MODE=fast                     # Override default mode
SUN_PARLIAMENT_DEFAULT_TRACE=summary                 # none | summary | full
SUN_PARLIAMENT_DEFAULT_OUTPUT_LANGUAGE=en             # Output language (e.g. zh, ja, es)
SUN_PARLIAMENT_MAX_TOKENS=15000                      # Global token budget cap
SUN_PARLIAMENT_MAX_LATENCY_MS=20000                  # Global latency cap
```

### Config File

Optional `sun-parliament.config.json` in your working directory:

```json
{
  "primaryProvider": "anthropic",
  "supremeProvider": "anthropic",
  "defaults": { "mode": "fast", "executionProfile": "available", "trace": "summary", "outputLanguage": "en" },
  "budgetOverrides": { "maxTokens": 15000, "maxLatencyMs": 20000 }
}
```

Environment variables take priority over file config.

## Response Structure

Every call returns a `ParliamentResponse`:

| Field | Type | Always Present | Description |
|-------|------|---------------|-------------|
| `finalAnswer` | string | Yes | The synthesized answer |
| `decisionType` | `"consensus"` \| `"majority"` \| `"split"` \| `"uncertain"` | Yes | How the parliament resolved |
| `activatedSeats` | string[] | Yes | Which seats participated |
| `whyTheseSeats` | string | Yes | Routing rationale |
| `minorityReport` | string | No | Dissenting views (absent on consensus) |
| `openQuestions` | string[] | No | Unresolved disagreements |
| `warnings` | string[] | No | Safety/security concerns raised |
| `debateSummary` | string | When trace != "none" | Per-round summary |
| `traceArtifact` | object | When trace == "full" | Full deliberation trace with rounds, statements, disagreements |

## Answer Modes

Control the synthesis format with `answerMode`:

| Mode | Output Shape | Best For |
|------|-------------|----------|
| `answer` | Direct response (default) | General questions |
| `memo` | Situation / Options / Analysis / Recommendation | Decision memos |
| `plan` | Goal / Steps / Dependencies / Risks | Implementation planning |
| `review` | Verdict / Strengths / Issues / Risks / Recommendations | Code and design review |
| `transcript` | Formatted debate with per-seat contributions | Understanding the deliberation |

## Serverless Deployment

```typescript
import { handleRequest } from "sun-parliament";

export default async function handler(req) {
  return handleRequest({ method: req.method, body: await req.json() });
}
```

POST a `ParliamentRequest` JSON body, get back a `ParliamentResponse`. Includes CORS headers, input validation, and structured error responses.

## Full Parliament (33 seats)

All 33 seats are production-grade and invokable. Default modes select a subset; full parliament is explicit opt-in.

| Category | Seats |
|----------|-------|
| **Procedural** | Speaker |
| **Model Representatives** | OpenAISeat, ClaudeSeat, GeminiSeat |
| **Computing Foundations** | TuringSeat, KnuthSeat, DijkstraSeat, ShannonSeat |
| **Modern Computing** | DistributedSystemsSeat, MLSystemsSeat, HumanComputerInteractionSeat, SecurityPrivacySeat |
| **Philosophy** | AristotleSeat, KantSeat, NietzscheSeat |
| **Mathematics** | EuclidSeat, GaussSeat, VonNeumannSeat |
| **Physics** | NewtonSeat, EinsteinSeat, FeynmanSeat |
| **Economics & Strategy** | SmithSeat, KeynesSeat, StrategySeat |
| **Psychology & Cognition** | KahnemanSeat, JungSeat, CognitiveScienceSeat |
| **Product & Operations** | ProductStrategySeat, OperatorSeat, DesignCommunicationSeat |
| **Civic & Ethics** | LawGovernanceSeat, EthicsHumanImpactSeat, CitizenPragmatistSeat |

### Full Parliament Mode

Activate all 33 seats for maximum deliberation breadth:

```bash
sun-parliament debate "question" --full-parliament
```

```typescript
debate({ prompt, fullParliament: true, trace: "full" })
```

| Metric | Full Parliament (measured) |
|--------|--------------------------|
| Seats | 32 (+ Speaker) |
| Rounds | 1 (default) |
| Avg tokens | ~247,000 |
| Avg latency | ~44s |
| Avg disagreements | 133 |
| Estimated cost | ~$1.50/run |
| Budget cap | 300k tokens / 120s |

Full parliament runs 1 round by default — 32 voices in a single round already produce 100+ disagreements. Budget limits apply between rounds; a single parallel round may use the full cap.

**When to use:** Consequential decisions where you want every disciplinary angle — architecture with compliance implications, strategic pivots, security-critical designs.

**When not to use:** Everyday questions. The cost is ~300x baseline. Default modes (micro/fast/balanced) are better for routine work.

## CLI Reference

```
sun-parliament ask <prompt>       Quick deliberation (micro)
sun-parliament debate <prompt>    Full debate with trace (balanced)
sun-parliament plan <prompt>      Planning-biased (fast)
sun-parliament review <prompt>    Critical review (fast)
sun-parliament seats              List available seats
sun-parliament inspect <prompt>   Show routing without running debate

Options:
  --mode <mode>           micro | fast | balanced | deep
  --full-parliament       Activate all 33 seats (high cost, explicit opt-in)
  --profile <profile>     available | federated | supreme
  --language <code>       Output language (e.g. zh, ja, es). Internal debate stays English.
  --task <type>           general | writing | planning | analysis | coding | strategy | ethics
  --answer <mode>         answer | memo | plan | review | transcript
  --trace <level>         none | summary | full
  --seat <seats...>       Include specific seats
  --exclude-seat <seats>  Exclude specific seats
  --json                  Machine-readable JSON output
  --short / --long        Control output length
  --seed <value>          Reproducibility seed
  --max-tokens <n>        Override token budget
  --max-latency-ms <n>    Override latency budget
```

## License

MIT
