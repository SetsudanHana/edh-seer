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
| H1, the guard | pass (vacuous) | FAIL 1 | FAIL 1 | **pass** |
| H2, reasons | pass (vacuous) | pass | pass | **pass** |
| H3, legality | pass (vacuous) | FAIL 3 | pass | **pass** |
| H4, role swaps are real | pass (vacuous) | FAIL 15 | pass | **pass** |
| H5, lands | pass (vacuous) | FAIL 124 | FAIL 1 | **pass** |
| S1, 5+ swaps at every target (floor 90%) | 0.0% | 93.4% | **89.3% MISS** | **92.9% pass** |
| S2, synergy kept at target 3 (floor 18 of 20) | none to measure | 19 of 20 | 19 of 20 | **19 of 20 pass** |

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

Every hard measure passes, and so do S1 and S2. Compared with run 2:

- the pages hold 5,218 swaps across the three targets, up from 5,045;
- 14 precons are still under five swaps at some target, down from 21;
- the precons the pip order had emptied gained swaps:
  - Built From Scratch, 0 → 3 at every target;
  - Scrappy Survivors, 3 → 7;
  - Fae Dominion, 4/2/2 → 10/9/9;
  - Living Energy, 4/2/2 → 5/5/5;
- every package now carries the report's reading after its swaps (`after`), which the page quotes.

The build took 91 minutes for all 197 precons.

## What the pages hold now

Tabulated from the 197 run 3 pages:

| | Bracket 2 | Bracket 3 | Bracket 4 |
|---|---|---|---|
| Packages | 195 | 196 | 197 |
| Unreachable | 2 | 1 | 0 |
| Median swaps per package | 9 | 9 | 9 |
| Fewest / most | 1 / 16 | 1 / 16 | 1 / 16 |
| Packages that open with bring-down cuts | 43 (54 cuts) | 7 (7 cuts) | 0 |
| Lands | 429 | 434 | 434 |
| Ramp | 54 | 54 | 54 |
| Consistency | 117 | 119 | 119 |
| Interaction | 143 | 146 | 146 |
| Wipes | 68 | 69 | 69 |
| Synergy | 884 | 908 | 910 |

- **Unreachable targets.** Mystic Intellect can't reach bracket 2, and Quick Draw can't reach 2 or 3:
  no cut brings them under.
- **Precons under five swaps.** The ones under five at some target are mostly decks with little
  left to improve by these rules:
  - Turtle Power (1);
  - Squirreled Away, The Fantastic Four (both editions), Grand Larceny and Draconic Domination (4);
  - Prismari Artistry, Quandrix Unlimited, Seize Control and Built From Scratch (both editions)
    (3);
  - Jeskai Striker (4 at brackets 3 and 4), The Hosts of Mordor (4 at bracket 2) and Quick Draw (1,
    at its one reachable target).
- **Role sections are thin next to lands and synergy.** "Strictly better at the same job" is a high
  bar by design (owner, 2026-09-30).

## Run 4: ten swaps per section (2026-10-01)

The owner, after run 3: "5 seems to be low". Each section now keeps up to 10 swaps (`SECTION_MAX`),
and the page still shows 3 per section, with the rest behind "Show N more". The synergy section had
been full at 5 in 156 of 196 bracket 3 packages, with up to 10 loose cuts waiting behind it.

| Measure | Run 3 (cap 5) | Run 4 (cap 10) |
|---|---|---|
| H1-H5 | all pass | **all pass** |
| S1, 5+ swaps at every target | 92.9% | **94.4%** |
| S2, synergy kept at target 3 | 19 of 20 | **19 of 20** |

| Bracket 3 packages | Cap 5 | Cap 10 |
|---|---|---|
| Median swaps | 9 | **12** |
| Packages with 10+ swaps | 81 | **157** of 196 |
| Most swaps | 16 | 21 |
| Swaps in total | 1,737 | **2,383** |
| Synergy / lands | 908 / 434 | 1,521 / 467 |
| Ramp, consistency, interaction, wipes | 54, 119, 146, 69 | 54, 121, 145, 68 |

