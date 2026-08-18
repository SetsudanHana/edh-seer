# What this engine computes — a standing inventory

Written 2026-08-18 from a full read of the code, not from memory. Every claim carries `file:line`.
Companion to `ROADMAP.md` (what is open) and `superpowers/specs/` (why each piece is shaped as it is).
This document is descriptive: it states what exists today and what it costs, not what should change.

---

## 0. The shape of the whole thing

```
oracle text ──LLM, once, offline──▶ cardClauses ──derive, free──▶ cardTagsDerived
                                                                        │
                                            implied events (matcher-only, free)
                                                                        ▼
                        pairwise matching ──▶ EDGES + REASONS  ← the claim layer
                                                    │
                          ┌─────────────────────────┼───────────────────────────┐
                          ▼                         ▼                           ▼
                  per-card RATINGS           deck THEMES/AXIS              the GRAPH
                  (synergy scoring)          (what the deck is about)   (projection + UI)
                          │
                          └──── independent of all of it: DECK MATH (probability layer)
```

The only paid step is normalization (one LLM call per card, ~$8.50 for the corpus). Everything
downstream is deterministic and free to re-run. Three artifacts, three costs:
`cardClauses` = MONEY · `cardTagsDerived` = free re-derive · edges/reasons = pure functions.

**Two engines exist; only one is live.** The flat engine (`packages/engine/src/analyze.ts:278`,
`score = reasons.length`) survives on the CLI's `deck.json` path and `bin/compare.ts` only. The
structured engine (`packages/matcher/src/analyze.ts:127`) is what the web server and the CLI's
decklist path run. Everything below describes the structured engine unless marked otherwise.

---

## 1. Layer 1 — the claim layer (edges and reasons)

**A claim is a sentence about two cards**: "X triggers on a creature dying; Y supplies it."
It is produced by matching one card's *events* against another card's *triggers*, and it is the
only thing in the engine a human can check against printed text.

### How a claim forms

`directedReasons(p, c)` (`edges.ts:473`) runs **seven passes** in one direction; `pairReasons`
(`edges.ts:941`) unions both directions plus meld.

| # | pass | tag shape | file:line |
|---|---|---|---|
| 1 | event edges (trigger ⟷ emit) | `enters:x`, `dies:x`, `cast:x`, … | `edges.ts:483` |
| 2 | reanimator (graveyard fill → recursion) | `graveyard-recursion:x` | `edges.ts:556` |
| 3 | graveyard scaling (a payoff that only gets bigger) | `scales:x` | `edges.ts:612` |
| 4 | wincon threshold | `wincon:x` | `edges.ts:655` |
| 5 | static / clone | `static:kind` | `edges.ts:684` |
| 6 | tutor / ramp-target | `tutor:x`, `ramp-target:x` | `edges.ts:742` |
| 7 | counter presence | `counter-added:x` | `edges.ts:822` |

Plus `createsReasons` (`edges.ts:919`) for a token maker → its token, joined on **printing id**,
never on name (`analyze.ts:171-177`).

`subjectMatches` (`subject.ts:11`) compares 18 `SubjectFilter` fields — type, subtype, colors,
control, zone, counter kind, keyword / notKeyword, legendary, basic, historic, commander, named,
token, stats, and an `anyOf` disjunction. **An unset consumer field is a wildcard**; that asymmetry
is where most historical false claims came from.

### What refuses a claim, and why (the expensive knowledge)

About twenty named gates. The load-bearing ones, each with its measured reason:

| gate | refuses | measured cost of not having it |
|---|---|---|
| `selfEtbSelfSupplied` `edges.ts:229` | every permanent supplying every "when this enters" | **74% of all false edges** |
| `castSelfSupplied` `edges.ts:272` | implied cast × unnarrowed "whenever you cast a spell" | disabling costs **6.3 precision points**; 27 of 33 `generic` panel falses |
| `combatSelfSupplied` `edges.ts:197` | every creature supplying every combat trigger | a multi-million-edge mesh |
| `ROLE_NOT_SYNERGY` `edges.ts:225` | cost-reduction, tax, win-game, extra-turn, extra-phase | recovering cost reducers alone: +3,600 edges, mesh 411 → 2,408 |
| token-mediation suppression `edges.ts:509` | the direct maker → payoff shortcut | −401 edges; the fact is stated once, via the token |
| `createsForYou` `edges.ts:911` | crediting a token the **opponent** gets (Beast Within) | lifted two cards 0 → 2.0 wrongly |
| tutor / ramp `control` gates `edges.ts:775` | "Path to Exile ramps *you*" | a wrong sentence, not a weak one |

