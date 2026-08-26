import { readFileSync } from "node:fs";
import type { Card } from "./card.js";
import { synergyScore, type Reason } from "./synergy.js";
import { extractTags, type Tag } from "./tags.js";
import type { Combo, ComboIndex } from "./combos.js";
import { themeWeights, rankThemes, weightedEdge, dampedScore, computeCohesion, type TagStats, type Cohesion } from "./weights.js";
import { computeDeckStats, type ManaCurveBucket } from "./deck-stats.js";

const TAG_STATS: TagStats = JSON.parse(
  readFileSync(new URL("./tag-weights.json", import.meta.url), "utf8"),
) as TagStats;

export const COMMANDER_BOOST = 3;

export interface SynergyEdge {
  a: string;
  b: string;
  score: number;
  reasons: Reason[];
}

export interface CardSynergy {
  name: string;
  isCommander: boolean;
  score: number;
  partnerCount: number;
  topPartners: { name: string; score: number; reasons: Reason[] }[];
  /** Per-card classification into non-synergy "job" buckets (consistency/efficiency/
   *  win-condition), computed from the card's own abilities by @mtg/matcher's
   *  analyzeDeckStructured. Absent when the card qualifies for none of the three, or when
   *  produced by the flat (retired-from-web/CLI) analyzeDeck below. */
  bucketScores?: { consistency: number; efficiency: number; "win-condition": number };
  /** 1-4: how many of the 4 UI buckets (the 3 above + Synergy via score>0) this card
   *  qualifies for. Absent (not 0) when the card qualifies for none. */
  bucketCount?: number;
  /** 0–5 deck-relative, axis-weighted synergy rating. Set only by @mtg/matcher's
   *  analyzeDeckStructured (needs structured theme tags); undefined on the flat engine. */
  synergyRating?: number;
  /** Directional authority: the card's payoff support (√ of the summed weight of edges that FEED
   *  it). A well-fed anchor scores high; a pure feeder ~0. Set only by analyzeDeckStructured. */
  authority?: number;
  /** Directional feeder lift: √ of the summed (feeder-share) weight of edges this card FEEDS.
   *  The counterpart to `authority`. Raw score, not a rating — the protected-set test in
   *  `specs/2026-08-18-per-role-score-design.md` §4.2 compares scores, and comparing the rounded
   *  ratings instead would misclassify cards near the boundary. Set only by analyzeDeckStructured. */
  feederLift?: number;
  /** 0–5, same deck denominator as `synergyRating`: what this card earns as the PAYOFF of its
   *  edges. A pure enabler reads 0 here and high on `feederRating`. Set only by
   *  analyzeDeckStructured. */
  payoffRating?: number;
  /** 0–5, same denominator: what it earns as a FEEDER, BEFORE `roleBlend` is applied. */
  feederRating?: number;
  /** 0–1: how strongly this card's best synergy edge sits on the deck's strategy axis (the max
   *  axis weight over its edges' reason tags). The continuous value behind `doubleDuty`, which
   *  hard-cuts it at a threshold and so fires on ~half a deck. Set only by analyzeDeckStructured. */
  axisWeight?: number;
  /** Printed mana cost, e.g. "{5}{B}{B}", and its mana value. Carried so a reader can weigh the
   *  effect against what it costs — the owner's "effect + cost" — WITHOUT the two ever being
   *  multiplied into one number. Cost is deliberately not in `synergyRating`: measured over the 71
   *  decks, nonland payoff cards mean MV 3.43 against feeders' 3.04, so a cost term discounts
   *  payoffs by construction (`specs/2026-08-19-clock-and-mana-model-review.md` §5). Absent on the
   *  flat engine and on a card with no printed cost. */
  manaCost?: string;
  manaValue?: number;
  /** When can you actually cast it — mana AND colours, at its own mana value as the deadline.
   *  `castable` is the answer and the interval is the PLAY POLICY (the low end holds up two mana,
   *  the high end spends everything on acceleration). `mana` is the same cell with colours ignored,
   *  kept as the DIAGNOSTIC: a card whose `mana` is high and whose `castable` is low has a colour
   *  problem and not a ramp problem. Absent on a land, on the flat engine, and on a cost the model
   *  REFUSES to price (X costs, delve, convoke, affinity, free casts) — a refusal reads as a blank,
   *  never a zero. */
  castability?: {
    turn: number;
    castable: { low: number; high: number };
    mana: { low: number; high: number };
  };
  /** True when the card fills a functional BUILD role AND has an on-axis synergy edge — one card,
   *  two jobs. Set only by @mtg/matcher's analyzeDeckStructured; the card also carries a small
   *  capped synergyRating premium. Undefined on the flat engine. */
  doubleDuty?: boolean;
  /** The functional role name(s) the double-duty card fills (BuildCategory values like "ramp"),
   *  for the UI marker. Plain string[] — this package must not depend on @mtg/matcher. Matcher-only. */
  doubleDutyRoles?: string[];
  /** Every functional BUILD role this card fills (BuildCategory values like "ramp", "draw").
   *  Superset of doubleDutyRoles — present on all cards with a role, not only double-duty ones.
   *  Matcher-only; undefined on the flat engine and on cards that fill no functional role. */
  roles?: string[];
}

