# Precon upgrade package: plan (#767)

Rebuilt 2026-09-30 from issue #767. The original spec and 9-task plan
(`docs/superpowers/specs|plans/2026-09-28-precon-upgrade-package*`) were never committed, so this
file is the plan of record.

## What the owner decided

- **2026-09-28, approach A.**
  - Every precon page shows an upgrade package for each bracket target: 2, 3 and 4.
  - Each package is split into role sections: Lands, Ramp, Consistency, Interaction, Board wipes,
    Synergy / strategy.
  - Each section ranks its own paired swaps, of three kinds:
    - a better card in the same role;
    - a better land;
    - an on-plan card for a loose one.
  - A section shows up to 3 swaps, and 5 on expand. Each swap gives a reason on both sides.
  - Price is ignored.
- **2026-09-30, "better" means strictly better.**
  - Two cards in the same role are compared on the measures `quality.ts` reads (`ingredients`).
  - The add must be at least as good on every measure both cards have, and better on at least one.
  - The reason names what is gained.
  - There are no weights and no popularity. The fitted quality percentile (`q`) is not used.
  - Ties go to the card with more links to this deck.
- **2026-09-30, a target below the precon's starting bracket still shows.**
  - It opens with the cuts that bring the deck down to that bracket, each with a reason.
  - The usual swaps follow.

## What exists today

- `packages/web/scripts/build-precons.mts` runs the report's own pipeline per precon at build
  time: `analyzeDeckStatic`, `chooseCuts`, `swapCandidates`, then `suggestForDeck`.
  `lib/precon-page.ts` cuts the result down to a `PreconPage` record.
- The record's `swaps` hold the first four synergy pairs. Only the add side has a reason; the cut
  side has a link count.
- `matcher/src/brackets.ts` `deckBracket` gives the band:
  - 1-2: no Game Changers and no infinite combos;
  - 3: at most three Game Changers and no two-card infinite combo costing 6 or less in total;
  - 4-5: anything else.

  Combos ride on each card's static shard (`StaticLookup.allCombos`).
- Roles are `matcher/src/build.ts`'s `BUILD_CATEGORIES`, grouped into parents with targets
  (`BUILD_PARENTS`, `adjustedParentTargets`).
- `candidatePool` (`suggest.ts:58`) excludes lands, and no code scores a single land. Lands have to
  be built from scratch.

## How a bracket target maps to a band

| Target | The finished deck must be | What that allows |
|---|---|---|
| 2 | band 1-2 | no Game Changer, no infinite combo |
| 3 | band 3 or lower | up to three Game Changers, no cheap two-card infinite combo |
| 4 | any band | anything legal |

The bands cannot tell 1 from 2 or 4 from 5 (`brackets.ts` L43-46), so neither can the targets.
Target 4 has no guard.

## The rules

**Role swap** (Ramp, Consistency, Interaction, Board wipes)

- **What can be cut.**
  - The cut X is a deck card in the section's role.
  - X is not the commander and not half of a combo.
  - X is not what makes the precon's theme work: a card with more links to the deck than the add
    is kept.
- **What can come in.** The add Y:
  - fills every build role X fills, so no role count drops;
  - is inside the commander's colour identity and not already in the deck;
  - is strictly better than X on the section's role, as defined below.
- **"Strictly better".**
  - Both cards must have `manaValue` and `timing`.
  - A measure only X has means the pair cannot be compared, and the swap is not made.
  - Direction per measure:
    - lower is better: `manaValue`, `drawback`, `restriction`;
    - higher is better: every other measure.
- **Order.**
  1. The number of measures gained.
  2. Mana saved.
  3. Y's links to this deck.
  4. Name.

**Land swap**

- **Measuring a land in this deck.** Three things:
  - the colours it makes that the deck's pips use (`pipsByColor`);
  - whether it enters untapped under this deck's conditions (`classifyLand`,
    `unmetLandConditions`);
  - whether it does anything besides make mana.
- **Strictly better.** Y makes every needed colour X makes, and also either enters untapped where
  X enters tapped or makes a needed colour X does not. It loses nothing else.
- **Basics are cut last.** A basic is never cut below the number of basics the deck's own cards
  search for (`fetchDemand`).
- **The package's lands must not get worse.** `manaBaseScore` total after the package is at most
  the total before it.

**Synergy swap**

- The report's own pairs (`suggestForDeck` `pairs`), unchanged.
- The cut side gets a reason from `chooseCuts`' keep arguments turned around, e.g. "links to 2 of
  your cards".

**Bringing a deck down to a lower target**

- A Game Changer over the target's limit, or one half of a combo the target forbids, is cut first.
  The half cut is the one with fewer links, never the commander.
- It is replaced by the same-role card that links to the most deck cards. The reason says what is
  kept and what is dropped: "keeps the removal, without the Game Changer".

