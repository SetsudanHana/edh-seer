# Corpus tagging runbook (resumable from a clean session)

Structurally tags the ~35k-card corpus via free Haiku Agent-tool subagents, most-played first.
**All progress lives in Mongo** (a card is done when its `cardTags` doc is current-version), so a
fresh session resumes with zero prior context. Run everything with **Mongo up and sandbox OFF**.

## One-time prerequisite
`edhrecRank` must be persisted on cards: `cd packages/data && npm run ingest` (once, after the
edhrecRank change shipped). Verify with `status` (below) showing a non-null "next untagged rank".

## The loop (repeat until done)
From `packages/tagger`:

1. `npx tsx src/bin/status.ts` — see tagged/total, remaining under cutoff, next rank.
2. `npx tsx src/bin/dump-untagged.ts --batches 6 --size 40` — writes
   `/tmp/mtg-tag-batches/preamble.txt` + `batch-0.json..batch-5.json` (240 most-played untagged
   cards).
3. Dispatch **one background Haiku subagent per batch file**. Each subagent prompt =
   the contents of `preamble.txt`, then: "For EACH card below, output the tagging JSON. Return a
   JSON array `[{ "oracleId": string, "abilities": [...] }]` — one entry per card, `abilities`
   being the array you would put in `{"abilities":[...]}`. Cards: " + the batch file's JSON.
   Tell it to WRITE the array to `/tmp/mtg-tag-batches/batch-<i>-out.json`. Model: `haiku`,
   `run_in_background: true`.
4. As each subagent finishes:
   `npx tsx src/bin/upsert-batch.ts /tmp/mtg-tag-batches/batch-<i>.json /tmp/mtg-tag-batches/batch-<i>-out.json`
5. `npx tsx src/bin/reconcile.ts` — drops (dispatched-but-untagged) simply re-queue on the next
   `dump-untagged`; this bin reports how many remain.
6. Periodically: `npx tsx src/bin/audit.ts --sample 15` for a human spot-check.

## Stopping
Stop when `status` reports 0 remaining under your chosen `--cutoff` (default 20000 = broadly
playable). The unranked long tail is optional.

## Notes
- Quality: Haiku 4.5 ≈ 0.878 F1 with prompt v22 (unchanged). `parseAbilities` normalizes every
  card on the main thread, so a malformed subagent reply degrades to empty tags, never corruption.
- Idempotent: re-running any step is safe; upsert keys on `oracleId`; done cards are skipped.
- Resumable: a new session needs only this file + Mongo. No conversation state is required.
