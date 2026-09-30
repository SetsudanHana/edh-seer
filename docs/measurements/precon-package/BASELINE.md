# Precon upgrade package: baseline (#767)

Recorded 2026-09-30, before any package code. The data version is `v-f07b58a42386`, the
production build of that day. The measures are pre-registered in
`docs/plans/2026-09-30-precon-upgrade-package.md`.

## The instrument on today's pages

`npx tsx packages/instruments/src/precon-package-score.ts --static https://edhseer.cards/static`

| Measure | Baseline |
|---|---|
| H1-H5 | pass, vacuously: no page has a package |
| S1, precons with 5+ swaps at every target | **0.0%** of 197 (floor 90%) |
| S2, synergy kept with the target-3 package | no packages to measure |

## What the pages hold today

Tabulated from all 197 production pages:

- **Swaps per page.** 190 pages have 4 (the `PRECON_SWAPS` cap), 3 have 3, 3 have 2 and 1 has 1.
  All of them are synergy swaps.
- **Reasons.** 0 of the 776 swaps give a reason for the card going out, only a link count.
- **Starting band.** 152 precons are in 1-2, 37 in 3 and 8 in 4-5. So:
  - 45 precons (23%) start above target 2 and will open that package with cuts;
  - 8 start above target 3.
- **Game Changers.** 177 precons have none, 19 have 1 and 1 has 2.
- **Infinite combos.** 168 precons have none. The other 29 have between 1 and 9.

## The persona on today's page

- **Seat:** `mtg-precon-upgrader`.
- **Page:** the Party Time precon (Nalia de'Arnise), `research/web/runs/precon-page.json`.
- **Frames:** 390px and 1920px, from the top of the page and from "See the four swaps".

**Verdict on its own question: partly.** ICE-T Essence 3/7.

| Task | Outcome |
|---|---|
| 0. What upgrades are most meaningful first? | Misread as "swap the four least-connected cards". The page never says what to do first and never mentions lands. |
| 1. What is the deck trying to do? | Misread as "something about Clerics". The persona didn't know the word "tribal". |
| 2. The two cards that work together most strongly | Couldn't tell. The map has no key. |
| **3. What to add, and what each replaces** | **Answered, four swaps.** The only reason for any cut was a count ("works with 13 of its cards"). |
| **4. Would I keep up with my friends?** | **Couldn't tell.** The bracket and synergy are shown only for the deck as it comes in the box, not after the swaps. |
| 5. Anything to show a friend? | The four swap boxes, and the bracket tile. |

What it still lacked, in its own words:

- five to ten swaps;
- a reason each old card should go;
- whether the swaps get it close to friends playing "bracket 3";
- whether lands or the "ramp" gap matter more than these swaps.

**The single change that would help it most:** knowing whether the swaps bring the deck level with
a friend's bracket 3 deck.

Its findings:

| Finding | Kind | What it found |
|---|---|---|
| F1 | suspected wrong | "Cleric tribal" is the theme of a deck called Party Time. |
| F2 | blocked task 4 | Bracket and synergy are shown only as the deck comes in the box. |
| F3 | blocked task 2 | The map's colours have no key. |
| F4 | read it wrong | "Give its loosest cards a job" is said about cards the boxes then take out. |
| F5 | cannot be checked | The cut side is a count only. |
| F6 | suspected wrong | Daxos's one reason is weak. |
| F7 | could not understand | The route card isn't paired with anything. |
| F8 | not my question | The ramp and consistency shortfalls are a side note. |

S3 is met when the re-run after task 8 moves task 3 to "solved" and gives task 4 an answer. F2, F4,
F5 and F8 are the findings the package is meant to fix. F1 and F3 are outside #767 and stay with
the report's own issues.