**Design rule visible everywhere: a silent wrong answer is worse than a missing one.** Unknown
trigger events surface in `unknownTriggers` rather than picking a near miss; the persist gate
refuses a card rather than banking a guess; `available: null` in the deck-math layer means "cannot
say", never 0.

### What a claim carries

`Reason` (`engine/src/synergy.ts:5-42`): `tag`, `text`, `effectKind`, `repeatability`, `scaling`,
`hasStatPredicate`, `producer`, `consumer`, `producerIsToken`, `consumerIsToken`, `impliedProducer`.

Edge score is **`claimCount`** — distinct `(tag, text)` pairs (`edges.ts:446`), not `reasons.length`:
one trigger with a six-effect chain (Archon of Cruelty) is **one claim**, not six. 22.8% of all
reasons sit in a duplicate group; fixing this reordered the top-ten edge list in 63 of 71 decks.
The reason objects are deliberately **not** collapsed, because `effectKind` is load-bearing for
archetype detection.

### Tokens are first-class nodes

A token gets its own node (`token:` prefix, `graph-projection.ts:65`) because 92 of 661 distinct
token names collide with a real card. A maker edges to the token; the token edges to the payoff.
The ratings pass walks both hops and **merges the token's reasons into the card pair** so a maker
with four token types scores one `enters:any`, not four (`analyze.ts:303-306`).

### Measured state of this layer (2026-08-18, re-run today)

- **32,182 edges · 40,563 reasons · MESHED 288** across the 71 calibration decks
  (flat comparison: 84,039 / 113,715 / 14,342 — the derived population is a fraction the size and
  far cleaner).
- **Frozen-panel precision 88.2% [84.8, 90.9]** — 455 claims judged, 382 real / 51 false /
  22 uncertain, judging debt 0.
- **Isolated cards** (no edge at all): lands 548/1,785 (30.7%), nonlands 441/4,451 (9.9%), 380
  distinct.

**The precision figure is a RELATIVE tracker, not an engine figure.** Blind judge-agreement draws
found the owner disagreeing with 25–40% of Claude's verdicts depending on stratum, so the panel
measures *a rubric applied consistently*, and a change that moves it moved something real. A third
blind draw against the re-judged cache is the only path back to an absolute number.

---

## 2. Layer 2 — scoring (what a card is worth in this deck)

### The directional pass

For every ordered pair p→c (`analyze.ts:366-396`):

```
axisBoost   = 1 + AXIS_BOOST(1.5) · maxAxisWeight(reasons)     // on-theme edges count up to 2.5×
wPayoff     = impactEdgeWeight(reasons) · axisBoost
c.support  += wPayoff · (p is commander ? 3 : 1)
p.feederSum += FEEDER_SHARE(0.25) · wFeeder · (c is commander ? 3 : 1)
```

`impactEdgeWeight` (`impact.ts:135`) takes the **max per distinct tag**, then sums:
`w(reason) = kinds[effectKind] × repeatability × scaling`, all from
`packages/engine/src/impact-weights.json`.

### Per-card numbers

```
authority   = √support            // what this card is PAID for, as a payoff
feederLift  = √feederSum          // what it CONTRIBUTES to others
score       = authority + roleBlend(1) · feederLift
rating      = clamp(round1(5 · score / deckMax), 0, 5)      // synergy-rating.ts:47
payoffRating / feederRating = same formula on authority / feederLift
doubleDuty  = ×1.15 if the card also fills a build role and sits on-axis
```

**A rating is DECK-RELATIVE.** 5 means "top engine piece of *this* deck", never "good card". A
uniform lift moves nothing; one card falling lifts a dozen others by renormalization. `deckMax`
usually belongs to the commander, whose ×3 boost anchors the ceiling (`synergy-rating.ts:40-42`).

### Deck-level synergy facets

