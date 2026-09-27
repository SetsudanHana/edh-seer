# Persona round 2026-09-27: after the report cohesion work

Six seats, each bringing one problem real players post (`docs/player-questions.md`), against the
live site (edhseer.cards) after the cohesion plan shipped: the commander's map on Glance, theme
rows, plan map, combo loops, cut maps, the one card drawer, the phone pass, and the pin removed.
Run in parallel, none seeing another's output. Same fixtures as 2026-09-26, except pod-fit, which
moved to `mari-takes-control` with the plant.

## Headline: did it solve their problem?

**1 solved · 5 partly · 0 not solved** (2026-09-26: 0 · 4 · 2).

| seat | deck | verdict | would go next to | ICE-T | 09-26 |
|---|---|---|---|---|---|
| first-cuts | `first-deck-108` (Krenko + 8) | partly | the playgroup | Time 3/7 | partly, forum, 3/7 |
| precon-upgrader | `precon-party-time` (Nalia) | partly | a forum | Essence 3/7 | **not solved**, forum, 3/7 |
| clunky-deck | `chandra` | partly | a forum | Time 3/7 | partly, forum, 3/7 |
| plan-seeker | `enchanting-rani` (unsure card: Asinine Antics) | partly | a forum | Insight 4/7 | partly, playgroup, 4/7 |
| pod-fit | `mari-takes-control` | partly | a forum | Confidence 3/7 | **not solved** (Yuna), Spellbook, 3/7 |
| phone (390px) | `inalla` | **solved** | stops, has the answer | Insight 5/7 | partly, playgroup, 5/7 |

Four seats would still check the answer on a forum: the site answers and is not yet trusted. The
two `not solved` from 09-26 moved to `partly`; the phone seat is the first `solved`, on the strength
of "Say this at the table" being on its first screen with a Copy button.

## Validity

