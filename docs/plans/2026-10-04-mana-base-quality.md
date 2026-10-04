# Mana base quality: what is measured today, what is not, and the tasks (2026-10-04)

The owner, 2026-10-04: "one more thing you can prepare, mana base quality evaluation." The owner's
earlier framing (2026-09-29, recorded in `mana-base.ts`): "find the golden centre between: do not
skip a land a turn, mana requirements, and mana flood", and "account for colour requirements, so we
can build one mana base quality evaluator formula".

That formula exists (`manaBaseScore`). This file says what it and its neighbours measure, where
they disagree with each other, what none of them read, and what to build so the one number is
reproducible, validated, and tells a player which land to change first. Written for a Claude Code
session; every claim names the file it was read from.

## What exists, and where each number surfaces

| piece | file | what it reads | shown as |
|---|---|---|---|
| land target | `mana-base.ts` `landTarget`, `land-count.ts` `recommendedLands` | curve, commander, ramp by resilience, draw credit by mana value, role targets | "Lands 36, wants 38" tile; the Lands dial (`LAND_BAND` 3) |
| mana base score | `mana-base.ts` `manaBaseScore` | count against target (quadratic), colour misses (0.133 each), always-tapped lands (0.025 each) | one sentence in `BuildBenchmarks.tsx`: "loses about 0.6 of a turn over 10"; the precon keeper's H5 |
| colour audit | `mana-audit.ts` `manaAudit` | Karsten thresholds with the free mulligan, sources available by the demand's turn | "Weakest colour 30/37" tile; colour findings |
| opening hands | `land-math.ts` `landHandProbabilities` | raw hypergeometric, no mulligan | "Opening hands 76% have 2 to 4 lands" tile; the bar chart |
| mana by turn, castability | `goldfish.ts` `manaModel` (2,000 trials, two policies) | a played-out board with colours, fetches, conditional lands, rocks | "Mana" and "Hardest cast" tiles, as intervals |
| land facts and swaps | `land-score.ts` `landFacts`, `betterLand`; `upgrade-sections.ts` `landOptions` | needed colours made, tapped 0/1/2, utility, hurts | the precon page's Lands section; the keeper |
| conditional lands | `land-conditions.ts` `classifyLand` | eleven templates | read by the audit, the goldfish, the score, the facts |

## Findings

### F1. Two colour models on one screen, and they count different sources

The tile and the finding read `manaAudit`, which counts a land-fetch spell (Cultivate) as a
source, a rock from the turn after its mana value, and a conditional land by the optimistic board
of that turn. The score reads `colourSources`, which counts lands, fetchlands by what they find,
and nonland permanents with a plain `{T}: Add` line, and nothing else: Cultivate, Farseek and
Rampant Growth are sources to the tile and not to the score, and a rock is a source on turn 1 to
the score and not to the tile. The score's comment says it was fitted on exactly this count, so the
two cannot simply be unified without refitting (F3).

### F2. Conditional lands are free in the score

`tappedLandCount` counts a land only when it always enters tapped (or is unclassified, or a fetch
that fetches tapped). A check, slow, fast, battle, reveal or pod land costs nothing. The fit's own
note says the tapped coefficient explains 48% of what the goldfish measured because "a tapped land
costs most when it arrives early, which a count cannot see". A slow land is tapped on exactly the
turns that matter; a check land in a three-colour deck with eight basics is tapped often. The
goldfish and the audit both price this by turn; the score does not.

### F3. The fit is outside the repository

`mana-base.ts`: "The script is research-only and lives outside the repo." `LAND_FORMULA`,
`RAMP_RESILIENCE`, `DRAW_CREDIT_BY_MANA_VALUE`, `MANA_BASE_COST`, `SIMULATED_MIN/MAX_LANDS` are
constants with no command that reproduces them. `research/matcher/land-formulas.ts` is a different
script (five published formulas against the 71 decks). Any change to the goldfish's draw model,
the role targets or the deck population silently invalidates every constant, and `docs/README.md`'s
own rule is "every number carries where it came from, the command that produced it, and the date".

### F4. The one number is shown and never validated

The score ships as a sentence in the Lands block and as the keeper's gate. There is no ground
truth for it: no hand-judged set of mana bases, no pairwise panel like the synergy one, and the
only invariant test is one case in `mana-base.test.ts` (short costs more than long, a perfect base
reads 0). The 2026-09-29 persona round recorded four seats unable to decode "0.6 turns in every 10".
The 268-deck distribution (median 0.76, p90 1.37) is in a comment, not on the page, so a reader has
no scale.

