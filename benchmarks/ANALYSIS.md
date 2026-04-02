# Benchmark Analysis — Sun Parliament v0.1.0

**Date**: 2026-04-02
**Provider**: Anthropic (Claude)
**Prompts**: 10 across coding, planning, writing, strategy, security, analysis
**Modes tested**: baseline (single-agent), micro, fast, balanced

## Summary Statistics

| Mode | Avg Tokens | Avg Latency | Avg Seats | Avg Disagreements | Cost vs Baseline |
|------|-----------|-------------|-----------|-------------------|-----------------|
| Baseline | 822 | 14,458ms | 1 | — | 1.0x |
| Micro | 1,318 | 16,430ms | 2 | 3.4 | 1.6x |
| Fast | 5,336 | 33,643ms | 3 | 10.6 | 6.5x |
| Balanced | 10,898 | 36,500ms | 5 | 18.1 | 13.3x |

## Decision Type Distribution

| Mode | Consensus | Majority | Split | Uncertain |
|------|-----------|----------|-------|-----------|
| Micro | 1 | 5 | 0 | 4 |
| Fast | 0 | 4 | 0 | 6 |
| Balanced | 0 | 1 | 0 | 9 |

## Stop Reason Distribution

| Mode | Converged | Round Limit | Budget |
|------|-----------|-------------|--------|
| Micro | 1 | 9 | 0 |
| Fast | 0 | 10 | 0 |
| Balanced | 0 | 10 | 0 |

## Key Findings

### 1. Micro mode is the sweet spot for most CLI use

- Only **1.6x** cost vs baseline — very efficient
- Latency is close to baseline (16s vs 14s) — feels like a single call
- Still produces **3.4 disagreements on average** and **4/10 minority reports**
- Reaches consensus on simple prompts (writing) and majority on most others
- **Recommendation: keep micro as CLI default.** It adds genuine multi-perspective value at minimal cost.

### 2. Fast mode adds disagreement depth but doubles latency

- **6.5x** cost, **2.3x** latency vs baseline
- Average **10.6 disagreements** — 3x more conflict surfacing than micro
- 33s average is acceptable for important questions but too slow for rapid iteration
- Good for `plan` and `review` commands where thoroughness matters
- **Recommendation: keep fast as default for `plan` and `review`.**

### 3. Balanced mode has diminishing returns

- **13.3x** cost, but only **1.7x** more disagreements than fast
- Almost everything resolves as "uncertain" (9/10) — more seats ≠ more clarity
- Latency (36s) is similar to fast despite 2x tokens — parallelism helps
- Minority reports increase (7/10 vs 2/10 in fast) — more dissent, not necessarily more insight
- **Recommendation: balanced is rarely worth the cost. Use fast instead.** Only recommend balanced for genuinely high-stakes decisions where you want to see all angles.

### 4. Convergence rarely triggers early — round_limit dominates

- 29/30 parliament runs hit round_limit, not convergence
- Only 1/30 (micro on writing) reached consensus early
- This means the convergence thresholds may be too strict, OR the debate genuinely doesn't converge with different personas
- **Observation: this is expected for a system designed to surface disagreement.** Convergence should be the exception, not the norm. The value is in the structured disagreement, not premature agreement.

### 5. SecurityPrivacySeat provides real value — but only in fast+ modes

- In **micro** mode, SecurityPrivacySeat is NOT activated for security prompts (not enough seat slots)
- In **fast** mode, SecurityPrivacySeat IS activated and generates **5-6 warnings** and **10-11 disagreements**
- In **balanced** mode, warnings increase to **8-10** and disagreements to **16-21**
- **This is a clear case where fast mode is worth the cost for security-sensitive prompts**
- **Recommendation: consider auto-upgrading from micro to fast when security keywords are detected**

### 6. Writing prompts don't benefit much from debate

- Writing/technical prompt in micro mode: **consensus, 0 disagreements**
- Writing in fast mode: still only **5 disagreements** (lowest of all categories)
- Writing in balanced: **12 disagreements** but mostly stylistic
- **Recommendation: micro is sufficient for writing tasks**

## Cost Analysis

Assuming Anthropic Claude Sonnet pricing (~$3/M input, ~$15/M output):

| Mode | Avg Tokens | Estimated Cost per Run |
|------|-----------|----------------------|
| Baseline | 822 | ~$0.005 |
| Micro | 1,318 | ~$0.01 |
| Fast | 5,336 | ~$0.04 |
| Balanced | 10,898 | ~$0.08 |

All modes are well within practical budget for CLI/skill use.

## Tuning Recommendations

### Keep as-is
- Micro as default for `ask` — validated
- Fast as default for `plan` and `review` — validated
- Budget circuit breakers — all runs stayed within limits
- Security keyword detection — works correctly in fast+ modes

### Adjust
- **Auto-upgrade security prompts from micro to fast** — micro doesn't have room for SecurityPrivacySeat
- **Consider lowering convergence thresholds** — or accept that round_limit is the normal stop reason and document it
- **Consider documenting balanced as "advanced mode"** — its cost/value ratio is poor for most prompts

### Monitor
- Deep mode was not benchmarked (cost concern) — should be tested once before recommending or discouraging it
- Multi-provider behavior (OpenAI + Anthropic + Google together) remains untested