```
breadth   = 5 · (Σ axisWeight / cards counted)            // how much of the deck is on-theme
anchoring = 5 · min(topAuthority / ANCHOR_TARGET(10), 1)  // is there a real payoff to build toward
synergyOverall = mean(breadth, anchoring)
cohesion  = min(1, deckFreq[primary theme] / nonlands)    // labelled focused / unfocused
```

### Themes

A deck's theme is TF-IDF over reason tags (`axis.ts:12`), with two corrections that were each
measured: the commander's own tag gets `COMMANDER_TF_BOOST = 8`, and a **trigger tag counts full
while a supply tag counts `PRODUCER_SHARE = 0.35`** — because a deck is what its payoffs *care*
about, not what its cards happen to do (20 removal spells draining incidentally used to outvote 7
magecraft payoffs). Corpus IDF comes from a committed artifact, `theme-stats.json` (N = 2,541).

---

## 3. Layer 3 — deck math (the probability layer, independent of synergy)

All of it rests on exact hypergeometric combinatorics (`engine/src/hypergeometric.ts`), with
`seen(turn) = 7 + turn` — no mulligans, no card draw, no opponent. **Every figure is therefore
conservative for a deck that draws, and the error compounds.** The caveat travels with the number
in the UI rather than living in a footnote.

| analytic | question it answers | method | file |
|---|---|---|---|
| **Clock** | how fast does this kill one opponent (40 life)? | expected power by turn, `min(1, seen/library)` weighting; commander at probability 1 | `pressure.ts:27` |
| **Land count** | how many lands should this run? | published Karsten regression on avg MV, ramp+draw, fast mana | `karsten.ts:37` |
| **Castability** | can I cast my hardest cards on curve? | `pAtLeast(mv, lands, seen(mv))` and per-colour pips, **reported separately, never multiplied** | `castability.ts:54` |
| **Answer coverage** | can I answer each of 6 threat classes in time? | `available = pAtLeast(1, copies, seen(clock))`; `required` inverted from a 50% confidence | `deck-math.ts:102` |
| **Colour / pip audit** | do I make the colours my own cards demand, by their own deadlines? | `minCopies(pips, turn, 0.9)`, ranked by shortfall | `mana-audit.ts:78` |
| **Wincons** | how do I win, and how focused is that? | classes + **Herfindahl focus index** (1 = single-minded) | `wincon.ts:67` |
| **Demand availability** | 20 cards care about creatures dying — will I have an outlet? | per-shape supplier availability; `null` = self-supplied, a refusal not a zero | `availability.ts:75` |
| **Build score** | is it *built* — enough ramp, draw, removal, wipes? | attainment vs targets, weighted, ×5; lands scored as a two-sided band | `build.ts:152` |
| **Archetypes** | what strategy is this? | matching cards / nonlands vs a floor; combo exempt | `archetypes.ts:91` |
| **Opening-7 lands** | how many lands in my opening hand? | exact PMF, k = 0..7 | `client/src/lib/land-math.ts` |

**The clock sets the horizon for everything else** — answers and demand are priced at the deck's own
clock, or the calibration median (9) when it has none. Rounded **down** deliberately: if the default
is wrong it should be wrong in the direction that does not flatter the deck.

**Calibrated vs seeded, stated honestly in the code:** `REQUIRED_CONFIDENCE = 0.5` and
`CORPUS_MEDIAN_CLOCK = 9` are calibrated against the 71 decks (at 75% confidence two answer classes
read 0/71 — a saturated gauge cannot rank). The Karsten coefficients are external and published.
Everything in `BASE_TARGETS` (ramp 10, draw 10, removal 10, wipes 3, lands 36 …),
`ARCHETYPE_TARGET_DELTAS`, `CATEGORY_WEIGHT`, `ARCHETYPE_FLOOR` and `EVENTS_PER_ROUND` is **hand-set
and marked "tunable"** — not fitted to anything.

**Deliberate non-scoring**: `graveyardHate` target is 0 — *reported, never scored*, because it is
the one answer class that does not scale with count. Answer coverage rewards breadth; wincon focus
rewards narrowness; the two are deliberately separate instruments so one number cannot reward a
deck for being vague.

---

## 4. Layer 4 — the graph and what a user actually sees

### The graph model

Two node types only: **card** and **token**. Facet hubs (`color:B`, `type:creature`) were retired —
`color:B` had reached degree 83 in an 84-card deck, drowning the card-to-card signal
(`graph-projection.ts:5-7`). Position is synergy; colour is what the card is.