### F5. The opening-hand tile ignores the mulligan model the repo already has

`mulligan.ts` prices the free Commander mulligan in closed form and was verified against a
400,000-trial simulation. `ManaGlance` and `LandMathChart` use `landHandProbabilities`, "no
mulligan modelling, plain opening-hand odds". The tile reads "2 to 4 lands", the chart "three or
more", neither reads colours, and the land-count headline next to them was fitted on a goldfish
that mulligans.

### F6. What no part reads

- Conditional production: `producedMana` lists what a card can add, so a filter land (Mystic Gate),
  a Tournament Grounds ("spend this mana only to cast a Knight or Equipment spell"), an Exotic
  Orchard and a Cavern of Souls count as full sources of every colour they name, in the score and
  in the audit. `landFacts` refuses them for swaps (`conditional-mana`), so the swap code and the
  score disagree about the same land.
- A karoo is one land in the count and two mana on the board; a Treasure, a ritual and a Lotus
  Petal are not sources anywhere (correct), and the land target credits them at 0.15.
- Colour needs over time: `colourMiss` asks each card for its colours by its own mana value and
  multiplies colours as independent. A deck whose double-pip cards all sit at one colour and one
  turn is read the same as one whose pips are spread.
- The commander's colours are included in `colourMiss` but a commander deck's colour pressure is
  mostly the commander cast on curve, every game; nothing weights it above a 1-of.

### F7. Land swaps let a restricted land through, and offer Reserved List duals at every bracket

From the 197 deployed precon pages (3,039 land swap rows, 320 distinct):

- "Battlefield Forge -> Tournament Grounds: never enters tapped and makes white, black or red" (27
  precons). Tournament Grounds' mana is restricted. `landFacts` flags `conditional-mana` only
  from the mana line's own yield or an "activate only" on it; the restriction is the next sentence
  ("Spend this mana only to cast a Knight or Equipment spell."), which `MANA_LINE` never reads, and
  `PLAIN` lists that tail as a land's ordinary business, so nothing marks the land unusual.
- Plateau, Bayou, Badlands, Scrubland, Savannah, Underground Sea, Tundra are the top adds for every
  karoo and check land, at bracket 2 as at bracket 4. Price is ruled out of packages (owner,
  2026-09-28); the precon seat the page is built for has fifty dollars
  (`docs/player-questions.md`, problem 2). A question for the owner, not a defect.
- A karoo (Azorius Chancery, 55 precons) is cut for "enters tapped" into a shock. The karoo taps for
  two; the swap lowers the deck's mana without the count or the score seeing it.

### F8. The order on the page is the opposite of the fit

The fit found colours cost 0.62 lost turns on average, tapped lands 0.19, the land count 0.08. The
Lands block sorts the parts dearest first (good); `ManaGlance` leads with the land count tile, the
Lands dial is the one mana measure in the build score, and the land count is the finding kind the
findings module ranks. The number the report leads with is the smallest lever on most decks.

## What to build

One mana base quality evaluation: reproducible constants, one source model, time-aware tapped
cost, a validated scale, and a per-land attribution that says which land to change first. In order.

### M1. The fit, in the repository

- `research/matcher/mana-base-fit.ts`: the sweep `mana-base.ts` describes (197 precons + 71
  calibration decks, land counts 28 to 48, the three rebuilt mana bases, the ramp and draw swaps),
  at a stated trial count, printing `LAND_FORMULA`, `RAMP_RESILIENCE`'s measured counterparts,
  `DRAW_CREDIT_BY_MANA_VALUE`, `MANA_BASE_COST`, and the R² of each part against the goldfish's lost
  turns. Output to `docs/measurements/mana-base/<date>.json` with the command and the git commit.
- A test that the constants in `mana-base.ts` equal the latest recorded output, so a change to the
  goldfish that moves them fails CI until the fit is re-run and the file re-recorded.
- First run: reproduce the recorded figures (0.065 extra lost turns, R² 0.70 colour, 0.48 tapped)
  before anything else moves. If they do not reproduce, that is the first finding.

### M2. One source model, with a turn

- `sourcesByTurn(deck, commanderNames)` in `mana-audit.ts`: for each colour and each turn 1..10,
  the sources that could be producing by then, one rule set: lands by `classifyLand` on the
  optimistic board; fetchlands by what they find, capped at what is there to find; a land-fetch
  spell and a rock from the turn after its mana value; a nonland permanent only with a plain `{T}:
  Add`; conditional production (`conditional-mana` as `landFacts` reads it) counted for no colour.
