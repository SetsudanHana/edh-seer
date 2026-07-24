# Direct API tagging: brief

## Why

Current grind dispatches a Claude Code Agent-tool subagent (Haiku) per batch of 40 cards. Each
subagent pays harness overhead on top of the actual tagging work: full system prompt, tool
schemas (Read/Write/Bash), and 3+ tool-call round-trips per batch. Observed usage: ~35-65k tokens
per 40-card batch.

A direct Anthropic API call (`messages.create`, no tools) skips all of that — one prompt in, one
completion out. Batch or prompt-caching further cuts cost.

## Account / key

No new account needed. Same Anthropic account as Claude Pro; API billing is separate
(pay-per-token, not covered by the Pro subscription).

1. console.anthropic.com → log in with the existing account
2. Add billing (credit card)
3. Settings → API Keys → Create Key
4. `export ANTHROPIC_API_KEY=sk-ant-...` (or `.env`)

## Cost estimate

Remaining corpus under cutoff 20000: ~11,250 cards ≈ 281 batches of 40.

Haiku 4.5 pricing: ~$1/M input, ~$5/M output.

| | tokens | cost |
|---|---|---|
| input (preamble + 40 cards/batch) | ~16k/batch → 4.5M total | ~$4.50 |
| output (structured JSON) | ~10k/batch → 2.8M total | ~$14 |
| **total (no caching)** | | **~$15-20** |
| with prompt caching on preamble, or Batch API (50% off) | | **~$8-12** |

Cheap either way — a few dollars to finish the cutoff-20000 pass.

## What changes

Only the tagging step. Pipeline stays: `dump-untagged` → tag → `upsert-batch` → `reconcile` →
`status`. Replace the "dispatch 6 Agent-tool subagents" step with a script that:

1. Reads `preamble.txt` + `batch-N.json`
2. Calls `client.messages.create({ model: "claude-haiku-4-5", ... })` directly, no tools
3. Parses the response as the same `[{oracleId, abilities}]` JSON array
4. Writes `batch-N-out.json` (same contract `upsert-batch.ts` already expects)

Can run all 6 batches concurrently with `Promise.all`, same as the parallel subagent dispatch
does today — just without the harness tax.

## Status quo

Not blocking — the subagent grind works and can keep running as-is. This is a cost/speed
optimization to consider once the key is set up, not a required migration.
