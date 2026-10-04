# Interaction demand: what the engine counts, what it cannot see, and the tasks (2026-10-04)

The owner, 2026-10-04: "do a similar analysis for other engines, especially the interaction
demand, cause I feel it needs some love and was neglected."

It was. Every other role (ramp, draw, burn, stax) reads derived tags; the whole interaction layer
is still oracle-text regex from August, the answer classes cannot see a board wipe, a counterspell
or a protection spell, and the demand side is a theme median from ten EDHREC decks blended with
the type mix of 33 Game Changers. Nothing in it reads the deck's bracket, its plan, or the pod.
Written for a Claude Code session; every claim names the file it was read from and the run that
measured it.

## What exists, and where each number surfaces

| piece | file | what it reads | shown as |
|---|---|---|---|
| Interaction count and target | `build.ts` `BUILD_PARENTS` (leaves targetedRemoval, stackInteraction, graveyardHate, protection), `templateBlend`, `template-targets.json` | four regex rules; the theme's EDHREC median or the population's 13 | "You are 4 short on interaction" finding; the Interaction dial; the precon page's gaps and role sections |
| answer coverage | `answer-coverage.ts` | the five permanent classes a deck answers at all, weighted by the Game Changer type mix (blended with graveyard-hate share) and the colour pool | the Interaction attainment multiplier; "docked for coverage: 3 of 5 classes" |
| answers by class | `deck-math.ts` `answers`, `build.ts` `detectAnswerClasses`, ten `answers.*` rules | which cards answer creature, artifact, enchantment, planeswalker, land, graveyard; exile and recurring marks; P(one in hand by the clock turn); copies required for 50% | "Can you deal with theirs": the six-row table; the "no answer at all for X" finding |
| self demand | `availability.ts` `deckAvailability` | what the deck's own triggers wait for | "What they care about, and what causes it" |
| answer quality | `quality.ts` `ingredients` for the answer roles | timing, breadth, permanence, drawback | swaps only; never the count or the coverage |

## What was measured

Three runs on 2026-10-04 against the deployed corpus `v-6d84f2f6655a`, through
`analyzeDeckStatic` (the report the site computes), over the 197 precons and the 71 calibration
decks: the Interaction count against its target, the coverage rows, the six answer rows, every
card's roles, and which interaction cards carry no answer class. Plus a probe of 140 named cards
through `detectBuildCategories` and `detectAnswerClasses` (list at the bottom).

| | precons (197) | calibration (71) |
|---|---|---|
| Interaction count, median | 10 | 14 |
| target, median (range) | 13 (10 to 20) | 13 (9 to 20) |
| decks short of target | 154 (78%) | 27 (38%) |
| target from a theme row / the population | 68 / 129 | 32 / 39 |
| coverage below 1 | 57 | 19 |
| ...of which hold a board wipe | 57 | 14 |
| coverage weight lost, by class (sum) | land 5.51, planeswalker 0.27, artifact 0.17, enchantment 0.05 | land 1.11, artifact 0.79, enchantment 0.55 |
| interaction cards with no answer class, median share | 29% (max 70%) | 35% (max 73%) |
| board wipes with no answer class | 663 of 678 (98%) | 139 of 140 (99%) |
| "no answer at all for X" finding fires | 17 | 14 |
| copies "required" per class, median | 5 | 5 |
| clock turn, median | 7 | 8 |

## Findings

### F1. The layer never moved to derived tags

