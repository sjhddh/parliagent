# Changelog

## 0.1.0 — Complete 33-Seat Parliament

### Parliament
- All 33 constitutional seats are production-grade with detailed system prompts, substrate policies, and structured profiles
- No expansion-only or deferred seats — every seat is first-class invokable
- `--full-parliament` flag activates all 33 seats (explicit opt-in, ~$1.50/run)
- Full parliament benchmarked: 3 prompts, ~247k tokens, ~44s, 133 avg disagreements

### Debate Modes
- `micro`: 2-3 seats, 1 round, ~1,300 tokens, ~16s (default for `ask`)
- `fast`: 3-5 seats, 2 rounds, ~5,300 tokens, ~34s (default for `plan` and `review`)
- `balanced`: 5-9 seats, 2 rounds, ~10,900 tokens, ~37s
- `deep`: 7-13 seats, 3 rounds (implemented, not benchmarked)
- Full parliament: 32 speaking seats, 1 round, ~247k tokens, ~44s

### Execution Profiles
- `available`: seats follow their fallback chain with whatever providers exist (default)
- `federated`: provider-native seats prefer their own family; others use primary
- `supreme`: all seats + synthesis use the operator-designated supreme provider

### Answer Modes
- `answer`, `memo`, `plan`, `review`, `transcript` — each with distinct synthesis prompts

### CLI
- 6 commands: `ask`, `debate`, `plan`, `review`, `seats`, `inspect`
- `--profile available|federated|supreme` for execution profile selection
- `--full-parliament` for 33-seat invocation
- `--json`, `--short`, `--long`, `--seed`, `--mode`, `--trace` flags

### SDK
- `debate()` one-call entry point
- `Speaker` class with `Speaker.withPolicy()` test factory
- Zod-validated contracts: ParliamentRequest, ParliamentResponse, DeliberationTrace
- Per-seat substrate policies with deterministic fallback chains

### Provider Support
- OpenAI, Anthropic, Google AI adapters
- `fetchWithRetry` with exponential backoff and 30s timeout
- Anthropic live-validated; OpenAI and Google adapter-implemented

### Safety
- Content boundary detection (medical, legal, financial, safety-critical)
- Hard-block for safety-critical content (configurable via `safetyMode`)
- Anti-collapse: phrase overlap scoring, lazy consensus detection

### Configuration
- File config (`sun-parliament.config.json`) + environment variables
- `SUN_PARLIAMENT_SUPREME_PROVIDER`, `SUN_PARLIAMENT_EXECUTION_PROFILE`
- Zod-validated env values with warnings on invalid input

### Serverless
- `handleRequest()` adapter for Vercel/Lambda/Workers
- CORS support, input validation, structured error responses

### Testing
- 151 tests across 14 files
- Schema, routing, convergence, budget, safety, synthesis, config, handler, integration, execution profiles, full parliament
- `noUnusedLocals` and `noUnusedParameters` enforced