- **Calibration: missed the plant, caught two other real defects.** The planted FALSE claim is live
  ("Lively Dirge puts cards into the graveyard that Tinybones, the Pickpocket can bring back",
  Tinybones casts from an opponent's graveyard). pod-fit did not question it. It did question
  three other claims, and two check out as wrong (E1, alt-win "turn 1" below). The instrument is
  not soft, but it did not find the plant; keep it and re-run.
- **Canary: clean.** precon-upgrader listed every do-not-know word as not understood.
- **Capture:** full-viewport slices, loaded and expanded (report folds only, click-only lists
  clicked, first three theme rows opened), plus the plan-seeker's card drawer and walk. Gaps:
  slices overlap by 60px but a few seats saw a sentence cut at a slice top (clunky: "Kept two
  lands?"), and only the first three theme rows were opened.
- `seed-check.ts` could not run here (no MongoDB); the plant was confirmed in the live report text.

## Findings, ranked by how many seats hit them (across ceilings)

1. **"Well built" / "on target" beside red "N short" suggestions** — precon, clunky, first-cuts
   (beginner + two tuners). "Well built: it has the ramp, draw and answers a deck needs" over
   "You will run out of cards…", "3 short on interaction". The first verdict reads as a pass and
   the problems only appear chapters later.
2. **The table sentence disagrees with the page** — pod-fit, phone, plan-seeker.
   - "It wins mostly by …" against "Spread about evenly across N plans" (phone, plan).
   - "Nothing in it takes extra turns … or destroys every land" against the bracket's "Not
     checked: mass land destruction or chained extra turns" (pod-fit, phone). The table line does
     read every card for these (`table-talk.ts`); the bracket's "Not checked" means the band does
     not count them. The words say the opposite.
3. **One theme, several numbers; bars that do not separate** — precon ("Cleric typal (15 of 63)",
   "Works with 19 cards", "Party 51 cards"), phone ("Wizard blink 4 cards" in the commander panel
   vs "39 cards" in the theme rows), clunky ("planeswalker 20" vs "Planeswalkers matter 23").
   Theme bars at 35-51 of 63 nonland cards all look alike (precon: four themes at 51).
4. **Silent zeros** — phone: no Game Changer count anywhere when there are none; pod-fit: no combo
   list and no "0 combos" when there are none, while the table line says "goes infinite".
5. **Jargon met before its gloss** (every seat): "pulls double duty" (5 seats), "Helpers" (5),
   "ONCE / EVERY TIME / ALWAYS ON" (4), "+0.2 to Build, at least" (4), "N power on board by turn
   5" (4), "Archetype median" (4), the circled 5.0 scores (3, explained only in the cut list),
   "links to nothing here" (3), "not timed" (3).
6. **Cut list** — first-cuts: "The other 2 have to come from a role you run more of than you need,
   below" when no role is over (a dead end); reasons are counts it cannot check ("Keeps working with
   only 19 other cards"); Treasure Nabber is both the table line's "Heads-up" and a cut. plan-seeker:
   five cuts carry the identical sentence and map.
7. **"An alternate win condition · turn 1"** (pod-fit): the tile prints the turn its cheapest alt-win
   card can be cast, which reads as a turn-1 win beside "Fastest … around turn 9".
8. **Swaps that bring power down** (pod-fit): not answered; every suggestion adds power. Known gap.
9. **Phone tap targets** (phone): map dots ~30px packed together; "WHAT THIS MEASURES" at ~11px;
   the answers chevrons.
10. **"3 suggestions" vs where the swaps are** (precon): two of the numbered suggestions end "yours
    to find"; the out-and-in pairs are under other headings.
11. **Two mana numbers for turn 6** (clunky): "44% – 65% to make 6 mana by turn 6" in the tile and
    "Turn 6 · 97% of the deck payable" under the chart. Different questions, same look.
12. **Lands verdict ignores ramp** (clunky): "wants 36: on target" beside "the formula … would ask
    for 41 … not trusted this far out"; lands and ramp are judged apart.

## Engine claims checked (quarantined until checked)

Confirmed wrong or misleading, for the engine session:
- **E1 Mari exile.** "Nothing this deck kills is exiled — everything it answers can come back",
  while Mari reads "Whenever a creature an opponent controls dies, exile it". The answers finding
  ignores the commander's exile clause.
- **E2 Nalia attacks.** "When a Human attacks thanks to Nalia de'Arnise, Frontline Medic grants a
  keyword" (also Seasoned Dungeoneer). Nalia makes nothing attack.
- **E3 Blasphemous Act finishes the wide-board plan** (Rani): a board wipe drawn as the plan's
  finisher.
- **E4 Suggestions that kill your own creatures** (Nalia, 45 creatures): Lethal Vapors ("Whenever a
  creature comes into play, destroy it"), Spreading Plague, Grave Peril, offered because "Lethal
  Vapors puts cards into the graveyard that Thwart the Grave can bring back".
- **E5 Key cards "not read yet"**: Mari ("what it does isn't read yet · When a creature dies thanks
  to Go for the Throat, Mari … triggers"), Displacer Kitten and Fear of Sleep Paralysis (Rani) score
  5.0 while marked unread.

Plausible, not yet verified: Asinine Antics' Cursed Roles (Aura tokens) not linked to
enchantment-enters payoffs; Sugar Coat / Eaten by Piranhas / Amphibian Downpour counted in "one big
creature" and not as removal; Scheming Symmetry not on the Tutors shelf.

Refuted: Chandra, Hope's Beacon and Chandra, Flameshaper on the Ramp shelf (both add mana);
"Kept two lands? … 80% on the play, 75% on the draw" was a crop misread (the page says 60% / 75%).

## Unique findings per seat

first-cuts 3 (dead-end cut sentence, heads-up card cut, score order), precon 3 (creature-killing
suggestions, "3 suggestions" vs swaps, Nalia attacks), clunky 3 (lands vs ramp, two turn-6 numbers,
land formula), plan 3 (Antics roles, Blasphemous Act finisher, identical cut lines), pod-fit 3
(Mari exile, alt-win turn 1, no power-down swaps), phone 2 (tap targets, Game Changer count). Every
seat pays its rent.
