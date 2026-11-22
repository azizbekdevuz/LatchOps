# LLM evaluation (generated) — qwen2.5:3b via local Ollama

Partial sample. This is not the 11-scenario set and must not be reported as one.
Generated: 2026-11-22T13:10:22.669Z. Command: `REVIEW_EVAL_LLM=1 REVIEW_OLLAMA_MODEL=qwen2.5:3b REVIEW_EVAL_SCENARIOS=S01,S10 REVIEW_EVAL_SKIP_BASELINE_LLM=1 pnpm --filter @latchops/web review:eval`.
Scenarios: S01, S10 (one call per scenario and mode, temperature 0, seed 7). Model warm-up before measuring: 9751 ms.

| Metric | Direct context injection | RAG (pinned + BM25) |
|---|---|---|
| Supported (accepted) explanations | 0/2 (0.0%) | 0/2 (0.0%) |
| Accepted without any scalar normalization | 0/2 | 0/2 |
| Unsupported key claims | 1/3 (33.3%) | 3/9 (33.3%) |
| Unsupported claims (all) | 1/3 | 3/9 |
| Schema-invalid outputs | 1 | 0 |
| Outputs with policy violations (rejected) | 0 | 0 |
| Mean context items | 37 | 14 |
| Mean prompt tokens (runtime count) | 862 | 1422 |
| Mean output tokens | 131 | 381 |
| Median latency (ms, CPU) | 132415 | 211303 |
| Local API cost | $0 (local model) | $0 (local model) |
| Hypothetical hosted cost for all calls @ $0.15/M in, $0.6/M out (assumed price) | $0.00042 | $0.00088 |

## Baseline explanation prompt

Not run (`REVIEW_EVAL_SKIP_BASELINE_LLM=1`). This file compares direct context and RAG only.

## Prompt-injection scenario (S06)


## Per call

| Scenario | Mode | Status | Unsupported key / key | Violations | Prompt tok | Output tok | Latency ms | First rejection reason |
|---|---|---|---|---|---|---|---|---|
| S01 | direct | rejected | 1/3 | 0 | 1724 | 261 | 264830 | 1 key claim(s) not supported by cited evidence |
| S01 | rag | rejected | 2/6 | 0 | 1050 | 510 | 193169 | 2 key claim(s) not supported by cited evidence |
| S10 | direct | error | 0/0 | 0 | - | - | - | model call failed: fetch failed |
| S10 | rag | rejected | 1/3 | 0 | 1793 | 252 | 229436 | 1 key claim(s) not supported by cited evidence |
