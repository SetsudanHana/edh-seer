# Persona round 2026-09-29: after the report rail

Six seats, each bringing one problem real players post (`docs/player-questions.md`), plus the
`ui-designer` seat, against the build about to deploy: main after the report rail (#817, #819),
the land target that weighs ramp by resilience and draw by cost (#814), and the plain-English copy
pass. Served locally with the live card data behind it (`vite.prodstatic.config.ts`), captured with
`research/web/ui-review-capture.ts` at 390, 1920, 2560 and 3840. Run in parallel, none seeing
another's output. This round also covered the rest of the site: home, card search, a card page,
commander search, a commander page, the precon index and a precon page.

## Headline: did it solve their problem?

**0 solved · 6 partly · 0 not solved** (2026-09-27: 1 · 5 · 0; 2026-09-26: 0 · 4 · 2).

| seat | deck | verdict | would go next to | ICE-T | 09-27 |
|---|---|---|---|---|---|
| first-cuts | `first-deck-108` (Krenko + 8) | partly | the playgroup | Time 3/7 | partly, playgroup, 3/7 |
| precon-upgrader | `precon-party-time` (Nalia) | partly | the playgroup | Essence 4/7 | partly, forum, 3/7 |
| clunky-deck | **`gisa`** (new, see Validity) | partly | a forum | Time 3/7 | partly (Chandra), forum, 3/7 |
| plan-seeker | `enchanting-rani` (unsure card: Asinine Antics) | partly | Commander Spellbook | Insight 5/7 | partly, forum, 4/7 |
| pod-fit | `mari-takes-control` | partly | a forum | Confidence 3/7 | partly, forum, 3/7 |
| phone (390px) | `inalla` | partly | stops, has an answer | Insight 4/7 | **solved**, stops, 5/7 |

The phone seat's `solved` last round rested on "Say this at the table" being on its first screen.
It is now 1,650px down a 390px page (measured), under the commander's map, and the seat built its
sentence from two chapters instead. That is the one regression this round. Precon-upgrader and
plan-seeker each gained a point; nobody went to `not solved`. Two seats would still take the
answer to a forum, one to Commander Spellbook: the combo list says what repeats, not what kills.

## Validity

- **Calibration: the plant is live, pod-fit missed it again (second round running).** The original
  "Lively Dirge → Tinybones" sentence is gone; four of the same family are live on Mari:
  "Meathook Massacre II / Trading Post / Spymaster's Vault / The Sackville-Bagginses puts cards into
  the graveyard that Tinybones, the Pickpocket can bring back" (Tinybones casts from the graveyard
  of the opponent it damaged). pod-fit questioned four other claims and two check out as wrong
  (E1, E3 below). Not soft, but twice past the plant: consider making the seat's brief point at the
  Cards page, where these sentences live.
- **Canary: clean.** precon-upgrader listed "deathtouch", "exile", "ramp", "tribal" and the rest as
  not understood.
- **Fixture change: clunky-deck moved from Chandra to Gisa.** Chandra's report no longer carries a
  draw or land finding (its one suggestion is "4 short on interaction"), which the fixture rule
  forbids. Gisa's leads with "You will run out of cards before you run out of turns" and a colour-
  speed note. The seat's score is comparable in kind, not in deck.
- **Capture gaps, known:**
  - The first frame after a navigation (`land-*-p1`, `cards-*-p1`, `combos-*-p1`) caught the loading
    skeleton on most decks; the seats read the Glance from its `-expanded` frames, which were
    loaded. Fix the capture's settle to wait for `#read` before the first shot.
  - Two slices per step (`MAX_SLICES = 2`) left gaps between chapters (the top of "Cards that carry
    it", the cut-list heading) and the bottom of the Cards table.
  - Card images do not load through the local static proxy; every seat was told and none reported it.
  - The designer seat lost some images to a request limit and reviewed from the widths either side.
- **Refuted as capture artefacts:** the phone card sheet "not scrolling" (the capture scrolls the
  window, not the sheet; the sheet is `overflow-y: auto`, 870px of content in 826px), and the blank
  Combos pages (both load given longer: "No known infinite combos…" for Nalia, three for Inalla).

## Fixed during the round

- **The rail's way back renamed itself** (clunky-deck: card-p2 read "Back to manabase" for a card
  opened from Game plan). The label followed the chapter behind the card as the page scrolled. It is
  now taken when the card opens. Regression test in `card-drawer.test.tsx`.

## Findings, ranked by how many seats hit them (across ceilings)

1. **One ramp, three numbers** — clunky (Gisa: "8 rocks, dorks and land ramp" against "Ramp 17 …
   4 over"), pod-fit (Mari: "3 rocks, dorks and land ramp" against "Ramp 16", with Sol Ring, Arcane
   Signet, Fellwar Stone on the shelf), precon (Nalia: 5 against 9). Beginner plus two experts. The
   land target counts the ramp it can trust (#814: lands and dorks, not rituals or Treasure); the
   Roles shelf counts every card that makes mana. Both are right and neither says which it is, so
   "4 over: room to cut" reads as spare ramp the land count never relied on. NEW since #814 put the
   basis on screen.
2. **"Damage or drain · no turn estimate" reads as a hole** — pod-fit, plan-seeker, clunky; phone
   the same for "A combo · no turn estimate". Four seats. The one route every drain deck runs has no
   speed, and it is the one they came about ("why do games stall").
3. **One theme, two counts** (repeat of 09-27 #3) — phone ("Wizard blink 4 cards" on Glance, "39
   cards" in Game plan), first-cuts ("Anthems 7" / "38"), precon ("Your main theme is Cleric tribal
   (15 of 63 nonland cards)" directly over "Party … 51 cards", under a commander whose text says
   "full party"). The Glance panel counts cards linked to the commander; the theme rows count the
   deck. Neither says so.
4. **Advice that points the other way** — first-cuts ("3 SUGGESTIONS" opens with "Add ~3" twice and
   "wants 36: 1 under" on a 108-card list; 7 possible cuts for 8 over, no word on the 8th), precon
   (#2 "these are yours to find": adds with no cuts; repeat 09-27 #10), pod-fit (no power-down swaps;
   known gap, 09-27 #8).
5. **Cut reasons that cannot be weighed** — first-cuts ("Keeps working with only 20 other cards";
   the Cards page says a low number means "works with fewer cards here, not bad"; Goblin Piledriver
   cut while its own card says the wide-board win plan counts it), plan-seeker ("its strongest link
   is to your main theme" identical on three cuts; repeat 09-27 #6), precon (Jazal Goldmane cut while
   listed under "TURNS IT INTO A WIN"; "Better cards for the same job" swap that moves Interaction
   14 → 13, Consistency 10 → 11).
6. **Only the commander's text is on screen** — plan-seeker ("When Arcane Signet is cast, Displacer
   Kitten flickers…": any spell?), pod-fit (cannot see Morbid Opportunist is a Rogue), first-cuts ("I
   can't see what any card except Krenko does"). Every pair sentence is checkable only against one
   of its two cards; the drawer has CARD TEXT, but a click per card.
7. **Scores met before their bands** — plan-seeker (header "SYNERGY 3.6/5 focused" vs "Focus 2.4
   developing"), precon ("Focus 1.3 unfocused" in red on a deck that is "on target"), clunky, phone,
   first-cuts ("tight", "on target", "developing" in the words-not-understood lists of all six).
8. **"An alternate win condition · cast by turn 1"** (pod-fit; repeat of 09-27 #7, unfixed) beside
   "Fastest … around turn 9" and "Revel in Riches 40% by T5".
9. **Mana numbers that share a figure** — clunky ("30 /37 sources by turn 3" in the tile, "Only 30 of
   your 38 black sources … takes 37" in Improve: the same 37 means two things), "costs about 0.6
   turns in every 10" undecodable (clunky, first-cuts, precon, pod-fit list it), the two-lander
   answer ("Kept two lands? A third by turn 3 in 61%…") buried in a fold and silent on luck, nothing
   on flood (clunky).
10. **Phone** — the table sentence 1,650px down (above); map nodes too small to tap (repeat 09-27 #9);
    Cards-page reasons truncated at 390 ("When a Wizard enters thank…") behind a small "⋯".
11. **Site pages** — Sarevok's commander page says "SUGGESTED THEME none: what it does, every deck
    does anyway" and then draws a life-loss map, and reads the card as "makes each opponent lose
    life" where it prints "each player's end step … that player loses X life" (plan-seeker, phone);
    the precon index has no search and the seat could not find Party Time in it (precon); the precon
    page leads with work-together swaps where the report leads with draw, so "what first" has two
    answers (precon); Sol Ring's page answers "it counts toward your Ramp total" and sends the reader
    to paste a deck (plan-seeker, phone).
12. **Combo readout** — the combo list says what repeats ("Infinite creature ETB · …"), never which
    card turns the loop into a kill (plan-seeker); two combo steps read word for word the same ("When
    Dualcaster Mage enters thanks to Essence Flux, it copies a spell", plan-seeker).

## Design review (ui-designer), ranked must-fixes

1. **Commander page** at 1920+: everything stops at ~1070px (54% / 40% / 27% used); at 3840 the map
   starts at the fold. Two columns from 1920, map beside "Pair with".
2. **Card page** at 1920+: one prose column (36% / 27% / 18% for "What it does in a deck").
   Image | prose | "How we read this card", and a related-cards grid.
3. **Cards table** at 2560+: rows stretch the viewport with ~1,500 / ~2,600px between the reason and
   the score. Two tables side by side from 2560, three at 3840; reserve the thumbnail slot.
4. **Combos page** from 1920: one text line per combo, content ends at 40% / 30% / 20%. Reuse the
   Scores loop tiles in an auto-fill grid.
5. **Precon page** at 2560+: swap rows span the viewport; the hero map did not draw at 3840.
6. **How to improve it**: a lone suggestion leaves the right half blank (Rani at 1920); "OPENS A
   ROUTE" alone at the left at 3840.
7. **axe**: the "commander" label in the Turn 3 tile fails contrast on the tinted fill.

Should fix: the loading skeleton reserves no rail, so the chapter column shifts when the report
lands; Build has no sub-bars to mirror Synergy's; at 2560 the 16:9 map pushes "Say this at the
table" below the fold; one-theme decks get one column of four; the "its first turns, and how it
wins" kicker; the rail's "Wins by attacking with a wide board" breaks its value to "8 / cards";
card and commander search grids stop at 12 columns at 3840; the home form at 3840.

Fine as is: the rail at every width (the header over it, the card view, the 3840 widening), Roles
and Manabase, the precon index (4 columns at 1920, 9 at 3840).

## Engine claims (quarantined until checked; for the engine session)

Checked against the cards' printed text, wrong:
- **E1 Mari's exile, reworded** (pod-fit): "When a creature dies thanks to Go for the Throat, Mari,
  the Killing Quill exiles a creature an opponent controls". Mari: "Whenever a creature an opponent
  controls dies, exile it with a hit counter on it" -- the dying creature, not another. Repeated for
  about a dozen removal spells, and it is what makes Mari a 5.0 card.
- **E2 Nalia attacks** (precon; repeat of 09-27 E2, still live): "When Nalia de'Arnise attacks,
  Frontline Medic grants a keyword". Nalia makes nothing attack.
- **E3 Revel in Riches paired with itself** (pod-fit): "Treasure (token from Revel in Riches) counts
  toward the 10 or more Treasure (token from Revel in Riches)s Revel in Riches needs", scored 5.0 and
  tagged key card. Self-pair, and a broken plural.
- **E4 Sarevok's reading** (plan-seeker, phone): "TRIGGERED makes each opponent lose life equal to
  Sarevok's power" under "At the beginning of each player's end step, if no permanents left the
  battlefield this turn, that player loses X life".
- **The plant family** (above): four "puts cards into the graveyard that Tinybones … can bring back".

Plausible, not verified: "When Krenko, Mob Boss enters, Impact Tremors deals 1 damage" (the home page
says "When a creature enters thanks to Krenko"; the tokens are the synergy, Krenko enters once);
Asinine Antics linked to none of the enchantress payoffs (repeat); "comes down on turn 5 in half your
games" beside "61% by T5" for Inalla, and a three-colour 5-drop castable more often than a
mono-black one.

Refuted: "12 exile" for creature answers including Doom Blade (Mari's clause exiles what they kill;
the 09-27 E1 fix counts it); the phone sheet and blank Combos pages (capture, above).

## Unique findings per seat

first-cuts 3 (7 cuts for 8 over, adds on an oversized list, Piledriver cut against its own keep
line), precon 3 (party never explained, no search on the precon index, precon page vs report on what
first), clunky 3 (the rail's back label, "30 /37" vs 38, flood and the two-lander), plan-seeker 3
(no kill in the combo readout, identical combo steps, Sarevok's reading), pod-fit 2 (Mari exile
sentence, Revel self-pair), phone 2 (table sentence depth, truncated Cards reasons). Every seat pays
its rent.