/** Populated only by @mtg/matcher's analyzeDeckStructured (see that package's
 *  mechanisms.ts) — stays undefined on this flat engine's analyzeDeck, same
 *  convention as CardSynergy.bucketScores/bucketCount. `category` is a plain string
 *  here (not the matcher-only MechanismCategory union) because this package must not
 *  depend on @mtg/matcher. */
export interface ArchetypeGroup {
  category: string;
  label: string;
  cards: string[];
  pairs: { a: string; b: string; reasons: Reason[] }[];
}

/** Layer-1 archetype (strategy) ranking. Populated only by @mtg/matcher's
 *  analyzeDeckStructured (see that package's archetypes.ts). `name` is a plain string
 *  here (not the matcher-only Archetype union) because this package must not depend on
 *  @mtg/matcher — same convention as ArchetypeGroup.category. */
export interface ArchetypeRanking {
  name: string;
  label: string;
  confidence: number;
}

/** Deck-math readouts. Every `available` is P(you have drawn at least one by `turn`), so all of
 *  `hypergeometric.ts`'s caveats apply: no mulligans, no opponent, and `seen(T) = 7 + T` ignores
 *  card draw, which makes each figure CONSERVATIVE for a deck that draws.
 *
 *  `available: null` means the question does not apply -- a combat trigger the game itself supplies
 *  has no card to draw, and reporting 0% there would invent a hole the deck does not have. */
