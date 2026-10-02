# Persona round 2026-10-02: after the card grammar and the precon upgrade package

Six seats, each bringing one problem real players post (`docs/player-questions.md`), plus the
`ui-designer` seat. This round ran against the **deployed site** (`https://edhseer.cards`, the build
live on 2026-10-02), not a local build. What it was for:

- the card grammar's first steps (#896, tasks 1 to 3: the references walk, the triggering object,
  "it" as the pronoun, #897-#901);
- the precon upgrade package (#767): role sections on the precon page, up to 10 swaps each (#902),
  bracket tabs, and swaps weighed the way the report weighs cards (#842).

Captured with `research/web/ui-review-capture.ts` (`REVIEW_BASE_URL=https://edhseer.cards`) at 390,
1920, 2560 and 3840. The precon page was also captured top to bottom in viewport slices with every
"show more" open, at Bracket 2 and Bracket 3, because two slices stopped above most of its swaps. The
seats ran in parallel, none seeing another's output.

## Headline: did it solve their problem?

**1 solved · 5 partly · 0 not solved** (2026-09-29: 0 · 6 · 0; 2026-09-27: 1 · 5 · 0).

| seat | deck | verdict | would go next to | ICE-T | 09-29 |
|---|---|---|---|---|---|
| first-cuts | `first-deck-108` (Krenko + 8) | partly | a forum | Time 4/7 | partly, playgroup, 3/7 |
| precon-upgrader | `precon-party-time` (Nalia), **report and precon page** | partly | a forum | Essence 3/7 | partly, playgroup, 4/7 |
| clunky-deck | `gisa` | partly | a forum | Time 5/7 | partly, forum, 3/7 |
| plan-seeker | `enchanting-rani` (unsure card: **Maddening Hex**) | partly | Commander Spellbook | Insight 3/7 | partly, Spellbook, 5/7 |
| pod-fit | `mari-takes-control` | partly | a forum | Confidence 3/7 | partly, forum, 3/7 |
| phone (390px) | `inalla` | **solved** | stops, has an answer | Insight 4/7 | partly, stops, 4/7 |

The phone seat is back to `solved`: "Say this at the table" is on the first 390px screen again, which
was last round's one regression. First-cuts now gets exactly 8 cuts for 8 over (09-29: 7). Clunky
gained two points. Plan-seeker lost two: its brief now names Maddening Hex, and every sentence about
Hex reads "happens only once" with its partners hidden behind "6 others". The precon seat lost one,
for a reason new this round: the precon page and the report disagree (finding 4). Four seats would
take the answer to a forum first, which means we answered but were not trusted.

## Validity

- **Calibration: HIT, the first in three rounds.** The plant is live and more visible: Tinybones'
  own row on Mari's Cards table now reads "Lively Dirge puts cards into the graveyard that Tinybones,
  the Pickpocket can bring back" (it had been a click deep in the "every way it works" lists).
  pod-fit flagged it `SUSPECTED-WRONG` with the right reason: "Tinybones plays cards from an
  opponent's graveyard, while Dirge fills mine". `seed-check.ts` could not run here (no Mongo), so
  the plant was checked on the live page instead. Since the family is now on a first-screen row,
  consider whether it still calibrates a careful reader or only a skimming one.
- **Canary: clean.** precon-upgrader listed "tribal", "ramp", "consistency", "infinite combo",
  "bracket" and "mana curve" as not understood, and did not use them as if it did.
- **Fixtures.**
  - **clunky-deck stays on Gisa.** Its report still leads with "You will run out of cards before you
    run out of turns".
  - **plan-seeker's unsure card is now Maddening Hex.** It is the first card under "Weak here, but
    something argues for them". The old pick, Asinine Antics, moved to "Nothing argues for keeping
    these".
- **Capture gaps, known:**
  - Two slices per step still leave gaps between chapters. Seats named the top of "Cards that carry
    it", Asinine Antics' reason and Cards rows 12-14.
  - The Cards table is never captured past about row 31.
  - On every report capture, "Show 2 more" in Possible cuts and "Show all N" in the suggestions were
    not clicked (precon seat).
  - The card drawer, the only place a card's text is shown, was not captured. Every "I can't see
    what this card does" finding is partly that: the text is one click away.
  - The live site needs `REVIEW_CHROMIUM` and `REVIEW_TRUST_SPKI` set to the proxy CA's SPKI in this
    sandbox. Without them the run dies on `ERR_CERT_AUTHORITY_INVALID`.

## What the two shipped pieces of work did, as the seats saw them

**The card grammar.**

Fixed and visible:
- **Mari's exile (09-29 E1).** It now reads "When a creature dies thanks to Go for the Throat, Mari,
  the Killing Quill exiles it". It used to say "exiles a creature an opponent controls", a different
  creature. No seat questioned it.
- **Revel in Riches (09-29 E3).** The broken plural is gone ("Treasure counts toward the 10 or more
  Treasures Revel in Riches needs").
- **Nalia (09-29 E2).** The old "Frontline Medic grants a keyword" is now "When Nalia de'Arnise
  attacks, Seasoned Dungeoneer grants protection". Dungeoneer triggers "Whenever you attack", so this
  is true.

Not fixed:
- **Identical combo steps (09-29 #12).** Still live on Rani: "① When Dualcaster Mage enters thanks
  to Essence Flux, it copies a spell" and "②", word for word the same (plan-seeker).
- **Wrong zone in a "thanks to" sentence.** There is a new instance of the defect family the grammar
  is for (E3 below).

**The precon upgrade package.** The precon seat read all 11 swaps on the page. Its best moment on
the whole site: "TAKE OUT Snowfield Sinkhole → PUT IN Scrubland / Enters tapped. → Never enters
tapped and makes white or black." The Bracket 3 tab also earned trust: "These are the same swaps as
at bracket 2: none of the stronger cards bracket 3 allows does any of these jobs strictly better".

But the seat ended `partly` because:
- the page and the report give different advice (finding 4);
- seven of the 11 reasons lean on Thwart the Grave, whose text is not on the page;
- "would I keep up with my friends" is still unanswered, with "synergy score goes from 3.0 to 3.4 of
  5" and nothing to compare it with.

## Findings, ranked by how many seats hit them (across ceilings)

1. **The main theme is smaller than the groups under it** (repeat of 09-29 #3, now four seats).
   - precon: "Your main theme is Cleric tribal (15 of 63 nonland cards)" over "Party … 51 cards", in
     a box called "Party Time".
   - plan-seeker: "Your main theme is **Blink** (27 of 62 nonland cards)" directly over "Enchantress
     SECOND THEME … 39 cards", with no Blink bar at all.
   - pod-fit: "Aristocrats (9 of 63 nonland cards)" against "Artifacts matter 29".
   - phone: "Creature ETBs 17 with Inalla" on Glance against "Creature ETBs 45 cards" in Game plan.

   A beginner and three experts. The main theme is chosen by something other than size, and the page
   never says what. A "second" theme bigger than the first reads as an error.
2. **"Focused" over "unfocused"** (repeat of 09-29 #7). Four seats:
   - precon: "SYNERGY 3.0/5 focused" over "Focus 1.2 unfocused";
   - clunky: "3.7 focused" over "Focus 2.4 developing";
   - plan-seeker: "3.6 focused" over "Focus 2.3 developing";
   - phone: resolved it only by opening the fold.

   The fold explains the average. The word clash is met first.
3. **No kill and no clock** (repeat of 09-29 #2 and #12). Five seats:
   - plan-seeker could not finish "this deck wins by …": none of five Dualcaster loops names what
     kills.
   - phone: "A combo · speed not modelled", while the table line's "turn 7" covers only the creature
     plan.
   - first-cuts, clunky: the combo is "what they produce, not how to assemble it".
   - pod-fit: "Damage or drain · speed not modelled". It counted this as an honest refusal, but turn 9
     is then only a lower bound.

   The Combos page's "Wins through Impact Tremors" (Inalla) is the answer, one page away from where
   the question is asked.
4. **The precon page and the report disagree** (NEW, from the precon package). One seat, but the
   beginner, and it changed its verdict.
   - **Different swap for the same card:** "Crib Swap → Path to Exile … The same removal for 2 less
     mana" (precon page) against "Out: Crib Swap / Swap it for Prowl, Stoic Strategist" (report).
   - **Different first step:** lands first on the page, "You will run out of cards" first in the
     report.
   - **Different counts:** "11 swaps" against "3 SUGGESTIONS".
   - **Different numbers for the same card:** "Stick Together: Works with 11 cards in this deck, 5 of
     them on its theme" (page) against "Keeps working with only 4 other cards" (report). The same
     happens for Calculating Lich (14 / 10), Felisa (15 / 11) and Mirror Entity (17 / 8).

   Both numbers are presumably right, but they count different things: every link on the page,
   repeating links in the report. The two phrasings do not say so. "Five on its theme out of four in
   total" is what the seat read.
5. **Cut lists argue with themselves** (repeat of 09-29 #5).
   - first-cuts:
     - all 8 cuts carry a green "Why you might keep it";
     - "weakest first" is not ordered by any number on screen (2.3, 2.6, 2.5, 1.6, 2.9, 2.7, 2.8,
       2.8; `CutList.tsx` orders by an internal ranking);
     - Brash Taunter, at 2.9, is cut while scoring above the deck's own "SYNERGY 2.8", so the seat
       refused it and ended with 7 cuts it believed;
     - "only 22 other cards" carries no scale.
   - plan-seeker: Maddening Hex and Protection Racket read word for word the same.
   - first-cuts also hit a contradiction: Treasure Nabber is named in "Say this at the table" ("it
     steals permanents (Treasure Nabber)") and listed among "These 8 are doing the least here".
6. **"Better cards for the same job" changes the job.** Two seats:
   - plan-seeker: "Out: Chaos Warp → Gossip's Talent … Interaction 17 → 16, Consistency 15 → 16";
   - clunky: "Out: Tragic Slip → Grim Javelineer … Interaction 17 → 16".

   Repeats the 09-29 precon note. The heading promises the same job, and the line says otherwise.
7. **The claims can be checked against only one card.** Four seats: the precon seat says "Thwart the
   Grave" underlies 7 of 11 swaps; pod-fit, plan-seeker and first-cuts say the same (repeat of 09-29
   #6). The drawer has the text, a click away, and that frame is not in the capture.
8. **Nothing brings a deck down** (repeat, known gap). pod-fit: every suggestion makes Mari stronger.
   The precon page has Bracket 2 / 3 / 4 tabs but no "my pod finds it too strong", and the report
   never says what cutting Orcish Bowmasters does to the bracket.
9. **One ramp, two readings** (repeat of 09-29 #1; one seat this round). clunky: "Ramp 17, 4 over
   target … room to cut" against "8 of your 17 ramp cards that keep producing mana … the other 9 are
   one-shots". Also "30 /37 … of 38 in the deck" in a mono-black deck with 37 lands (repeat of 09-29
   #9).
10. **Phone.** The map's dots are too small to tap, and "See the two on the map" leads back to the
    same map. Cards-page reasons are cut off at about 30 characters behind a small "⋯". The score
    explanation is a small fold one screen away from the header score (repeats).
11. **Answer coverage counted three ways** (pod-fit): "3 of 5 answer classes are covered", "3/4 KINDS
    OF PERMANENT YOU CAN ANSWER", and a six-row table.

## Engine claims (quarantined until checked; for the engine session)

Checked against the cards' printed text and their derived tags. The tags come from the local static
corpus `v-f07b58a42386`, which is older than production, so treat them as indicative. **Wrong:**

- **E1 Nuclear Fallout is not counted as a board wipe** (pod-fit: "Board wipes 0 … You run 0,
  against a target of 2", while Nuclear Fallout sits in the cut list).
  - Oracle: "Each creature gets twice -X/-X until end of turn."
  - The derived ability is `{kind: "pump", amount: "twice -X/-X", subject: each creature}`.
  - The word "twice" keeps the amount from reading as a negative, so a one-card sweeper is a pump.
  - Mari's headline complaint ("short on board wipes") rests on it.
- **E2 Baleful Mastery is on the Draw shelf** (clunky, Gisa: "Draw 12 cards: … Baleful Mastery").
  - Oracle: "If the {1}{B} cost was paid, an opponent draws a card."
  - The tag already has it right: `draw-card`, `subject.control: "opp"`.
  - The role layer counts the draw without reading whose it is, so Gisa's "13 against a target of 15"
    is at least one too high.
- **E3 Kaya's Ghostform "thanks to" Nightmare Shepherd** (plan-seeker, Rani, Cards row 14): "When a
  creature is exiled thanks to Nightmare Shepherd, Kaya's Ghostform blinks a permanent".
  - Ghostform returns a creature that "dies or is put into exile" from the battlefield.
  - Shepherd exiles the card from the graveyard, after it died. That is a zone mismatch, and the two
    compete for the same death rather than chaining.
  - This is the same family as the plant: a link built on a zone or subject the oracle text doesn't
    support. It is a case for the grammar's zone handling (#896 task 2, "zone").
- **The plant** (above): "Lively Dirge puts cards into the graveyard that Tinybones … can bring
  back".

**Plausible, not verified:**
- **Scheming Symmetry.** It is not on Mari's Tutors shelf and is cut as "Works with nothing else in
  this deck" (pod-fit). Its tags have a `search` by you, so the role layer, not the parse, leaves it
  out. A symmetric tutor may be left out deliberately; if so, the cut reason should say so.
- **Cling to Dust and Cremate on the Draw shelf** (clunky). They are cantrips; counting them is
  defensible but inflates "Draw".

**Refuted:**
- **Oketra's Monument "talks about white creatures" in a mono-red deck** (first-cuts, `SUSPECTED-WRONG`).
  It is a colourless artifact, legal in Krenko, and its "create a 1/1 Warrior" half works with any
  creature. The confusion is valid data, and an odd pick, but it is not an engine error.
- **Grim Javelineer "1 of them on it" under "Cards that work together"** (precon). The theme is Cleric
  tribal and Javelineer is a Warrior, so 1 on theme is correct. The finding is the theme (finding 1),
  not the count.

## Design review (ui-designer)

_Pending; added when the designer seat returns._

## Unique findings per seat

- **first-cuts: 3.** "Weakest first" isn't ordered by any number shown; Treasure Nabber is both the
  table's heads-up and a cut; "22 × Goblin Chieftain gives Howlsquad Heavy …" as a most-common link.
- **precon: 3.** The precon page against the report (Crib Swap, first step, counts); "works with 11"
  against "only 4"; Bracket 3 "still fits" under a "BRACKET 1–2" box.
- **clunky: 3.** Baleful Mastery as draw (E2); draw is not split into lasting and one-shot the way
  ramp is; the Turn 3 "CARD DRAW 5" read as the deck's draw count.
- **plan-seeker: 3.** Main theme smaller than the second theme; the Ghostform/Shepherd zone (E3);
  "Creatures alone could win by turn 8" undefined.
- **pod-fit: 4.** Nuclear Fallout (E1); Scheming Symmetry; answer coverage three ways; the plant.
- **phone: 2.** The table sentence's clock covers only the creature plan; "works with all 3" captions
  unreadable at 390.

Every seat pays its rent.
