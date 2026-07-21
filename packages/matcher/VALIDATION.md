# Matcher validation

## Compass (active): pair-recall

Measures whether the structured engine finds known-good synergies for the right reason.

- `goldpairs.json` — curated card pairs, each labeled with a mechanism category. `verified: true` entries count.
- `npx tsx src/bin/source-pairs.ts --category=all --topK=6` — source candidates from EDHREC theme pages (no API key; needs network — run outside the sandbox). Appended unverified.
- `npx tsx src/bin/review-pairs.ts` — interactively accept/reject pending candidates.
- `npx tsx src/bin/eval-pairs.ts [--json]` — run the compass: per-category recall + miss causes.
- `npx tsx src/bin/propose-pairs.ts --category=<cat> --count=<n>` — optional LLM fallback sourcer (needs an Anthropic key).

Recall is a **compass, not a gate** — it points at which mechanisms to build next (e.g. a category
that is all `NO-LINKING-RULE` needs a rule batch). Cause labels: `MISSING-TAG-A/B` (a card is
untagged), `NO-LINKING-RULE` (both tagged, no edge), `WRONG-REASON` (edge, wrong mechanism).

## CommanderSalt (dormant): rank correlation

`bin/calibrate.ts` fit impact weights to CommanderSalt's per-card rank. It plateaued at ~0.15
Spearman and is no longer optimized. Run occasionally as a loose sanity check (per-deck Spearman
should stay roughly ≥ 0); never re-fit as the primary target.