export interface DeckMath {
  /** The turn everything here is priced against: the deck's own measured clock when it has one.
   *
   *  It replaces a fixed turn 5 that applied to every deck alike, which design §10.8 calls out as
   *  the defect -- target turns are Tier C guesses because nothing anchors them. */
  turn: number;
  /** Where `turn` came from. `corpus-median` means the deck has no combat clock (a mill or alt-win
   *  deck) and is priced at the median of the 71 calibration decks instead. */
  turnSource: "clock" | "corpus-median" | "override";
  /** Cards seen by `turn`, i.e. `7 + turn`. Carried so a readout can show its own assumption. */
  seen: number;
  /** Deck size minus the commanders, who are never drawn from it. */
  library: number;
  /** One row per answer class in the doctrine's order, INCLUDING classes the deck cannot answer at
   *  all -- the zero row is the finding. */
  answers: {
    class: string;
    count: number;
    /** How many of them EXILE -- the only answers a recursive commander or a reanimator cannot
     *  undo (design §2.1). A sub-count of `count`, never a separate class. */
    exiling: number;
    /** How many of them keep answering. Graveyard hate only: one Bojuka Bog answers a recursion
     *  engine not at all, so this is the number that class is really judged on, and it is 0 on
     *  every other class by construction. */
    recurring: number;
    /** A commander answers this class, so it is available in every game. */
    fromCommandZone: boolean;
    available: number;
    /** How many answers of this class the deck would have to run to reach `REQUIRED_CONFIDENCE` by
     *  `turn` — the doctrine's confidence inverted through the same hypergeometric that produced
     *  `available`, not a per-class template. Identical across classes by construction: the maths
     *  demands the same count of every class, and only what the deck HAS differs.
     *
     *  0 when a commander answers the class, since a card available in every game owes nothing to a
     *  draw probability. */
    required: number;
    /** How many answers of this class exist inside the deck's colour identity, corpus-wide
     *  (`answer-pool.json`). A count of 0 beside a POOL of 56 is the colour pie; a count of 0
     *  beside a pool of 421 is a deckbuilding choice, and the panel must be able to tell a reader
     *  which one it is looking at. Absent when no commander was detected. */
    pool?: number;
  }[];
  /** The deck's measured combat clock: expected attacking power per turn, and the turn that
   *  accumulates to one opponent's 40 life.
   *
   *  Optimistic by construction -- nobody blocks, nothing is removed, nothing has summoning
   *  sickness -- so read it as a RATE for comparing decks, not as a date. `turn` is absent when the
   *  deck has no combat clock at all, which is the honest answer for a mill or alt-win deck rather
   *  than a made-up number. */
  clock: {
    turn?: number;
    /** Expected attacking power on the board at turn 5. */
    powerAtFive: number;
  };
  /** How the deck plans to win, and how concentrated those plans are.
   *
   *  Scored the OPPOSITE way to `answers`: coverage wants breadth, focus wants concentration. A
   *  deck all-in on one plan beats a deck with three half-plans, so a low focus is the finding. */
  wincons: {
    classes: { class: string; count: number; share: number; cards?: string[] }[];
    /** Herfindahl over the class shares: 1 is single-minded, 1/n is n plans split evenly. */
    focus: number;
    primary?: string;
  };
  /** Payoffs that read a RANDOM card off your own library, and what your library gives them.
   *
   *  Hidetsugu and Kairi drains for the mana value of whatever is on top, so the deck's curve IS the
   *  payoff. Reported at deck level and never as an edge: the trigger CHOOSES nothing, so a claim
   *  about one expensive spell would be true of every one of them equally — see `topdeck.ts` for the
   *  refusal in full. Empty for the decks that run no such card, which is most of them. */
  topdeck: {
    card: string;
    /** Expected mana value of one hit over the WHOLE library — lands included, because a land is
     *  exiled like anything else and pays out zero. */
    meanManaValue: number;
    /** The same mean with lands dropped: what a hit is worth when it is not a land. */
    nonlandMeanManaValue: number;
    /** Share of the library that is a land, i.e. the share of hits that pay nothing. */
    landShare: number;
    /** The free-cast half, when the card has one. */
    castable?: { types: string[]; share: number };
  }[];
  /** Karsten's land-count regression against what the deck runs. Tier B -- published and
   *  independently confirmed. The build benchmark's score reads `target` too now (task 9,
   *  2026-08-21) -- before that fix it scored a flat 36 regardless of what this block showed, so
   *  the panel and the score could (and did) disagree about the same deck.
   *
   *  Reads AVERAGE mana value only, so a bimodal deck and a flat one get the same answer, and it has
   *  no colour term at all: how many lands is a different question from which ones. */
  lands: {
    actual: number;
    /** What `buildScore` is actually scored against -- the regression's own rounded answer (via
     *  `@mtg/matcher`'s `gatedLandsTarget`, the flat convention on a fallback) PLUS any archetype
     *  delta folded in by `adjustedTargets` (landfall's `+4`, task 9 fix F1). Equal to
     *  `rawTarget + archetypeDelta` always -- the same call `computeBuild` makes on the identical
     *  input, so the panel and the score can never again disagree about this number. */
    target: number;
    /** 'derived' when the GATE landed on this deck's own regression answer; 'flat' when the
     *  regression extrapolated past where it was tested and the flat convention won instead --
     *  render the reason on a fallback, never swap silently between two numbers that mean different
     *  things. Independent of `archetypeDelta`, which can be non-zero under either source. */
    targetSource: "derived" | "flat";
    /** The regression's own rounded answer, always -- even on a fallback, so a reader can see what
     *  the curve's own math said and why it was refused, rather than have the number vanish. */
    rawTarget: number;
    /** The archetype adjustment already folded into `target` (landfall's `lands: +4` today, 0 for
     *  every other deck) -- named explicitly so a silent shift from `rawTarget`/the gate's own
     *  answer to `target` is never the reader's job to notice. Task 9 fix F1: before this field
     *  existed the score alone applied the delta and the panel printed the un-adjusted number
     *  beside it. */
    archetypeDelta: number;
    /** Which archetype the delta above came from (e.g. "Landfall") -- present only when
     *  `archetypeDelta !== 0`. */
    archetypeLabel?: string;
    avgManaValue: number;
    /** Cheap ramp and draw, worth 0.28 of a land each. */
    rampPlusDraw: number;
    /** Zero-cost repeatable mana, worth a whole land each. */
    fastMana: number;
    /** Modal DFCs with a land back, worth 0.74 of a land untapped and 0.38 tapped. They are NOT in
     *  `actual` — this regression prices them as spells — while the `lands` BUILD category counts
     *  them by type line, so this is exactly the gap between the two land numbers a reader sees on
     *  one panel. */
    mdfc: number;
  };
  /** The deck's hardest casts, on TWO axes that are never multiplied together: can you have the
   *  mana, and can you have the colours. The product would read as one clean number and be wrong --
   *  both axes are driven by the same lands, so their correlation is positive.
   *
   *  Wrong in two directions at once, which is why `biases` ships with it: ignores ramp (understates)
   *  and ignores tapped lands (overstates). Cards whose cost the model cannot represent are REFUSED
   *  rather than guessed, and counted. */
  castability: {
    cards: {
      name: string;
      turn: number;
      /** P(you can cast it) — mana and colours together. The interval is the PLAY POLICY: the low
       *  end holds up two mana before casting an accelerant, the high end spends everything on
       *  acceleration and is a ceiling no real deck plays to. */
      castable: { low: number; high: number };
      /** The same cell with colours ignored, kept as the diagnostic. */
      mana: { low: number; high: number };
    }[];
    refused: number;
    biases: string;
    /** Cards that put a nonland permanent onto the battlefield FROM HAND (roadmap I6): the printed
     *  cost is never paid and the stack is never used, so none of the figures above apply to what
     *  they cheat in. Absent when the deck holds none. A LIST AND NEVER A RATE -- how often a deck
     *  actually does it needs a play model nothing here has. */
    cheatsIntoPlay?: string[];
    /** THE COMMANDER'S OWN ROW, which is the build-around question stated directly (roadmap K5):
     *  "your commander is online turn X". One entry, or two for a partner pair.
     *
     *  Never inside `cards`, which is the HARDEST few of the 99 — a commander is not competing for
     *  that list, it is the card the deck is built around, and a reader looks for it by name.
     *
     *  `castable` is null exactly when the cost is refused (an X cost, delve, convoke…), and a
     *  renderer must print an em dash there and NEVER 0%: a reader trusts a percentage absolutely,
     *  and 0% would say the commander is uncastable. */
    commanders?: {
      name: string;
      turn: number;
      castable: { low: number; high: number } | null;
      mana: { low: number; high: number } | null;
      refused?: string;
      /** Present when the commander does something from the COMMAND ZONE (eminence, Lurrus-style
       *  static, commander ninjutsu). The turn below is then WRONG in the deck's favour's opposite
       *  direction — the ability is online from turn 1 at no mana and this figure prices the CAST.
       *  ~51 corpus cards; the derive fix is J10 and is not a blocker for saying so here. */
      commandZoneCaveat?: string;
    }[];
  };
  /** Per-colour feasibility: what the deck's own pips demand by each card's own mana value,
   *  against how many sources it runs. Absent colours are colours nothing in the deck costs.
   *
   *  Composition only -- this says nothing about how many lands to run, and a land that enters
   *  tapped counts as a full source. */
  colors: {
    color: string;
    supplied: number;
    /** The biggest shortfall, when one exists. */
    /** `required` prices the free mulligan; `requiredRaw` does not. The keep band reads a hand's
     *  LAND count, so applied to one colour the first over-states the mulligan's help exactly as the
     *  second under-states it — the pair is an interval and a renderer showing one alone picks a
     *  model silently (roadmap L5). */
    worst?: { pips: number; turn: number; required: number; requiredRaw: number; cards: number };
  }[];
  /** The deck's biggest demand shapes: how many cards want the event, how many supply it, and
   *  whether you will have a supplier. */
  demand: {
    key: string;
    consumers: number;
    suppliers: number;
    available: number | null;
    fromCommandZone: boolean;
  }[];
}