- `manaAudit`'s `available` and the score's `colourSources` both read it; `colourMiss` reads the
  turn-indexed count. The coefficient is refitted by M1.
- Measure: the colour part's R² before and after; the number of decks where the tile and the
  score disagree about whether a colour is short, before and after (target 0).

### M3. Tapped turns, not tapped lands

- `tappedTurns(deck)`: for each land, the probability it enters tapped, over the turn it is likely
  to be played (`seen(turn)` from the library), by its template: unconditional 1; slow, tapped when
  played as the first or second land; fast, tapped from the fourth; check, by the chance a named
  basic type is on the board from the deck's own type counts; bfz, by the chance of two basics;
  reveal, by the chance of the named type in hand; pod 0; shock and pay-life 0; unclassified 1.
  Closed form, no simulation.
- The score's tapped part reads it; M1 refits the coefficient. Target: R² 0.48 -> 0.7 or better.
  Record it either way.

### M4. Which land to change: per-land attribution

- `landCosts(deck)`: for each land, `manaBaseScore(deck)` minus the score with that land replaced by
  an untapped land of every needed colour. The difference is what the land costs in lost turns.
  Ranked, it answers "which land first" on the report and orders the precon page's Lands section by
  cost rather than by "every karoo first".
- Fix `landFacts`: check the mana line's restriction before reading its colours, so a Tournament
  Grounds is `conditional-mana` and never offered (F7). Add the test.
- A karoo's swap states what the deck loses: the reason names "taps for two" and the swap is
  offered only when the land count stays at or above target with the karoo counted as 1.5.
- Measure: re-run the land census (`static-out/land-census.mjs`, procedure below) and report the
  top adds before and after.

### M5. A scale, and a panel

- Metamorphic invariants as tests (no ground truth needed): replacing an always-tapped dual with an
  untapped dual of the same colours never raises the score; adding a basic of a colour no card asks
  for never lowers the colour part; a mono-colour deck of basics has colour cost near 0; a
  five-colour deck of basics costs more than the same deck on Command Towers; cutting the deck's
  only source of a colour a card needs raises the score.
- A pairwise panel, the shape the synergy panel already has: 40 pairs of real mana bases, same
  colour identity, the owner (or two readers) says which is better. The score must order at least
  85% of judged pairs. Record in `docs/measurements/mana-base/panel.json`; a ratchet test holds it.
- On the page: the parts dearest first with the three lands that cost most (M4), and the number
  placed on the 268-deck scale from M1 ("better than 7 in 10 decks") instead of "0.6 of a turn".

### M6. Opening hands with the mulligan, and colours

- The Opening hands tile and chart read `mulligan.ts`'s keep policy (keep 2 to 4 lands, one free
  mulligan, then a six), the same model the land target was fitted under.
- A second line, from the same closed form over `sourcesByTurn`: the chance a kept hand can cast
  the deck's turn-1 and turn-2 plays on colour. Reported, not scored, until M5's panel says it adds
  information.

### M7. Lead with what costs most

- `ManaGlance` orders its tiles by the score's parts: the dearest part's tile first. The findings
  module gets a `manaBase` finding kind whose figure is the part's lost turns, ranked with the rest
  by what fixing it is worth (the same unit the build findings use, so it needs M1's scale).

### Questions for the owner

1. Price in land swaps: keep the 2026-09-28 ruling (ignored), or cap a land add by the precon
   seat's budget at bracket 2, or show the cheapest of the strictly better lands first?
2. The Battlebond lands (untapped only with two or more opponents) are offered as "never enters
   tapped": right for a four-player pod, wrong for a duel. Say "in a pod of three or more"?
3. Should the one number be lost turns per ten (the fitted unit) or a 0-100 scale on the 268-deck
   distribution? The page needs one.

## What must not move

- The land target itself, until M1 reproduces the recorded fit; then only with the fit re-run.
- The goldfish and its intervals: nothing here changes the simulation.
- `LAND_BAND`: the dial's resolution is the fit's, ±3.
- The precon package's bring-down cuts and the bracket guard.

## How this was measured

- The code was read at `dd7ef77`; file and function names as above.
- The land swap census: a forty-line Node script (kept outside the repo, under the gitignored
  `static-out/`; worth re-creating under `research/web/` if it is to be re-run) that fetches
  `manifest.json`, `precons/index.json` and every precon page from `https://edhseer.cards/static`,
  and prints every swap of kind `land` with both reasons, counted by precon.
  Run 2026-10-04 against `v-6d84f2f6655a`: 197 precons, 178 with land swaps, 3,039 rows, 320
  distinct pairs.