Edges are directed producer → consumer, carrying `weight` (the impact weight), `tags`, and deduped
`reasonTexts`. Pruned server-side to **top-4 per node, unioned** so a mutual weak pick survives
(84 nodes / 246 edges on the Sorin fixture, down from 318 / 1,088).

Weight drives everything visual: link rest distance (260 → 60), spring strength, stroke width,
inspector ordering, flow ranking, label priority.

### What the web UI shows

Five tabs: **Overview** (headline SYNERGY and BUILD scores /5, build benchmarks with all the deck
math, suggestions, top-8 synergy cards, mana curve, opening-7 land odds) · **Archetypes** ·
**Cards** · **Combos** · **Graph**.

The graph view: 4 paint modes (type / colour identity / role / mana value, painting never
re-simulates), card search that dims rather than hides, a lone-tokens toggle, fit-to-view once per
deck, labels with a floor and a ceiling, art discs that become full card images past zoom 4, and —
on click — a two-direction BFS **flow** that dashes the in-flow edges with a crawling phase, plus an
inspector splitting **FEEDS** from **FED BY** with the reason sentence under each edge.

### What the CLI shows

Six sections: Commanders · Deck cohesion · Card synergies (ranked) · Combos · Themes · Roles.

**The CLI computes the entire deck-math layer and prints none of it.** `analyzeDeckStructured`
produces `deckMath`, `buildScore`, `buildCategories`, `suggestions`, `strategies`, `archetypes`,
`manaCurve`, `landCount`, `axis` and `themeMembership` on every run, and `formatReport` reads none
of them. There is no `--json` flag either, so on the CLI that work is computed and discarded.

---

## 5. Computed and never surfaced (dead analytics)

Everything here runs on every analysis and reaches no user:

| what | where computed | status |
|---|---|---|
| `payoffRating` / `feederRating` | `analyze.ts:493` | shipped on the wire; read only by a dev bin |
| `bucketScores` / `bucketCount` / versatility multiplier | `analyze.ts:419-424,447` | the whole consistency/efficiency/win-condition subsystem — appears only in a test fixture |
| `axisWeight` per card | `analyze.ts:489` | input to ratings; the shipped field has no reader |
| `report.axis`, `report.themeMembership` | `analyze.ts:589,601` | no UI, no CLI |
| `report.themes`, `report.roles`, `report.quantities` | | CLI only, never web |
| `undirectedReasons`, `offDeckReasons` | `graph-projection.ts:107` | cross the wire; nothing renders them |
| `classifyEffect` | `effect-class.ts:39` | exported, called by **nothing**; self-marked `ponytail: unread` |
| `dampByAlpha` + config `damping: 0.5` | `impact.ts:152` | product-dead; calibrator-only |
| `Reason.repeatability`, `.scaling` | | exactly one reader each (`impact.ts`) |
| `Dir.partnerCount` | `analyze.ts:388` | accumulated, divides nothing since √-damping replaced it |
| `detectLines` (threshold lines) | `lines.ts` | instrument only, by design — the bin's header calls that its acceptance test |
| supply/demand census + magnitude | `supply-demand.ts`, `magnitude.ts` | wired but **inert**: `beta: 0`, refused by three sweeps |

Roughly two dozen hand-run instrument bins exist alongside these (`population-compare`,
`panel-score`, `isolated-cards`, `build-population`, `ramp-coverage`, `answer-availability`,
`ratings-compare`, `supply-demand --inversions`, …). Those are gates, not product, and that is
deliberate — several exist precisely because no product surface can see what they measure.

---

## 6. Known defects and ceilings

**Live defects**
1. **The shipped `impact-weights.json` is missing 7 effect kinds that `SEED_IMPACT_WEIGHTS`
   defines.** Four are reachable — `extra-combat`, `graveyard-hate`, `keyword-grant`, `type-grant` —
   and therefore score at `UNKNOWN_KIND_WEIGHT = 0.2` in production. The coverage ratchet asserts
   against SEED only, so nothing catches it. *(Verified 2026-08-18.)*
2. **Duplicate reason sentences still reach the user.** The graph wire dedupes per edge, but the CLI
   (`report.ts:32`) and the Archetypes board (`ArchetypeBoard.tsx:47`) render raw — one trigger with
   six effect kinds prints six identical lines.