- **Where the growth is:** synergy swaps and lands. The role sections stay where "strictly better
  at the same job" leaves them.
- **Party Time:** 9 swaps become 12. After the swaps it still fits bracket 1-2, its synergy score
  is 3.4 (3.3 before) and its mana base is 1.18 (1.19 before).

**First scoring of run 4:** H5 failed on 9 precons, by 0.01 to 0.06. The cause was local, not the
package:

- The dev server fills `static-out` from production on first request and served a dropped fill as a
  404.
- `StaticLookup` reads a 404 as "no such card", so a few mid-build readings lacked a card's data.
  The keeper accepted packages against those readings.
- Two checks showed the reading itself is sound: the same list read six times gave the same total
  every time, and a failing precon rebuilt on its own passed.

With the fill retried, the nine were rebuilt and every measure passed. The owner's build reads a
complete `static-out` and never fills on demand. Build time grew with the package: about 3 hours
for all 197 on this machine, up from 91 minutes.

## Run 5: swaps weighed as the report weighs cards (2026-10-01)

The owner, after run 4: swaps took "into account the amount of links not their magnitude".

A synergy swap's add had to have more distinct partners than its cut. Now both cards are read the
same way, against the deck without the cut, and weighed by the report's own per-card formula
(`card-strength.ts`, shared with `analyze.ts`):

- a link counts its reasons times the deck's theme boost, so a link on the theme counts up to 2.5
  times;
- a link with the commander counts 3 times;
- what a card supplies to others counts at a quarter share, square-root damped.

Each cut asks its first six candidates and keeps the strongest add that beats it, and pairs are
listed biggest gain first. Edge magnitude (firings per use) is still display data. Choosing a
weighting for it is step 2, to be measured first.

| Measure | Run 4 (counts) | Run 5 (weighted) |
|---|---|---|
| H1-H5 | all pass | **all pass** |
| S1, 5+ swaps at every target | 94.4% | **97.0%** |
| S2, synergy kept at target 3 | 19 of 20 | **18 of 20** (the floor) |

| Bracket 3 packages | Run 4 | Run 5 |
|---|---|---|
| Median swaps | 12 | 12 |
| Packages with 10+ swaps | 157 | 157 of 196 |
| Synergy swaps | 1,521 | 1,501 |
| Synergy pairs the same as run 4 | | 237 of 1,501 |
| Deck synergy after the swaps, against run 4 | | higher in 85, the same in 68, lower in 43; mean +0.06 |

- **Most picks changed.** Only about one pair in six stayed the same: adds are now chosen for links
  on the deck's theme and with its commander.
- **Party Time.** Jazal Goldmane gives way to Elas il-Kor ("works with 16 cards in this deck, 1 of
  them on its theme; Elas il-Kor, Sadistic Pilgrim works with 53 cards, 52 of them on it"). Ayara,
  First of Locthwain and Diviner's Wand are new adds.
- **The two S2 misses.**
  - Arcane Maelstrom (4.2 → 4.1) was the miss in run 4 too.
  - Elven Empire is new: 4.2 → 4.1, where the counted picks gave 4.3.
  - The swap compares two cards' strength; the deck's synergy score is a deck-wide figure rated
    against the deck's best card, so a stronger add can lower it. Across the sample the new picks
    raise it more often than they lower it: Power Hungry 3.7 → 4.1, Miracle Worker 4.1 → 4.4.
- **The local data moved between runs.** The dev server had filled more of `static-out` from
  production since run 4: Party Time's own mana base reads 1.29 now, where run 4 read 1.19, on
  unchanged code. The measures compare each package with its precon in the same run, so they hold.
  The run 4 to run 5 comparison mixes the change with the data.

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
