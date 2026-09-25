# @edh-seer/tagger: where the procedures live

This package turns oracle text into the tags the matcher reads, in three stages: segmentation
(free), normalization (the one paid, model step) and derivation (free). The commands to run them
are in the main runbook, not here:

- **Buying corpus** (normalization, the paid step): [docs/RUNBOOK.md](../../docs/RUNBOOK.md#buying-corpus),
  with the costs and selectors in [Stage 2](../../docs/pipeline/2-normalize.md).
- **Re-deriving** (free, after any change to derivation):
  [docs/RUNBOOK.md](../../docs/RUNBOOK.md#re-deriving).
- **How each stage works:** [docs/pipeline/](../../docs/pipeline/).

## The flat tagging grind is retired

This file used to describe a loop that had a model tag batches of 40 cards straight into
`cardTags`. It was retired when the product switched to derived tags on 2026-08-06: that extractor
measured 43% correct on a hand audit, and two identical runs agreed on 30% of cards.
`tag-batch-api.ts` refuses to run without `ALLOW_DEPRECATED_GRIND=1`. The loop and its
`grind.sh` wrapper are gone; git history has them.