`rules.json`: all eight interaction rules (`removal.targeted`, `removal.land`, `removal.neutralise`,
`stackInteraction.text`, `protection.text`, `protection.flicker`, `graveyardHate`, `boardWipe.text`)
and all ten `answers.*` rules match `oracle` patterns. Ramp, draw, burn and stax rules read
`effectKind` and `emits`. Derive already writes what these regexes approximate: `dies`, `exiled`,
`leaves` and `sacrifice` emits with whose permanent and in which zone, `counter-spell` with the
spell filter and its `unless` payment, `gain-control`, `keyword-grant` with (after the grammar
review's T3) the keywords and the recipient, scope `all`/`each`/`target`, and the subject's types
as a conjunction. The three `removal.*` tag rules that exist are facets, not the count.

### F2. A board wipe answers nothing

`answers.typed` needs the word "target". "Destroy all creatures" has none, so Wrath of God,
Damnation, Supreme Verdict, Toxic Deluge, Blasphemous Act, Farewell, Austere Command and
Merciless Eviction set no `covered` bit and appear in no row of "Can you deal with theirs". The
rule's own comment says it "deliberately does not exclude board wipes, because a wipe does answer
creatures". Measured: 98% of precon wipes carry no class, and every one of the 57 precons docked
for coverage holds a wipe. Cyclonic Rift is the exception, through its "target" mode.

### F3. Counterspells and protection are coverage-blind by design, and it is a third of the count

`build.ts:378` records the seam and the decision not to fix it: the Interaction count is the union
of four leaves, the coverage multiplier can only be lifted by permanent classes, so a counterspell
or a protection spell can max the count and never the multiplier. Measured today: the median deck
has 29% (precons) or 35% (calibration) of its interaction cards in that state; Arcane Denial,
An Offer You Can't Refuse, Deflecting Swat, Swan Song, Fierce Guardianship, Lightning Greaves,
Swiftfoot Boots and Heroic Intervention head the list. A control deck's best cards count as
breadth-less.

### F4. Whole kinds of interaction are not interaction

From the 140-card probe (`[]` = no role, `-` = no answer class):

- edicts: Fleshbag Marauder, Grave Pact, Dictate of Erebos `[]`, `-`
- theft: Control Magic, Treachery, Gilded Drake, Sower of Temptation `[]`; Agent of Treachery `[draw]`
- static answers and hate-bears: Torpor Orb, Null Rod, Cursed Totem, Containment Priest, Linvala,
  Drannith Magistrate, Opposition Agent, Aven Mindcensor, Collector Ouphe, Dauthi Voidwalker,
  Pithing Needle, Sorcerous Spyglass, Blood Moon, Humility `[]`; Grafdigger's Cage, Thalia,
  Winter Orb `[stax]`, reported never counted
- neutralising that is not an Aura's "loses all abilities": Oko, Thief of Crowns `[]`; Song of the
  Dryads `[]` (the pattern misses "Forest land")
- tuck wipes: Terminus, Hallowed Burial `[]`
- stack protection: Silence, Grand Abolisher `[]`; Teferi, Time Raveler `[draw]`
- "exile any number of target spells" (Mindbreak Trap) `[]`: the stack pattern wants "target"
  right after the verb
- Narset's Reversal, Deflecting Palm, Comeuppance `[]`

### F5. False positives

- Self-protection that is not a printed keyword: Paradise Druid ("hexproof as long as it's
  untapped"), Fleecemane Lion (monstrous), Shimmer Dragon, Yahenni, Jareth, Anya all count as
  `protection` (4x, 4x, 4x, 4x, 3x, 3x across the precons). `protectionIsOwnKeyword` reads only the
  keyword list.
- Removal read as protection: Darksteel Mutation (8 precons), Oubliette. The neutralise pattern
  wants "loses all abilities" and Mutation prints "loses all other abilities".
- Own-creature bounce read as removal: Riptide Laboratory (4 calibration decks), through
  `bounceRemoval`.
- Imprisoned in the Moon reads `[ramp, targetedRemoval]`: the land it makes taps for {C}.

### F6. The demand is not a model of what the deck will face

- The target is `template-targets.json`'s theme row, from 6 to 10 EDHREC decks per theme (median
  n 10), range 7 (books) to 25.5 (phasing), or the population's 13. It describes what decks of that
  theme happened to run.
- The coverage demand is `ANSWER_BASELINE`: the type mix of the 33 Game Changer permanents (land
  7 of 33), blended toward the graveyard-hate share by archetype confidence.
- Nothing reads the deck's bracket (`answer-coverage.ts` names Game Changers only in a comment;
  `build.ts`, `deck-math.ts`, `availability.ts` read no band), the pod, the deck's own plan (a
  combo deck wants stack interaction and protection for the combo; a voltron deck wants protection;
  a go-wide deck wants wipe insurance and fewer wipes of its own), or when a threat arrives.
