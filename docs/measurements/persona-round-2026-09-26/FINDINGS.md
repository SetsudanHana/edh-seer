# Persona round 2026-09-26: the first round of the problem-based roster

Six seats, each bringing one problem real players post (`docs/player-questions.md`), against the
live site (edhseer.cards, main at #539). Run in parallel, none seeing another's output.

## Headline: did it solve their problem?

**0 solved · 4 partly · 2 not solved.**

| seat | deck | verdict | would go next to | ICE-T |
|---|---|---|---|---|
| first-cuts | `first-deck-108` (Krenko + 8) | partly | a forum | Time 3/7 |
| precon-upgrader | `precon-party-time` (Nalia) | **not solved** | a forum | Essence 3/7 |
| clunky-deck | `chandra` | partly | a forum | Time 3/7 |
| plan-seeker | `enchanting-rani` (unsure card: Asinine Antics) | partly | the playgroup | Insight 4/7 |
| pod-fit | `yuna-grand-summoner` | **not solved** | Commander Spellbook | Confidence 3/7 |
| phone (390px) | `inalla` | partly | the playgroup | Insight 5/7 |

Three seats would take the answer to a forum to double-check it: the site answered, and was not
trusted. That is the trust gap the research warned about.

## Validity

- **Calibration: caught.** The Yuna fixture's old FALSE claim (Misty Rainforest → Yuna) is gone
  from the live report, so it was replaced with a known defect confirmed live: *Staff of
  Compleation — Answers lands* (#531), whose own text reads "Destroy target permanent you own".
  pod-fit marked it `looks wrong to me`, quoting that text, without being told which claim was
  planted. The fixture needs the same re-check every round; the judged panel
  (`docs/measurements/panel/`) is not in this checkout.
- **Canary: clean.** precon-upgrader listed every do-not-know word as not understood and did not
  use one as understood.
- **Capture flaws** (fix before round 2):
  - opening every `<details>` also opened the site header's MORE menu, which covers the top right
    of every expanded slice (and a few words of the Build fold-out);
  - click-only output was not captured: "Show 2 more" in the cut list, "Show all N", "Trim 3/5/10";
  - the Rani ring's side panel is cut off after "50 more cards", so "6 cards don't connect" was
    never seen.

## Findings, ranked by how many seats hit them (across ceilings)

### 1. The top of the page says "fine" to people who came because it isn't (5 of 6 seats)

"A well-built deck whose cards work together" / "Well built: it has the ramp, draw and answers a
deck needs" / "BUILD 4.x/5 on target" sit above suggestions that say the same deck is short on
draw, interaction, ramp or lands.

- clunky-deck: "The first verdict I see says it's well built and on target. The problems only
  show up six screens later."
- first-cuts: "The top says my draw and answers are fine. Further down it says both are short."
- precon-upgrader (beginner): "I can't tell which to believe, or whether my deck is fine and I'm
  just losing for other reasons."
- plan-seeker: "focused" at the top, "Focus 2.4 developing" and "Spread about evenly across these
  4" below.
- phone: "BUILD 4.8/5" at the top reads as a power claim; it is not one.

`lib/verdict.ts` reads only the two score tones; a deck can be "on target" overall and short in
the roles that matter to the question the reader brought.

### 2. A count with no cards behind it (6 of 6 seats)

Every seat hit a claim it could not check because the cards it counts are not listed:

- the bracket: "Bracket 3 · 1 infinite combo" never names the combo (phone); "No Game Changers
  and no two-card infinite combos here" lists nothing checked (pod-fit), and pod-fit came
  precisely because two sites missed a combo;
- the infinite combos that are listed show name pairs only, not what repeats or how it wins
  (plan-seeker);
- "WIN PLANS go-wide 8 · voltron 7 · burn 6 · combo 6" with no member lists (plan-seeker);
- "2 cards are waiting for something the deck never does" never names the two (first-cuts);
- "15 ramp pieces", "8 cheap ramp/draw", "46 red sources" with nothing tying them to cards
  (clunky-deck).

### 3. One quantity, several numbers (4 seats)

- lands: "36 in deck … wants 36" beside "this curve's own regression asks for 41" in the same box
  (clunky-deck: "I couldn't tell which number the site actually stands behind");
- ramp: 19 / 15 / 8 on Chandra, 7 / 5 / 11 on Yuna (clunky-deck, pod-fit);
- theme share: "60%, highly concentrated", "only 35.6% of this list" and "Focus developing" for the
  same theme (phone);
- theme name: "Cleric typal" headline, "Warrior typal" in a note, "Counts your party members, 51
  cards" in the plan, which is what the box said (precon-upgrader);
- main theme "Blink" with no Blink box, while "Enchantress, your second theme" carries 263 pairs
  against 48 (plan-seeker).

### 4. Cuts and adds are not one plan (3 seats)

- first-cuts, 8 over: the page shows 7 cut names (2 more behind a closed button), "Trim 3 5 10"
  skips 8, and "See the 6 suggestions" leads to "add about 10 cards";
- precon-upgrader: one add is paired with a cut (Multiclass Baldric → Pious Evangel); for the rest,
  "which ones is your call" / "yours to find", which a beginner cannot do;
- pod-fit: the only cut list makes the deck stronger; nothing lowers it.

### 5. Questions the product does not answer at all (product decisions, not fixes)

| question | seat | today |
|---|---|---|
| what fits in $50? | precon-upgrader | "This site shows no card prices." |
| would I keep up with my friends' decks? | precon-upgrader | "A decklist can't tell us" (1 or 2) |
| which swaps make it gentler for my pod? | pod-fit | nothing |
| was my two-land keep bad luck or the deck? | clunky-deck | opening-hand odds only; no "third land by turn 3" |
| one sentence to say at the table | phone | assembled from screens 1, 2, 4 and 15 |

### 6. Smaller, single-seat

- every score explanation sits behind small grey fold-outs, on the phone the easiest thing to miss;
- ring discs "+1" between two others are too small to risk with a thumb (phone);
- "Why you might keep it: its strongest link is to your main theme" is word-for-word identical on
  all four Rani cuts (plan-seeker);
- targets are "the archetype's median — what the archetype runs, not what it needs", read as "the
  Command Zone template problem again" (clunky-deck);
- "Over 99? Trim" on a page that says a deck is exactly 100 (first-cuts).

## What worked (said unprompted)

- the pair cards with "Read both cards": the one place a claim could be checked against card text
  (pod-fit verified Setessan Champion + Simic Ascendancy; plan-seeker checked Doomwake Giant +
  Hateful Eidolon);
- "Rabblemaster is used by the same cards as Grenzo … cutting one leaves the rest doing the same
  job" (first-cuts kept its favourite and cut the other);
- the draw finding with a number and a named source of slots (clunky-deck);
- the ring tap on a phone, no hover needed (phone); new-to-them insights: Kindred Discovery ranked
  above Inalla, "nothing this deck kills is exiled", the Enchantress web behind a "Blink" label;
- "Is it a 1 or a 2? A decklist can't tell us" read as an honest refusal (pod-fit).

## Suspected engine errors (checked against the card text the seats quoted; for the engine session)

Quarantined per the README until the engine confirms. My reading of the quoted oracle text:

| claim on the page | card text says | my read |
|---|---|---|
| "When Chandra, Flame's Catalyst is in the graveyard, Jaya's Phoenix can bring it back" | Phoenix: "Whenever you cast a planeswalker spell, you may return **this card**" | wrong direction |
| "When Chandra's Regulator is in the graveyard, Chandra, Acolyte of Flame can bring it back" | Acolyte −2: cast target **instant or sorcery** MV ≤ 3; Regulator is an artifact | wrong |
| "When Nalia de'Arnise is cast, Folk Hero draws you 1 card" | the granted ability triggers on casting a spell that shares a type with the commander, from the battlefield | wrong trigger |
| Brash Taunter among "a creature being dealt damage: 0 cause it" | "{2}{R}, {T}: fights another target creature" | missed cause |
| "EVERY TIME When Setessan Champion gets a counter, Terrasymbiosis draws you cards" | "Do this only once each turn" | overstated |
| Hellrider, Shared Animosity, Massive Raid barely linked in a go-wide Goblin deck | each counts or rewards attacking creatures / creatures you control | missed links |
| Multiclass Baldric "happens only once: with Sevinne's Reclamation" in a party deck | every line is about party members | missed links |
| Asinine Antics' token shown as "Wicked // Cursed", and "Wicked" in the cut reason | "create a Cursed Role token" | token naming |
| Rikku is the 5.0 key card and "what it does isn't read yet" | — | known: #532 |
| Staff of Compleation "Answers lands" | "Destroy target permanent you own" | known: #531 (the calibration claim) |

## What this says about the research question

The owner asked whether the tool solves the problems people bring. On this round: **it answers
the plan and synergy questions best** (the only two seats to score above 3 were the two whose
question was about how the deck works), **it half-answers the tuning questions** (cuts, mana), and
**it does not answer the money and playgroup questions** (budget, pod fit), which are two of the
five problems in the research. The fixes that would move the most seats are 1 and 2 above: a top
verdict that carries the deck's main problem, and the cards behind every count.
