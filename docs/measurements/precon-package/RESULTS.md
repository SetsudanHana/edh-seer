# Precon upgrade package: results (#767)

Recorded 2026-09-30, after tasks 1-8 merged. The measures are the pre-registered ones in
`docs/plans/2026-09-30-precon-upgrade-package.md`; the baseline is `BASELINE.md` beside this file.
Every run is recorded as it came out, failures included. No measure was changed between runs; the
code was.

## How the runs were made

- **Data:** the production static corpus of version `v-f07b58a42386`, served locally by
  `vite.prodstatic.config.ts`. Its `lands.json` was a local stand-in of 633 lands, because the
  production build before task 4 did not write one. The owner's next static build writes the full
  file, so production pages can only gain land swaps over these.
- **Build:** `npx tsx packages/web/scripts/build-precons.mts --static <static> --out <dir>`, all 197
  precons.
- **Score:** `npx tsx packages/instruments/src/precon-package-score.ts --static <static> --pages <dir>`.

## The instrument, run by run

| Measure | Baseline | Run 1 | Run 2 | Run 3 |
|---|---|---|---|---|
| H1, the guard | pass (vacuous) | FAIL 1 | FAIL 1 | RUN3_H1 |
| H2, reasons | pass (vacuous) | pass | pass | RUN3_H2 |
| H3, legality | pass (vacuous) | FAIL 3 | pass | RUN3_H3 |
| H4, role swaps are real | pass (vacuous) | FAIL 15 | pass | RUN3_H4 |
| H5, lands | pass (vacuous) | FAIL 124 | FAIL 1 | RUN3_H5 |
| S1, 5+ swaps at every target (floor 90%) | 0.0% | 93.4% | **89.3% MISS** | RUN3_S1 |
| S2, synergy kept at target 3 (floor 18 of 20) | none to measure | 19 of 20 | 19 of 20 | RUN3_S2 |

**Run 1** (the task 7 build):

- **H1.** Mystic Intellect ended in band 3 at bracket 2. Its commander did not resolve locally, so
  the guard never saw it.
- **H3.** Coven Counters was offered Kyler, Sigardian Emissary, which the precon already runs under a
  name that did not resolve. Fixed: the gatherer now checks the precon's raw names (`inDeck`).
- **H4.** 15 swaps put a shuffle (Chaos Warp) in for a card that destroys or exiles. The builder
  compared permanence in an order the instrument does not. Fixed: a shuffle is compared only with a
  shuffle.
- **H5.** 124 packages worsened the mana base, mostly synergy adds asking for heavy coloured pips.
  Fixed: the keeper, which reads each package back through the report and drops swaps until the mana
  base is no worse.

**Run 2** (the task 8 build, with those fixes):

- **H1.** Living Energy at bracket 2 read band 3. When the keeper put a swap back, the report's own
  combo reading, which the guard's list lacks, put the deck back above the target.
- **H5.** The Hosts of Mordor at bracket 2 read 0.95 → 0.96. Its bring-down cut, Notion Thief, was
  replaced by a cheaper card. That lowered the curve and so the land target, which left the 37 lands
  over the target. The keeper never touched bring-down swaps.
- **S1: 89.3%, a miss.** The keeper dropped swaps by coloured pips. In a mono-coloured deck the mana
  base total moves with the curve alone, so the pip order dropped the wrong swaps. Built From Scratch
  lost every swap at every target.

**Run 3** (this PR): the keeper tries every move it may make and makes the one the report reads
best. Its moves are:

- dropping a non-land swap;
- giving a bring-down cut its next replacement.

It ranks them by, in order:

1. staying in the target's band;
2. the least mana base cost;
3. the fewest swaps lost;
4. the most synergy kept.

RUN3_NOTES

## What the pages hold now

RUN3_TABLE

## The persona

- **Seat:** `mtg-precon-upgrader`.
- **Page:** the Party Time precon page (Nalia de'Arnise), at 390 and 1920 wide.
- **Run file:** `research/web/runs/precon-page.json`. It opens "Show 2 more" and switches to
  Bracket 3.
- **Build:** the task 8 build. The keeper change leaves Party Time's nine swaps as they were.

| Task | Baseline | After task 8 |
|---|---|---|
| 0. What upgrades are most meaningful first? | Misread: "swap the four least-connected cards" | Misread: "lands first, then removal, then the rest", taken from the page's order |
| 1. What is the deck trying to do? | Misread: "something about Clerics" | Misread: "a deck about Clerics" |
| 2. The two cards that work together most strongly | Couldn't tell | Couldn't tell |
| **3. What to add, and what each replaces** | Answered: four swaps, each cut given only a count | **Solved: all nine swaps, with a reason on both sides** |
| **4. Would I keep up with my friends?** | **Couldn't tell** | **Couldn't tell** |
| 5. Anything to show a friend? | The four swap boxes and the bracket tile | The Bracket 3 box and the nine-swap list |
| Verdict on its own question | partly | partly |
| ICE-T Essence | 3/7 | 4/7 |

**S3 is met on task 3 and missed on task 4.** The owner ruled on 2026-09-30: the miss is accepted, and task 4 is filed on its own as #893.

On task 4, the persona saw these things:

- the synergy change, "3.0 to 3.3 of 5";
- the band after the swaps;
- the Bracket 3 note: "none of the stronger cards bracket 3 allows does any of these jobs strictly
  better, so aiming higher changes nothing for this deck".

It still could not turn them into "will I keep up". In its words: "whether, after these 9 swaps, a
deck like mine stands a chance against friends who have been buying singles. Nothing on the page
speaks to that."

It also called the Bracket 3 note "the first time anything has told me part of what 'keep it a
bracket 3' means".

What the package fixed from the baseline's findings:

- **F2 (bracket and synergy only for the box deck):** the after-line now gives both after the swaps.
- **F4 ("give its loosest cards a job"):** gone with the old swaps section.
- **F8 (lands and ramp as a side note):** lands and roles are now sections of the package.
- **F5 (the cut side is a count only):** fixed for land and role swaps. It still holds for synergy
  swaps, whose cut reason is a link count ("works with 13 cards in this deck").

## Findings filed

- #890: the commander web has no key (task 2, "couldn't tell", both runs).
- #891: a synergy swap's cut reason is a link count the reader can't check (the rest of F5).
- #892: Party Time reads as "Cleric tribal", and the party theme has no name (F1, both runs). This
  one is for the engine and tagger work.

- #893: "would I keep up with my friends?" has no answer after the package. This is S3's task 4, split
  out by the owner's ruling.

## Caveats

- **Land swaps.** The land section here was built from the 633-land stand-in. Shock and other
  untapped duals outside it appear once the owner's static build writes `lands.json`. Land swaps
  never worsen the mana base and are never dropped, so H5 cannot fail on them.
- **Build time.** The keeper now reads the deck once per move it tries. So a precon whose first
  package misses the mana base takes one to three minutes to build, not a few seconds.
