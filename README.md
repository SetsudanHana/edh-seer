# EDH Seer

[![CI](https://github.com/SetsudanHana/edh-seer/actions/workflows/ci.yml/badge.svg)](https://github.com/SetsudanHana/edh-seer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Oracle-text deck analysis for Magic: The Gathering Commander (EDH).

**Live at [edhseer.cards](https://edhseer.cards)** — paste a decklist, no account, nothing stored.

Paste a decklist, get a reading: which cards actually work together and **why**, in a sentence you
can check against the card. Plus mana and land math, build benchmarks, per-card roles, archetype
detection, and combo detection.

## What makes it different

**Nothing is inferred from card names, popularity, or co-occurrence statistics.** Every claim comes
from printed rules text, and every claim is a sentence you can verify:

> *"When Siege-Gang Commander dies, Skullclamp draws you 2 cards"*

**There is no LLM at analysis time.** A model is used exactly once, offline, to normalize oracle text
into structured clauses. Everything downstream — deriving tags, matching producers to consumers,
scoring, reporting — is deterministic, free to re-run, and identical on every machine.

That matters because it makes the engine *measurable*. A rule change produces a diff you can read.

## How well does it work

| | |
|---|---|
| synergy-claim precision | **98.7%** `[97.1, 99.5]` on 421 live claims |
| retention of pairs judged real | **91.4%** — 383 held, 36 lost |
| judged against | 895 frozen card pairs, every claim hand-judged by a human |
| calibration corpus | 71 real decks |
| tests | 3,711, green |

Measured 2026-09-08 by `npx tsx packages/instruments/src/panel-score.ts`, which is free to re-run.

Precision is measured on a frozen panel where both the "real" and "false" columns are human-judged,
not model-judged. The number is deliberately conservative: a claim the engine cannot verify is
**refused** rather than guessed, because a silent wrong answer is worse than a missing one.

**The second row is not optional.** A gate that deletes every claim it is unsure of scores 100%
precision, so the two numbers only mean anything together. And retention is not recall: the panel was
built from claims this engine already made, so it cannot see an edge that was never claimed.

## The pipeline

```
Scryfall / MTGJSON  ──►  oracle text
                            │
                            ▼  (LLM, once, offline)
                         clauses          ──  structured sentences
                            │
                            ▼  (pure functions, free)
                      derived tags        ──  triggers, effects, subjects
                            │
                            ▼  (pure functions, free)
                     producer/consumer    ──  "X supplies the event Y watches for"
                          edges
                            │
                            ▼
                       deck report
```

Only the first arrow costs money. The rest is re-runnable at will, which is why the engine can be
changed and re-measured cheaply.

## Packages

| package | what it does |
|---|---|
| `@edh-seer/data` | Scryfall + MTGJSON ingestion, MongoDB corpus, name resolution |
| `@edh-seer/tagger` | oracle text → clauses (the paid step) → derived tags (free) |
| `@edh-seer/matcher` | edges, reasons, archetypes, mana math, build benchmarks, combos |
| `@edh-seer/engine` | scoring, ratings, per-card impact |
| `@edh-seer/cli` | terminal deck report |
| `@edh-seer/web` | NestJS API + React/Vite UI, including an interactive synergy graph |

## Running it

Requires Node >= 22 and a MongoDB instance holding the card corpus.

```bash
npm install
npm test                                    # 3,711 tests

npx tsx packages/cli/src/main.ts <decklist.txt>

cd packages/web && NODE_OPTIONS="--import tsx" npx nest start   # API  :3001
cd packages/web && npx vite --config client/vite.config.ts      # UI   :5173
```

## Honest limitations

- **Corpus coverage.** The corpus is **34,433** cards, of which **28,416** carry derived tags
  (measured 2026-09-09; 31,731 of the 31,829 commander-legal cards are read in full, the 98 left
  being persist-gate refusals). Cards outside that set form no synergy edges — the report says so explicitly
  rather than quietly under-reporting. Their mana cost, type and text still count everywhere else.
- **Synergy is binary, not weighted.** An edge says two cards relate; it does not say how much. A
  supply/demand magnitude discount was built, swept across a 2-D parameter grid, and **refused** on
  measurement three separate times — it consistently penalised exactly the scarce payoffs it was
  meant to reward.
- **Some relations are inexpressible.** A tutor that can find a card, a recursion spell that could
  return it — these are real synergies that a producer-event/consumer-trigger model cannot state.
  They are documented ceilings, not bugs waiting to be found.
- **The 71 calibration decks are one player's collection**, not a metagame. Thresholds tuned against
  them are described as such wherever they appear.
- **Mana simulation is a goldfish.** No opponent, no interaction, no removal. Every figure it
  produces is a ceiling under a mana-maximising play policy, and says so.

## Status

Working, measured, and under active development. It began as a proof of concept and is now a
deterministic engine with a regression panel, several ratchets, and a habit of recording the
measurement beside every change.

## Documentation

Start at **[docs/](docs/)**, or go straight to what you need:

| | |
|---|---|
| [How it works](docs/HOW-IT-WORKS.md) | the tour — a printed card to a synergy graph, with diagrams and a worked example |
| [edhseer.cards/how-it-works](https://edhseer.cards/how-it-works) | the same story on the site: a player's half, then an engineer's half, with the figures above held to this README by a test |
| [Stage 1 — Segmentation](docs/pipeline/1-segment.md) | oracle text into numbered clauses, free |
| [Stage 2 — Normalization](docs/pipeline/2-normalize.md) | the model, once per card. The only paid step |
| [Stage 3 — Derivation](docs/pipeline/3-derive.md) | clauses into game events, plus what no card prints |
| [Stage 4 — Matching](docs/pipeline/4-match.md) | supply against demand, and every reason a claim is refused |
| [Schema reference](docs/reference/SCHEMA.md) | every vocabulary, constant and field. Generated from the source and gated by a test |
| [Runbook](docs/RUNBOOK.md) | what to run, what it costs, how to measure it afterwards |
| [Engineering log](docs/engineering-log/) | what was measured, on what day, and what it cost |

Contributing: **[CONTRIBUTING.md](CONTRIBUTING.md)**. Found a wrong synergy claim?
[Report the edge](https://github.com/SetsudanHana/edh-seer/issues/new?template=wrong-edge.yml) —
it is the most useful issue this project can receive.

## License

MIT — see [LICENSE](LICENSE).

Card data from [Scryfall](https://scryfall.com) and [MTGJSON](https://mtgjson.com). Magic: The
Gathering is a trademark of Wizards of the Coast. This project is unaffiliated with them.