- Consequence: 78% of precons are told they are short on interaction against a median target of 13,
  as are 38% of the owner's own decks, with the same sentence whatever they hold.

### F7. The score and the finding disagree about lands

`REQUIRED_CONFIDENCE` asks 5 copies per class for a 50% chance by the clock; the owner ruled on
2026-09-26 that no deck can provide five of each, and `answerFinding` was narrowed to absent
classes with lands and graveyards left out "because most Commander decks run no land removal on
purpose". The coverage multiplier still charges land at 7/33 of the demand: on the precons, land is
92% of all coverage weight lost. The table still prints per-class odds against the five.

### F8. An answer's quality is never read into the count

Nix (counters a free spell), Winnow (needs two permanents of one name), Spell Stutter, a sorcery
against an instant, a symmetric wipe against a one-sided one, a 6-mana answer against a 1-mana one:
all count 1. `ingredients` (`quality.ts`) has timing, breadth, permanence and drawback for exactly
these roles, and only the swap code reads them.

### F9. Three readouts for one fact

Persona round 2026-10-02, finding 11: "3 of 5 answer classes are covered", "3/4 kinds of permanent
you can answer", and a six-row table, on one page.

## What to build: an interaction demand model

Supply read from the typed abilities; demand read from the bracket, the plan and the clock; one
unit on both sides; one readout.

**Supply.** For each card, from its derived abilities (and the grammar's typed readings as the
grammar review's T3 lands), an `answers` record:

| field | from | examples |
|---|---|---|
| kind | the verb and its subject | destroy, exile, bounce, tuck, neutralise, edict, steal, counter, shut-off, protect, wipe |
| what | the subject filter: types as a conjunction, control, scope, zone | "target artifact creature an opponent controls"; "all creatures"; "noncreature spell" |
| speed | timing (instant, flash, activated, sorcery, triggered) | |
| conditions | the reading's condition or unless-payment | "unless its controller pays {1}", "if no mana was spent" |
| one-sided | the subject's control | Cyclonic Rift yes, Wrath no |
| cost | mana, alternative cost | |

A board wipe is a creature answer at scope all. A counterspell answers "a spell", narrowed by its
filter. A protection spell answers "removal aimed at your board", with what it protects. An edict
answers "a creature", not targeted. A static shut-off answers the class it shuts off. The regex
rules stay only as the fallback for a card derive has not read, and a card read by neither joins
no count (a refusal, as everywhere else).

**Demand.** What this deck will face and when, from three readings:

1. **The bracket's threat mix**, measured: over the EDHREC population and the precons, per
   bracket band, the share of permanents by class, the share of games decided by a combo (stack or
   graveyard), and the median turn each class first lands. Replaces `ANSWER_BASELINE`'s 33 cards.
2. **The deck's own plan**: what beats it. A combo plan needs stack interaction and protection for
   the pieces; a voltron plan needs protection; a go-wide plan needs insurance against wipes and
   fewer wipes of its own; a graveyard plan already shifts demand to hate (`graveyardVulnerability`
   stays). Read from the archetype ranking the report already has.
3. **The clock**: the deadline per threat kind is the turn that kind arrives in the bracket, not
   one turn for all six classes.

**The count.** `Interaction` becomes a demand-weighted sum: each threat kind has a demand weight
and a deadline; each card counts toward every kind it answers, at its quality (speed, condition,
one-sidedness, breadth) and its availability by the deadline. The multiplier goes; a wipe, a
counterspell and a Greaves count where they answer. The target becomes "enough of each kind the
bracket and the plan say you will face", with the theme row kept as a prior on the total.

**The readout.** One block: per threat kind, what you have, how often one is in hand by the turn
it matters, and the gap. "You are N short on interaction" becomes "you have no way to stop a
spell" or "nothing answers an artifact before turn 5". The three coverage phrasings collapse into
it.

### Tasks, in order

Each one PR, measured on the 71 calibration decks and the 197 precons; H1 (every test, no ratchet
loosened) and the panel hold throughout.

1. **Label the set.** The 140 probed cards plus the 60 most frequent interaction cards across the
   two censuses, each labelled by hand with the kinds it answers and whether it is interaction at
   all, in `packages/matcher/src/interaction.labels.json`. The gate for everything after: the
   classifier's precision and recall against the labels, per kind, reported in every PR.
2. **Supply from tags.** `answersOf(card)` in a new `interaction.ts`, built on the derived
   abilities as the supply table says; `detectAnswerClasses` and the four leaf rules read it, the
   regexes stay as the fallback and are counted as such. Fixes F2, F4 and F5 in one place. Measure:
   precision and recall on the labelled set before (regex) and after; the share of interaction cards
   with no kind, before and after.
3. **Wipes and counterspells answer.** With T2 in, drop the seam at `build.ts:378`: the
   multiplier is replaced by the demand-weighted count. Report the 71 decks' Interaction attainment
   before and after, and name every deck that moves by more than 0.1.
4. **Demand from the bracket.** The per-band threat mix and arrival turns, measured by a script in
   `research/matcher/threat-mix.ts` over the EDHREC population and the precons, recorded in
   `docs/measurements/interaction/<date>.json` with the command. `ANSWER_BASELINE` reads it by the
   deck's band. Owner ruling needed first on question 2 below.
5. **Demand from the plan and the clock.** Per-kind deadlines; the plan's shifts (combo, voltron,
   go-wide) as measured deltas against the band's mix, the way `graveyardVulnerability` already
   shifts toward hate. Each delta is a number with a measurement behind it, never a hand-written
   guess (the 2026-09-06 ruling that retired the archetype deltas).