export interface DeckCoverage {
  /** Cards that resolved against the corpus. Never the paste's line count — an unresolved name is
   *  a different failure and `missing` already reports it. */
  resolved: number;
  /** Of those, how many the synergy engine could read. */
  derived: number;
  /** The names it could not, capped for the same reason the legality report caps its lists: a paste
   *  can produce dozens and a list that long stops being read. */
  underivedNames: string[];
  /** Whether the list above was cut. */
  more: number;
  /** The sentence itself, built ONCE here rather than in each renderer. No subpath of
   *  `@mtg/matcher` is safe to value-import from client code (the 2026-08-21 regression), and a
   *  second copy of a sentence is how two surfaces start disagreeing — the same ruling the
   *  commander-tax caveat ships under. */
  caveat: string;
}

export interface DeckReport {
  commanders: string[];
  cards: CardSynergy[];
  edges: SynergyEdge[];
  /** Copies per repeated card, so ONE node can show "x6" instead of six identical nodes. Only cards
   *  with more than one copy appear. Absent from the flat engine, which never deduped. */
  quantities?: Record<string, number>;
  /** Tokens the deck can make, each flagged with whether anything beyond its own creator relates to
   *  it. The DEFAULT view shows only those with a partner; the toggle reveals the rest. A token with
   *  no partner is a real signal — "this deck makes Clues and nothing cares" — which is why the data
   *  carries it even when the view hides it. */
  tokenNodes?: { name: string; hasPartner: boolean }[];
  /** How much of the deck the SYNERGY engine could actually read.
   *
   *  A card that resolves against the corpus but has no derived tags forms NO edges, carries NO
   *  theme and cannot reach an archetype — and it looked exactly like a fully analysed card, because
   *  `MissingCards` reports only names that failed to RESOLVE. **Measured on a real precon: 52 of
   *  100 cards derived, so 48 were silently invisible to every synergy number on the page.** The
   *  71 calibration decks are ~99% derived, which is why nothing here ever showed it.
   *
   *  NARROW ON PURPOSE, because the loss is narrow: an underived card still counts toward the mana
   *  base, the land count, castability, legality, the bracket, combo detection and most build
   *  categories, all of which read PRINTED data. Absent when every card is derived — a report with
   *  nothing to admit says nothing. */
  coverage?: DeckCoverage;
  combos: Combo[];
  themes: { tag: string; count: number }[];
  manaCurve: ManaCurveBucket[];
  landCount: number;
  avgManaValue: number;
  medianManaValue: number;
  roles: { ramp: number; draw: number; removal: number };
  cohesion: Cohesion | null;
  /** "N cards do this deck's thing, and two of them by turn 3 is P%" (roadmap K2). Null exactly
   *  when `cohesion.dominant` is false — the theme layer declining to name the deck (A15) must not
   *  be followed by a number about the thing it just declined to name. Defined in
   *  `matcher/src/thing.ts`; typed structurally here because the flat engine never produces one. */
  thing?: {
    theme: string; tag: string; count: number; cards: string[];
    fromCommandZone: string[]; turn: number; k: number; probability: number;
  } | null;
  /** CR 903.8's commander tax, as a CAVEAT and not a number (roadmap J5). A commander is priced at
   *  P = 1 and reported as "available every game", which is true and invites being read as free and
   *  repeatable — it is free ONCE. The tax is a function of how many times the commander has died,
   *  which nothing here simulates, so what ships is the sentence. Present only when the deck has a
   *  commander; feeds no score. */
  commanderTax?: { perCast: number; caveat: string };
  /** What is off about this deck against CR 903.3 and 903.5a-d (roadmap J4). A REPORT and never a
   *  gate — a partial paste is a normal thing to hand this tool. An EMPTY list means nothing was
   *  found, never "the deck is legal": four rules are checked and the format has more. Defined in
   *  `matcher/src/legality.ts`; feeds no score. */
  legality?: { rule: string; detail: string; cards: string[] }[];
  /** Mana availability from a seeded goldfish simulation (roadmap I11's report wiring).
   *
   *  AN INTERVAL AND NEVER A POINT — the model's own falsifier fired, so what ships is the pair of
   *  play policies (spend-everything, a CEILING; hold-up-2, nearer real play). NOT the per-card
   *  castability figure: that one is colour-aware and counts lands, this one is colour-blind and
   *  models ramp and tapped lands. Defined in `matcher/src/goldfish.ts`; feeds NO score. */
  manaAvailability?: {
    trials: number;
    accelerants: number;
    rows: { turn: number; mana: { median: number; p25: number; p75: number }; payableShare: { median: number; p25: number; p75: number } }[];
    headline: { mana: number; turn: number; low: number; high: number };
  };
  /** Connections needed to deal 21 commander damage (CR 903.10a), as a RANGE from a bare commander
   *  to one carrying everything the deck can attach. Present only on a deck detected as voltron —
   *  a 1-power commander in a spellslinger deck needs twenty-one connections, which is true and
   *  useless. Defined in `matcher/src/commander-damage.ts`; NOT the clock, which measures total
   *  board power against 40 life. */
  commanderDamage?: { commander: string; power: number; attachable: number; attachableCount: number; bare: number; kitted: number }[];
  /** Cards whose printed land condition THIS deck cannot meet (roadmap I9's deck-level half).
   *  A REASON, never a gate: the card still taps for mana and still rates, and the honest surface is
   *  to print the fact. Defined in `matcher/src/land-conditions.ts`; typed structurally here because
   *  the flat engine never produces one. */
  landConditions?: { card: string; template: string; wants: string; has: string }[];
  /** Which Commander Bracket the deck's CONTENTS allow (roadmap L3, WotC's official 1-5 tiers).
   *  Three bands and not five: 1 vs 2 is about how the deck was built and 4 vs 5 is a meta
   *  judgement, neither of which is a checkable list. Defined in `matcher/src/brackets.ts`; typed
   *  structurally here because the flat engine never produces one. DESCRIBES, never grades. */
  bracket?: {
    band: "1-2" | "3" | "4-5";
    gameChangers: string[];
    infiniteCombos: number;
    cheapCombos: { cards: string[]; result: string; manaValue: number }[];
    reasons: string[];
  };
  archetypes?: ArchetypeGroup[];
  /** 0–5 deck positive-coherence: mean nonland synergyRating. Matcher-only (see above). */
  positiveCoherence?: number;
  /** Ranked layer-1 archetypes (strategies), most-confident first. Matcher-only. The
   *  deck's identity headline uses strategies[0]. Distinct from `archetypes` above,
   *  which are synergy-mechanism groups (a future rename to `mechanismGroups` will
   *  disambiguate these). */
  strategies?: ArchetypeRanking[];
  /** BUILD /5: archetype-adjusted functional-template completeness. Matcher-only (see above);
   *  stays undefined on the flat analyzeDeck. */
  buildScore?: number;
  /** Per-leaf count, for the client's within-parent distribution rows. `target` is 0 on every
   *  leaf grouped under a `buildParents` entry (owner's 2026-08-21 ruling: a leaf shows count and
   *  share, never a target) and stays real only for `lands` (and the always-0 `burn`/`stax`, which
   *  are win-plan/tax signals and were never folded into a parent). Matcher-only. `category` is a
   *  plain string (not the matcher-only BuildCategory union) because this package must not depend
   *  on @mtg/matcher — same convention as ArchetypeGroup.category. */
  buildCategories?: { category: string; count: number; target: number }[];
  /** The four Command-Zone template groups (Consistency, Ramp, Interaction, Board wipes), each
   *  carrying its OWN archetype-adjusted target and the UNION of its leaves' member counts (never
   *  the sum -- a card can carry two leaves). This is what actually scores and flags now; a leaf
   *  under `buildCategories` never does. Matcher-only, same reason as `buildCategories`.
   *  `coverageWeighted` is `true` only on the one parent (`Interaction`) whose attainment the score
   *  multiplies by `answerCoverage.coverage` -- absent everywhere else, so a client can select it by
   *  flag instead of matching `name === "Interaction"` (whole-branch review IMPORTANT 4: a rename of
   *  that parent would otherwise silently unwire the panel's coverage note while the score kept
   *  docking it). */
  buildParents?: { name: string; count: number; target: number; leaves: string[]; coverageWeighted?: true }[];
  /** Concrete, few, actionable BUILD gap suggestions in the deck's own language. Matcher-only. */
  suggestions?: string[];
  /** The coverage multiplier `Interaction` was scored with, its per-class weights, and the
   *  graveyard vulnerability it was built from. Present so the panel and a test can say WHY the
   *  number is what it is rather than trust it. Matcher-only, optional for the same reason every
   *  other matcher-only field here is: the flat `analyzeDeck` above never populates it. */
  answerCoverage?: {
    coverage: number;
    source: "weighted" | "unweighted";
    graveyardVulnerability: number;
    rows: { class: string; poolShare: number; demand: number; weight: number; covered: boolean }[];
  };
  /** How the Ramp parent's cards would survive being attacked, split by what answers each one:
   *  a fetched land (306 cards in the format answer a land), a rock (755 answer an artifact), a
   *  mana dork (1,839 answer a creature, and one board wipe takes them all at once). Those three
   *  figures come from `answer-pool.json`, the same generated artifact the Interaction coverage
   *  axis scores against, so the ordering is measured rather than asserted.
   *
   *  REPORTED, NEVER SCORED: weighting attainment by tier would dock a mono-red deck for not
   *  running green land ramp. See `RampResilience` in the matcher for the full reasoning and the
   *  identity-relative pool that scoring it honestly would need. Matcher-only. */
  rampResilience?: { land: number; rock: number; dork: number; landShare?: number };
  /** Cards the deck is not using, weakest first, each carrying its own reasons in plain words.
   *  CANDIDATES, never a verdict -- a missing edge looks exactly like a useless card, and the
   *  build layer counts a category's members without ranking them. Matcher-only; structural here
   *  for the same reason `buildCategories` is (this package must not depend on @mtg/matcher). */
  cutList?: { name: string; rating: number; partners: number; manaValue: number; reasons: string[] }[];
  /** TRIM MODE, the whole ranked order: every cuttable card weakest-first, each row carrying what
   *  argues it STAYS. `cutList` filters and can be empty on a tight deck; this always has an Nth
   *  row, because "I'm five over" is a question that must be answered. */
  trim?: { name: string; rating: number; partners: number; manaValue: number; reasons: string[]; protections: string[] }[];
  /** Build categories the deck carries MORE of than its target, biggest surplus first — where the
   *  deck has room. Names the CATEGORY and never a member: nothing in this engine ranks two ramp
   *  cards against each other, which is exactly why the cut list protects any card with a role. */
  slack?: { category: string; count: number; target: number; over: number }[];
  /** Deck math: what the deck demands of itself and what it can answer, priced by when you draw
   *  it. Matcher-only, and structural here for the same reason `buildCategories` is -- this package
   *  must not depend on @mtg/matcher. */
  deckMath?: DeckMath;
  /** 0–5 Anchoring facet: does the deck have strong, well-supported payoffs? From absolute
   *  authority. Matcher-only. */
  anchoring?: number;
  /** 0–5 composite headline SYNERGY = blend of breadth (positiveCoherence) and anchoring.
   *  Matcher-only. */
  synergyOverall?: number;
  /** The deck's strategy axis: every theme tag with TF-IDF weight > 0, normalized so the strongest
   *  is 1.0, strongest first. Pairs with CardSynergy.axisWeight — this names the themes, that says
   *  how strongly a card sits on them. Matcher-only. */
  axis?: { tag: string; weight: number }[];
  /** Per candidate theme, how the deck relates to it: cards producing SURPLUS of the event beyond
   *  their own existence, cards PAID OFF by it, and cards supplying only its BASELINE. `selective`
   *  says whether the baseline was admitted as membership — a tag satisfied by most of the deck by
   *  existence alone is deck arithmetic, not a theme. Matcher-only. */
  themeMembership?: {
    tag: string; surplus: number; payoffs: number; baseline: number; selective: boolean;
  }[];
  /** WHAT THIS DECK IS, as the three-slot sentence its parts already answer (roadmap A16): win
   *  route · engine · means. A slot is null when its layer has nothing to say -- notably `engine`,
   *  which is null exactly when `cohesion.dominant` is false. Built by `deckSentence` in the
   *  matcher; every clause is a join over fields on this same report. */
  identity?: { win: string | null; engine: string | null; means: string | null };
}

