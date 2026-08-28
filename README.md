# EDH Seer

Oracle-text deck analysis for Magic: The Gathering Commander (EDH).

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
| synergy-claim precision | **95.1%** `[92.5, 96.8]` |
| judged against | 895 frozen card pairs, every claim hand-judged by a human |
| calibration corpus | 71 real decks |
| tests | 2,706, green |

Precision is measured on a frozen panel where both the "real" and "false" columns are human-judged,
not model-judged. The number is deliberately conservative: a claim the engine cannot verify is
**refused** rather than guessed, because a silent wrong answer is worse than a missing one.

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

Requires Node >= 20 and a MongoDB instance holding the card corpus.

```bash
npm install
npm test                                    # 2,706 tests

npx tsx packages/cli/src/main.ts <decklist.txt>

cd packages/web && NODE_OPTIONS="--import tsx" npx nest start   # API  :3001
cd packages/web && npx vite --config client/vite.config.ts      # UI   :5173
```

## Honest limitations

- **Corpus coverage.** The full card corpus is ~34,000 cards; **2,767** currently carry derived tags.
  Cards outside that set form no synergy edges — the report says so explicitly rather than quietly
  under-reporting. Their mana cost, type and text still count everywhere else.
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

[How it works](docs/HOW-IT-WORKS.md) — the full pipeline from a printed card to a synergy graph,
stage by stage, with diagrams and a real worked example.

## License

MIT — see [LICENSE](LICENSE).

Card data from [Scryfall](https://scryfall.com) and [MTGJSON](https://mtgjson.com). Magic: The
Gathering is a trademark of Wizards of the Coast. This project is unaffiliated with them.