3. **Board fixtures predate tokens-as-nodes** — all five carry zero token nodes, so every
   fixture-driven layout test runs on a graph the product no longer produces.
4. **Toggling LONE TOKENS re-runs the simulation** (it changes `graph` identity, a layout-effect dep).

**Structural ceilings, each measured and accepted**
- A rating is deck-relative and rounded to 0.1 — small real movements are invisible, uniform ones
  are inert.
- Supply is **unweighted** everywhere in the deck-math layer: four Ashnod's Altars count the same as
  four Fling effects.
- No opponent is modelled anywhere. A deck that kills on turn 6 is priced as if the game ends on
  turn 6 — right if the table is racing it, wrong if it is being ignored.
- No mulligans, no card draw in `seen(turn)`.
- No chain discovery: a depth-3 engine reads as three unrelated rows.
- Provenance stops at tag + text — a `Reason` carries no clause id, so nothing can link a claim back
  to the sentence that produced it.
- The magnitude / supply-demand term is built, measured three times, and ships **off**: no value of
  `BETA` (or of `roleBlend`) clears the registered criterion, and the residual harm is a cross-tag
  feeder bleed that the blend cannot dilute.

---

## 7. The honest summary

- **The claim layer is the asset.** It is checkable against printed text, it is measured, and its
  defects are named with the blast radius of each.
- **The scoring layer is thin over it.** One blended score per card, deck-relative, with a handful
  of hand-set multipliers; its two attempts at a magnitude axis have both been refused on
  measurement.
- **The deck-math layer is the most player-facing thing here and the least connected to the graph.**
  It answers questions a player actually asks (can I cast this, can I answer that, how fast do I
  win) using exact probability, and it shares nothing with the synergy engine but the card list.
- **A large fraction of what is computed never reaches a user**, and one whole surface (the CLI)
  discards the entire deck-math layer.

---

## 8. Review findings (adversarial review, 2026-08-18)

The inventory above was handed to an independent reviewer with three questions: what is missing that
an EDH player would use, what should be deleted, and what existing math is wrong. Its conclusions,
recorded here — **none of these are built; this is a ranked queue, not a changelog.**

### Missing, ranked by value ÷ effort

1. **The cut list** — "I'm at 104 cards, which 4 go?" Every input already exists on every run
   (`synergyRating`, `axisWeight`, build roles, combo membership, land status, per-category
   count-vs-target). Flag a card when it is low-rated AND off-axis AND fills no role the deck is
   short on AND is not a land or combo piece. **Must ship as cut *candidates* with a printed reason
   per row** — isolation is an upper bound on uselessness (derivation gaps make a real card look
   dead), and "role over target" says nothing about which member is worst. Small effort.
2. **The add list** — "my deck wants a sac outlet; which cards supply one?" The demand rows already
   name the under-supplied shapes; scan the derived corpus in colour identity for emits that satisfy
   the consumer key, rank by consumers fed × impact weight, print the generated reason. This is the
   thing no co-occurrence recommender can do. **Must state the pool is the 2,541-card derived
   corpus, not all of Magic**, and ~1 in 9 reasons will be false at current precision — tolerable
   only because the reason is printed beside the name. Medium effort.
3. **Assembly probability** — "A combos with B; how often do I have both?" One `jointAvailability`
   call over the top edges and detected combos, priced at the deck's clock. Joins the two layers
   that currently share nothing but the card list. Small effort.
4. **Commander dependence** — "if my commander eats removal three times, does the deck still work?"
   The per-partner contributions are already accumulated. **Must be computed on unboosted
   contributions**, or `COMMANDER_BOOST = 3` makes a third of the answer an artifact.