interface Agg {
  name: string;
  weighted: number;
  partnerCount: number;
  partners: { name: string; score: number; reasons: Reason[]; contribution: number }[];
}

export function analyzeDeck(
  cards: Card[],
  combos?: ComboIndex,
  commanderNames?: string[],
): DeckReport {
  const commanderSet = new Set(commanderNames ?? []);

  const edges: SynergyEdge[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const r = synergyScore(cards[i], cards[j], combos);
      if (r.score > 0) {
        edges.push({ a: cards[i].name, b: cards[j].name, score: r.score, reasons: r.reasons });
      }
    }
  }
  edges.sort((x, y) => y.score - x.score);

  // Deck-local tag frequency: cards whose produces ∪ cares contains the tag.
  const deckFreq = new Map<Tag, number>();
  for (const card of cards) {
    const { produces, cares } = extractTags(card);
    for (const t of new Set<Tag>([...produces, ...cares])) {
      deckFreq.set(t, (deckFreq.get(t) ?? 0) + 1);
    }
  }
  const tw = themeWeights(deckFreq, TAG_STATS);
  const weightOf = (t: string): number => tw.get(t) ?? 0;

  const agg = new Map<string, Agg>();
  for (const card of cards) {
    agg.set(card.name, { name: card.name, weighted: 0, partnerCount: 0, partners: [] });
  }
  for (const edge of edges) {
    const w = weightedEdge(edge.reasons, weightOf);
    const boostForA = commanderSet.has(edge.b) ? COMMANDER_BOOST : 1;
    const boostForB = commanderSet.has(edge.a) ? COMMANDER_BOOST : 1;
    const a = agg.get(edge.a);
    const b = agg.get(edge.b);
    if (a) {
      a.weighted += w * boostForA;
      a.partnerCount += 1;
      a.partners.push({ name: edge.b, score: edge.score, reasons: edge.reasons, contribution: w * boostForA });
    }
    if (b) {
      b.weighted += w * boostForB;
      b.partnerCount += 1;
      b.partners.push({ name: edge.a, score: edge.score, reasons: edge.reasons, contribution: w * boostForB });
    }
  }

  const cardSynergies: CardSynergy[] = [...agg.values()]
    .map((v) => ({
      name: v.name,
      isCommander: commanderSet.has(v.name),
      score: dampedScore(v.weighted, v.partnerCount),
      partnerCount: v.partnerCount,
      topPartners: v.partners
        .sort((x, y) => y.contribution - x.contribution)
        .slice(0, 5)
        .map(({ name, score, reasons }) => ({ name, score, reasons })),
    }))
    .sort(
      (x, y) =>
        y.score - x.score || y.partnerCount - x.partnerCount || x.name.localeCompare(y.name),
    );

  const names = new Set(cards.map((c) => c.name));
  const foundCombos = combos?.combosContainedIn(names) ?? [];
  const presentCommanders = cards.map((c) => c.name).filter((n) => commanderSet.has(n));

  const themeCounts = new Map<Tag, number>();
  const roles = { ramp: 0, draw: 0, removal: 0 };
  for (const card of cards) {
    const { produces } = extractTags(card);
    for (const tag of produces) themeCounts.set(tag, (themeCounts.get(tag) ?? 0) + 1);
    if (produces.has("ramp")) roles.ramp++;
    if (produces.has("card-draw")) roles.draw++;
    if (produces.has("removal")) roles.removal++;
  }
  // Same ordering rule cohesion uses (rankThemes) instead of a separate raw-count sort — the
  // list and the cohesion headline must not tell different stories about which theme leads.
  // themeCounts (produces only) and deckFreq (produces ∪ cares, below) are different tag
  // universes, so this can't fully unify with cohesion the way matcher's analyzeDeckStructured
  // does (same map, same call) — but ranking each by the same method keeps this list's
  // {tag,count} shape and values untouched while removing the raw-count-vs-weighted mismatch.
  const themes = rankThemes(themeCounts, TAG_STATS).map((tag) => ({ tag, count: themeCounts.get(tag)! }));

  const nonlandCount = cards.filter((c) => !c.typeLine.toLowerCase().includes("land")).length;
  const cohesion = computeCohesion(rankThemes(deckFreq, TAG_STATS), deckFreq, nonlandCount);

  const deckStats = computeDeckStats(cards);

  return {
    commanders: presentCommanders,
    cards: cardSynergies,
    edges,
    combos: foundCombos,
    themes,
    manaCurve: deckStats.manaCurve,
    landCount: deckStats.landCount,
    avgManaValue: deckStats.avgManaValue,
    medianManaValue: deckStats.medianManaValue,
    roles,
    cohesion,
  };
}