**Assembly (the "gatherer")**

1. For each target, the bring-down cuts come first.
2. Then the sections, in order: Lands, Ramp, Consistency, Interaction, Board wipes, Synergy.
3. Each candidate swap is taken in rank order. It is taken only if the guard still passes on the
   deck with every swap taken so far.
4. A card is cut at most once and added at most once in a package.
5. Each section keeps its top 5 swaps, and the page shows 3.

## Pre-registered measures (task 1)

Written 2026-09-30, before any package code exists. Once a measure has failed it is recorded as a
failure, never loosened afterwards.

`packages/instruments/src/precon-package-score.ts` reads a directory of built precon pages. Where a
measure needs card data it reads the static corpus, just as `build-precons` does.

**Hard: 100%, and the instrument exits 1 otherwise**

- **H1, the guard.** Every package's finished deck sits in its target's band, by `deckBracket` on
  the swapped list and its combos.
- **H2, reasons.** Every swap has a non-empty reason on both sides. Each reason is at most
  160 characters.
- **H3, legality.**
  - An add is inside the commander's identity, in the name index, and not already in the deck.
  - The commander is never cut.
  - No card is cut twice or added twice in one package.
- **H4, role swaps are real.**
  - The add fills every build role the cut fills.
  - The add is strictly better on the section's role. This is checked by recomputing `ingredients`
    for both cards, independently of the code that chose the swap.
- **H5, lands.** `manaBaseScore(...).total` after the package is less than or equal to the total
  before it.

**Soft: recorded, and a miss blocks shipping until the owner rules**

- **S1, enough swaps.** At least 90% of precons have 5 or more swaps at every target. This is
  `docs/player-questions.md` problem 2's "solved: 5-10 swaps".
- **S2, the theme is kept.**
  - Sample: 20 precons, every 9th in `packages/data/precons.json` order.
  - The deck with its target-3 package is analysed again.
  - Its synergy score must not be lower than the precon's own in at least 18 of the 20.
- **S3, the persona.** The `mtg-precon-upgrader` seat on the Party Time precon page, at 390 and
  1920 wide, moves from its baseline to:
  - "solved" on task 3 ("What would you add, and what does each replace?");
  - an answer on task 4 ("would you keep up?").

**Answer key not available.** The EDHREC agreement numbers from #677 (6.5% of our adds in their
add lists, 49.2% of our cuts in their cut lists) are recorded as context but not as a measure. The
EDHREC cache (`.edhrec-cache/`) is local-only, and #768 keeps external data out of anything that
decides.

## Tasks, one PR each

1. **Pre-register and record the baseline.**
   - This plan and `precon-package-score` with the measures above.
   - A run file for the precon page, `research/web/runs/precon-page.json`.
   - The `mtg-precon-upgrader` baseline on today's Party Time page at 390 and 1920, in
     `docs/measurements/precon-package/BASELINE.md`.
2. **Bracket guard.**
   - `matcher/src/bracket-guard.ts`: `bandAfter(deck, swaps)` and `fitsTarget(band, target)`.
   - The bring-down cuts for a target below the precon's band.
   - Unit tests with Game Changer and cheap-combo fixtures.
3. **Land score.**
   - `matcher/src/land-score.ts`: a land's colours, untapped status and utility in a deck.
   - `betterLand(x, y, deck)` and the basics floor.
   - Unit tests on a shock land, a tapped tri-land and a basic.
4. **Candidates and the pick for each section.**
   - `matcher/src/upgrade-sections.ts`: the role pool from the name index (roles `r`,
     identity, `mv` at most the cut's, as a prefilter), then card docs.
   - The strictly-better comparison.
   - The ranked swaps for each section.
5. **Reasons.** Plain-English sentences for both sides from the measures gained, the land facts,
   the keep arguments and the bracket cuts. They follow `packages/web/DESIGN.md`'s words rule.
6. **Gatherer.** One package per target: the bring-down cuts, the sections in order, the guard on
   every take, each card once, the top 5 per section.
7. **Record and build.**
   - `PreconPage.packages` with fields `target`, `from`, `bringDown`, and `sections[]` of
     `{ role, swaps[] }`.
   - `build-precons` fills it in.
   - The old `swaps` stays until task 8.
8. **The page and the crawler HTML.**
   - An "Upgrade it" section with a bracket switch, 3 swaps per role section and "2 more".
   - Reasons on both sides.
   - The server-rendered HTML lists all three packages.
   - The old swaps section is removed.
9. **Measure and ship.**
   - Run `precon-package-score` across all precons.
   - A persona re-run against the baseline.
   - Findings filed. #767 closes when H1-H5 pass and S1-S3 pass or the owner has ruled on them.
