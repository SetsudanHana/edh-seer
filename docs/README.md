# Documentation

## Start here

**[How it works](HOW-IT-WORKS.md)** — the tour. A printed Magic card to a synergy graph, with
diagrams and one real worked example carried the whole way through.

## The pipeline, a page per stage

Each page says what the stage reads, what it writes, what it costs, the command that runs it, and the
failure modes it has actually hit.

| | |
|---|---|
| [Stage 1 — Segmentation](pipeline/1-segment.md) | oracle text into numbered clauses. Free, and deliberately not the model's job |
| [Stage 2 — Normalization](pipeline/2-normalize.md) | the model, once per card, offline. The only paid step in the project |
| [Stage 3 — Derivation](pipeline/3-derive.md) | clauses into game events, plus the events no card prints |
| [Stage 4 — Matching](pipeline/4-match.md) | supply against demand, and every reason a claim is refused |

## Reference

| | |
|---|---|
| [Schema reference](reference/SCHEMA.md) | every closed vocabulary, version constant and schema field. **Generated** from the source and gated by a test |
| [Runbook](RUNBOOK.md) | what to run, what it costs, how to measure a change, how to deploy |

## History

**[Engineering log](engineering-log/)** — one file per date: what was measured, what it cost, and
what turned out to be wrong. Newest first. The specs argue; the log records what the argument was
worth.

Two older notes that predate the structure above and are kept as written:
[tagging strategy](tagging-strategy.md), [oTag crosswalk](otag-crosswalk.md), and
[analytics](ANALYTICS.md).

## The rule these pages are written to

Every number carries where it came from — the command that produced it, and the date. A figure with
no source is a figure nobody can re-check, and this project has already had a documentation page sit
four versions out of date without anything failing. That is why the reference is generated rather
than written.

Re-measure before you quote. Including from here.