5. **Three things already computed and thrown away**: unpartnered tokens ("this deck makes Clues and
   nothing cares"), the payoff/enabler split per card, and answer availability at fixed early turns
   beside the clock-priced one. UI-only cost.
6. **Salt readout** — `edhrecSaltiness` is merged for 31,932 cards and read by nothing. Trivial, and
   only ever as third-party data, never blended into a score.

Explicitly not proposed: chain/loop discovery and Monte Carlo (correctly gated on the roadmap), and
percentiles against the 71 calibration decks — those are one owner's decks, and presenting them as a
meta would be a confident wrong claim.

### Delete / surface / keep

| thing | verdict |
|---|---|
| `payoffRating` / `feederRating`, `themeMembership`, `report.axis` | **surface** — they answer "what job does this card do" and "is my theme balanced" |
| `bucketScores` / `bucketCount` / versatility multiplier, `Dir.partnerCount` | **delete** — a hand-weighted re-derivation of what roles and wincons already say |
| `classifyEffect` | **delete** — zero callers, self-marked unread |
| `dampByAlpha` + `damping` config | **delete from the product path** — superseded by √-damping |
| `undirectedReasons` / `offDeckReasons` on the wire | **delete from the wire**, keep computable for bins |
| the flat engine + its CLI `deck.json` path | **delete** — a second engine whose `score = reasons.length` contradicts shipped semantics |
| `computeRoles` (CLI's ramp/draw/removal line) | **delete** — a best-effort proxy that disagrees with the rule-based `buildCategories` counts; two removal counts in one product, one approximate |
| `cohesion` | **delete or fold** — a third "focus" number beside breadth and wincon focus |
| CLI's discarded deck math | **add `--json`**, do not hand-format six more sections |
| duplicate reason sentences in the CLI and Archetypes board | **fix** — the wire dedupe already exists, reuse it |
| threshold lines, supply/demand census + magnitude | **keep as instruments** — by design; the magnitude wiring is the experiment record |

### Improve, in order of measured risk

1. **Fix the shipped `impact-weights.json`** — four reachable kinds score 0.2 instead of
   0.9/0.3/0.3/0.45, and the ratchet asserts against SEED so nothing catches it. Live defect, not a
   tuning question. Gate with `ratings-compare`; then point the ratchet at the shipped file.
2. **Make the edge score and the rating agree** — the top-edges list ranks by `claimCount` while the
   graph draws by `impactEdgeWeight`, so a pile of six 0.2-weight tags outranks one unbounded draw
   engine. Summing impact weight keeps the duplicate protection (max per tag) and adds magnitude.
3. **`deckMax` includes the ×3-boosted commander**, so every other rating is really a fraction of the
   commander. Measure the top non-commander card's rating with and without the commander in the max.
4. **Answer coverage counts a drawn answer as an available one** — a 6-mana wipe in hand on turn 3
   answers a turn-3 threat today. `expectedPower` already applies a castable-by-own-MV gate; apply
   the same one here.
5. **The clock is blind to tokens and it prices everything downstream** — a token deck reads slow,
   gets a longer horizon, and therefore *flattering* availability numbers, which is the one bias
   direction this layer promises to avoid. Measure token-primary clocks against the rest before
   deciding between a crude token term and a stated exclusion.
6. **√ damping and the constant herd** (`AXIS_BOOST`, `FEEDER_SHARE`, `COMMANDER_BOOST`,
   `PRODUCER_SHARE`, `ANCHOR_TARGET`, …) — re-tuning must run as a registered-criterion sweep
   against the inversion baseline, the same shape the magnitude work used, or it is just taste.
7. **`REQUIRED_CONFIDENCE = 0.5` was tuned to separate the 71 decks, not anchored to play** — show
   the shortfall at 50% and 75% side by side rather than letting one read as a standard.
8. **`BASE_TARGETS` is podcast doctrine driving a headline /5** — report the deck's count against the
   71-deck distribution beside the target, and check whether the two disagree about which decks are
   under-built. Do not fit the targets to the 71.
9. **Axis TF-IDF is sound but its IDF corpus is the 2,541 cards these decks play**, so a tag they
   overuse reads as globally undistinctive. Not fixable until the derived corpus grows; the open
   subsumption gap is the higher-value theme fix.

### The reviewer's verdict

The claim layer is the asset — checkable against printed text, measured, every gate carrying its
blast radius. The deck-math layer is the second asset. **The weakness is the last mile**: a large
fraction of what is computed answers no one, and the two strong layers never touch — synergy says
what works together, deck math says when you will have things, and no surface says whether the
synergy will actually assemble in a game. The scoring layer between them is the thinnest, most
hand-set part, and carries one live defect that should be fixed before any tuning conversation.
Highest-value next move: **the cut list** — the question every EDH player actually brings to a tool,
computable from fields already on every report, and its construction forces the dead payoff/feeder/
axis fields into the light.