6. **Quality in the count.** Each card's weight toward a kind from `ingredients`: speed, condition,
   one-sidedness, breadth. Nix and Counterspell stop reading the same.
7. **One readout.** Replace the Interaction finding, the coverage note and the six-row table with
   the per-kind block; the precon page's gaps row reads it too. Re-run the persona round's pod-fit
   seat on it.

### Questions for the owner

1. Do counterspells and protection count toward "interaction" the way removal does, or are they a
   second count ("can you stop theirs" and "can you protect yours")? Today they are counted and
   never weighed.
2. Should the demand follow the bracket the deck reads at (a bracket 2 deck is asked for bracket 2
   threats), the bracket the owner says the pod plays, or both with the pod's as the default?
3. Discard (Thoughtseize), theft (Control Magic) and static shut-offs (Torpor Orb): interaction,
   stax, or both? Today the first two are nothing and the third is stax.

### What must not move

- The panel precision and retention, compass, anti: this layer feeds no edge.
- The bracket itself (`brackets.ts`): the band is an input here, never an output.
- `BUILD_PARENTS`' other three parents and the land dial.
- The theme rows stay as the prior on the total until T4 and T5 have numbers.

## How this was measured

Three scripts kept outside the repo under the gitignored `static-out/` (worth re-creating under
`research/matcher/` to re-run after each task):

- `interaction-census.mts <precons|calibration>`: for each deck, `analyzeDeckStatic` against
  `https://edhseer.cards/static` with an on-disk shard cache and a 12-connection cap; records the
  Interaction parent, `template`, `answerCoverage`, `deckMath.answers`, the clock turn and band.
- `interaction-roles.mts <precons|calibration>`: the same report, reading each card's `roles` and
  which answer rows name it; writes per-deck leaf membership and the coverage-blind list.
- `classify-cards.mts <names file>`: fetches each card's shard by `shardOf`, builds a `DeckCard`
  from the shard entry, and prints `detectBuildCategories` and `detectAnswerClasses` for it. The
  140 names probed are the ones listed under F4 and F5 plus the common staples of each kind
  (Swords, Path, Counterspell, Force of Will, Heroic Intervention, Teferi's Protection, Bojuka Bog,
  Rest in Peace, Strip Mine, Vandalblast, Austere Command, and so on).

The calibration decks are `packages/cli/decks/calibration/*.txt` (71 analysed; two files in the
directory are not decks). Precons are `packages/data/precons.json` through `preconDecklist`.
