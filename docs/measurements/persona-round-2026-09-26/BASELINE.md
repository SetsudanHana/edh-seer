# Round 1b: the baseline, re-run with the Reddit-grounded seats

Same screenshots, same decks, same task lists as round 1 (`FINDINGS.md`). Only the seats changed:
after round 1 they were rebuilt from r/EDH posts (#551), so each brings the problem in Reddit's
words and judges "solved" by what r/EDH's top replies accept. **This is the baseline future rounds
compare against.**

## Headline

**0 solved · 3 partly · 3 not solved.** Five of six would check the answer on a forum before acting.

| seat | round 1 | round 1b | would go next to (1 → 1b) | ICE-T (1 → 1b) |
|---|---|---|---|---|
| first-cuts | partly | partly | forum → forum | Time 3 → 3 |
| precon-upgrader | not solved | not solved | forum → **playgroup** | Essence 3 → 3 |
| clunky-deck | partly | partly | forum → forum | Time 3 → 3 |
| plan-seeker | partly | **not solved** | playgroup → **forum** | Insight 4 → **3** |
| pod-fit | not solved | not solved | Spellbook → **forum** | Confidence 3 → 3 |
| phone | partly | partly | playgroup → **forum** | Insight 5 → 5 |

## What changed, and why

The site did not change, so every difference comes from the seats.

- **plan-seeker got stricter.** Its Reddit-grounded "solved" needs the cards that win named ("pick a
  way") and a picture of the first five turns. The page gives four win plans "spread about evenly"
  with no member cards, and a clock it says not to plan with, so partly became not solved.
- **Forum as the next stop went from 3 to 5.** The Reddit posters' habit is to post the list and ask;
  the seats now do the same when the page does not show its working.
- **precon-upgrader would ask its playgroup**, because its backstory now says the friend who keeps
  winning started from a precon too. That is a real r/EDH pattern, not a product change.
- **Findings stayed put.** Every cross-seat finding from round 1 recurred: the "well built" verdict
  above the shortages, counts with no cards behind them, one quantity with several numbers, cuts and
  adds that are not one plan. Round 1's ranking holds.

## New findings the Reddit-grounded seats produced

- **phone:** nothing on the page flags what might upset strangers (stealing, extra turns, land
  destruction). r/EDH's rule-zero advice treats that as part of the one-line description.
- **plan-seeker:** no first-five-turns picture; the page grades the deck "well-built" and never says
  why it stalls, which is what the seat came with.
- **clunky-deck:** the page tells it to cut ramp down to an archetype median that the page itself
  says is "what the archetype runs, not what it needs", while the land answer says the curve wants
  41; the seat cannot tell whether the cut makes the land problem worse.
- **first-cuts:** "11 infinite combos" lists two; the seat wanted the rest so it would not cut a combo
  piece. Trimming from the "fits no theme" list would take ramp or interaction under target.
- **pod-fit:** "counter cards" is 15, 14, 32 and 6 in four places.

## Validity

- **Calibration: missed this time.** The planted claim (Staff of Compleation "Answers lands") was
  caught in round 1 and not questioned in round 1b; pod-fit's three checks went to the bracket line,
  Fenrir + Yuna (checked out) and Setessan Champion + Simic Ascendancy (looks wrong, plausibly a real
  error). One seat, two runs, one catch: treat the seat's detection as noisy, and consider planting
  the claim somewhere the seat's own question leads it (the bracket block) rather than in a
  suggestion list.
- **Persona artefact, fixed after this run.** pod-fit's backstory said "you know that is wrong: it has
  a two-card combo neither site noticed", and the seat duly marked "no two-card combos" as suspected
  wrong with no evidence on screen. The backstory now says the seat does not know, and warns against
  assuming facts about the deck. Discount that one suspicion in this run.
- **Canary: clean.** precon-upgrader listed card-text words it met on suggested cards (scry, Dash,
  Changeling) as not understood and used none as understood.
- **Capture flaws unchanged**, deliberately, to keep the baseline comparable: the MORE menu open in
  expanded slices, "Show 2 more" never clicked. Round 2 should fix both (agents README, 1b').

## Suspected engine errors, new in this run

Added to round 1's list (`FINDINGS.md`); same caveat, the seats' quotes of the card text are the
evidence and nothing is confirmed:

| claim on the page | card text the seat quoted | reading |
|---|---|---|
| Count on Luck not on the draw shelves | "At the beginning of your upkeep, exile the top card of your library. You may play that card this turn." | impulse draw missed |
| Desecration Elemental suggested to strengthen a creature deck, "When Nalia is cast, Desecration Elemental triggers" | "Whenever a player casts a spell, sacrifice a creature." | a drawback read as a synergy |
| Setessan Champion + Simic Ascendancy: "When Simic Ascendancy enters … EVERY TIME"; Ascendancy "puts that many counters on a permanent" | Ascendancy: "put that many growth counters on this enchantment" | once, not every time; counters go on itself |
| Asinine Antics: "cares about 0", no constellation links | "create a Cursed Role token" (a Role is an Aura enchantment you control) | enchantment-entering links missed |
| Doomwake Giant + Hateful Eidolon: "When a creature dies … Hateful Eidolon draws you cards" | Eidolon: "Whenever an enchanted creature dies, draw a card for each Aura you controlled that was attached to it" | condition dropped |
| Imprisoned in the Moon on the Ramp shelf, not Removal | (seat could not read the thumbnail; from memory) | role classification |
| Chandra Ablaze can bring back Chandra's Regulator | Ablaze −7 casts red instants and sorceries; Regulator is an artifact | same defect as Acolyte of Flame in round 1 |
