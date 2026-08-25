import type { DeckCard } from "./types.js";
import { isManaSource } from "./mana-audit.js";
import { classifyLand, entersTapped, type LandCondition } from "./land-conditions.js";
import { DEFAULT_POD_SIZE, opponents } from "./format.js";

/** THE MANA AVAILABILITY MODEL — a seeded goldfish simulation with a WRITTEN PLAY POLICY, because
 *  the policy IS the model (roadmap I11, `specs/2026-08-22-mana-availability-model-design.md`).
 *
 *  WHY A SIMULATOR AND NOT A COEFFICIENT. A fitted coefficient against these 71 decks is the thing
 *  that died three times in this repo (the supply:demand discount, twice more under re-registration);
 *  a stated policy is auditable, and every number below can be argued with by reading rule 1-5.
 *
 *  WHAT IT REPLACES: nothing yet. This is a leaf module and a bin — **nothing imports it into
 *  `pressure.ts`, `deck-math.ts` or any score**, which is the condition the K7/J7 reconciliation
 *  holds under. Report wiring is its own later item, and it is where the refused quantities could
 *  leak into a headline.
 *
 *  THE DEFECT IT EXISTS FOR, measured on the owner's own deck: `castability.ts` ships an INTERVAL
 *  whose contract is "the truth is between them", and on `samut.txt` at turn 6 that pair reads
 *  [34.1%, 43.5%] against a simulated 55.8% — because `manaWithRocks` counts three sources for a
 *  green land-ramp deck. Farseek, Nature's Lore, Three Visits, Cultivate, Kodama's Reach and Shared
 *  Roots are all invisible to it: a land-fetch spell produces no mana of its own and `isManaSource`
 *  correctly refuses an instant or sorcery.
 *
 *  AND A SECOND DEFECT THE CLOSED FORM CANNOT FIX: `pAtLeast` NEVER CAPS LAND DROPS.
 *  `pAtLeast(4, 37, seen(3), 99)` answers 55.5% — four mana on turn three, off three land drops.
 *  Sound only where `turn === manaValue`, which is the only place it is called today, and unusable
 *  for the off-diagonal curve this module produces.
 *
 *  CEILINGS, and the first one governs every other number here:
 *  - **NO EXTERNAL GROUND TRUTH EXISTS.** Nothing in this repo can tell a simulated 55.8% from a
 *    true 58%. The closed-form anchors bound the MECHANICAL error; the POLICY error is bounded only
 *    by the sensitivity arm.
 *  - **THE DRAW BIAS SURVIVES**: rule 5 casts no cantrips, so `seen(T) = 7 + T` is as wrong here as
 *    in the closed form.
 *  - **COLOURS ARE IGNORED ENTIRELY**, which is why nothing here is called "castable" — for Samut,
 *    `{3}{R}{G}{W}`, "P(castable by T6)" would be a wrong sentence. It is P(six mana), and three of
 *    those six must be specific colours nothing here checks.
 *  - **ONE-SHOT MANA IS DROPPED, AND NOT OBVIOUSLY CONSERVATIVELY**: Big Score's Treasures PERSIST,
 *    and rituals really do enable a turn.
 *  - **ACCELERANT VALUE IS +1 FLAT.** Enduring Vitality scales with creatures; Sol Ring makes two.
 *  - **NO OPPONENT.** Nothing is Stax'd, countered or killed.
 *
 *  **THE WHOLE-ITEM FALSIFIER FIRED, AND THIS IS THE RECORDED OUTCOME (2026-08-25).** The design
 *  registered it before any number existed: *"if the anchors pass but C8 shows policy noise on the
 *  order of the ramp signal, the verdict is that mana availability is a POLICY property at this
 *  deck's scale, the point readout is WITHDRAWN, and what survives is the interval."*
 *
 *  **THE ANCHORS PASS AND C8 TRIGGERS. Measured over the 71 decks at 20k trials: holding up two mana
 *  before casting an accelerant moves the headline cell by up to 27.6pp, against a MEDIAN RAMP
 *  SIGNAL of 32.7pp** — 84% of the effect this module exists to measure, where the demotion rule
 *  fires at 50%. So `goldfish-report.ts` prints a PAIR of policies and never one number, and any
 *  future report wiring inherits that: **the greedy arm is a CEILING, the hold-up-2 arm is nearer how
 *  a real deck is played, and the truth is between them.** The same resolution `castability.ts`
 *  already reached, for the same reason, and it is a recordable outcome rather than a failure —
 *  which is what separates this from the clock it sits beside. */

/** Mulberry32. A named, seeded generator so every figure is reproducible — `Math.random` is banned
 *  by test, because a Monte Carlo whose output moves between runs cannot be a ratchet baseline. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type AccelerantKind =
  /** A noncreature permanent that taps for mana. NO SUMMONING SICKNESS (CR 302.6 restricts
   *  creatures), so it pays the turn it lands — delaying Sol Ring a full turn in every trial is a
   *  silent wrong answer, and the first draft of this policy did exactly that. */
  | "rock"
  /** A creature that taps for mana. Genuinely waits a turn. */
  | "dork"
  /** A spell that puts a LAND onto the battlefield. It does not consume the land drop, and the land
   *  it fetches follows its own tapped state — Nature's Lore fetches untapped, Kodama's Reach
   *  fetches tapped, and the spell's own text is what says which. */
  | "land-fetch";

export interface Accelerant {
  name: string;
  manaValue: number;
  kind: AccelerantKind;
  /** `land-fetch` only: the fetched land arrives tapped. */
  fetchTapped?: boolean;
}

/** A spell that puts a land onto the battlefield — the same two cues `rules.json`'s
 *  `ramp.landFetchSpell` already pairs, kept here rather than routed through the rule engine because
 *  this module needs the TAPPED half too and a rule row carries no payload. */
const LAND_FETCH = /search your library for (?:a |an |up to \w+ )?(?:basic )?(?:land|forest|island|swamp|mountain|plains)/i;
const ONTO_BATTLEFIELD = /onto the battlefield/i;
const FETCHES_TAPPED = /onto the battlefield tapped/i;

/** What kind of accelerant a card is, or null. Read from PRINTED data only — `producedMana` and the
 *  type line — because a play policy that depends on derivation would move whenever derivation did. */
export function classifyAccelerant(dc: DeckCard): Accelerant | null {
  const line = (dc.card.typeLine ?? "").toLowerCase();
  const name = dc.card.name;
  const manaValue = dc.card.manaValue ?? 0;
  if (/\bland\b/.test(line)) return null; // a land is a land drop, never an accelerant cast
  const text = dc.card.oracleText ?? "";
  if (LAND_FETCH.test(text) && ONTO_BATTLEFIELD.test(text)) {
    return { name, manaValue, kind: "land-fetch", fetchTapped: FETCHES_TAPPED.test(text) };
  }
  // A ONE-SHOT IS NOT A SOURCE at any confidence — `isManaSource`'s own ruling, and the measured
  // reason it exists (139 of 3,197 `producedMana` library cards are rituals). Dark Ritual really
  // does enable a turn, which is a stated ceiling and not an oversight.
  if (!isManaSource(dc) || (dc.card.producedMana ?? []).length === 0) return null;
  return { name, manaValue, kind: /\bcreature\b/.test(line) ? "dork" : "rock" };
}

interface DeckSlot {
  name: string;
  manaValue: number;
  typeLine: string;
  isLand: boolean;
  land?: LandCondition;
  accelerant?: Accelerant | null;
}

export interface SimulateOptions {
  trials?: number;
  turns?: number;
  seed?: number;
  podSize?: number;
  /** THE ALTERNATIVE POLICY ARM, and the only knob in this module (C8). Mana the player keeps back
   *  before casting an accelerant — the owner's own decks hold up interaction, and rule 3's greedy
   *  spend never does. NOT A TUNING SURFACE: it exists to SIZE the policy error, and if that error
   *  rivals the ramp signal the point readout is withdrawn and an interval ships. */
  holdUp?: number;
}

export interface SimulateResult {
  trials: number;
  turns: number;
  /** Per turn (1-indexed into `[turn - 1]`), one entry per trial: the mana the board could TAP.
   *
   *  PRODUCTION, NOT WHAT IS LEFT AFTER THE POLICY SPENDS. Rule 3 casts accelerants greedily, so in
   *  a trial where mana went into a rock that same mana is not also available for a spell — which is
   *  exactly why §7 calls every output here a CEILING UNDER A MANA-MAXIMISING POLICY rather than an
   *  expectation. A player who wants to cast a spell simply does not cast the rock. */
  manaAt: number[][];
  /** Per turn, per trial: the share of the deck's NONLANDS whose mana value this trial could pay.
   *
   *  COMPUTED INSIDE THE TRIAL, which is the whole point — the original design glued "median mana
   *  that turn" to "share of nonlands at or under it", two medians from different distributions
   *  presented as one fact, and a reader multiplies them. Named `payableShareAt` and never
   *  `castableShare`: the model is colour-blind, and a field name is exactly where a banned word
   *  creeps back in. */
  payableShareAt: number[][];
  /** Per card, per turn: P(the board could tap at least that card's mana value by then). Still not
   *  "castable" — see the colour ceiling. */
  byCard: Map<string, number[]>;
}

/** Lands on the battlefield, as a conditional land reads them at the moment it would enter. */
interface OnBoardLand { cond: LandCondition; enteredTurn: number; enteredTapped: boolean; typeLine: string }

function boardFor(lands: OnBoardLand[], pod: number): { lands: number; basics: number; types: Set<string>; opponents: number } {
  const types = new Set<string>();
  let basics = 0;
  for (const l of lands) {
    const line = l.typeLine.toLowerCase();
    for (const t of ["plains", "island", "swamp", "mountain", "forest"]) if (line.includes(t)) types.add(t);
    if (line.includes("basic")) basics++;
  }
  return { lands: lands.length, basics, types, opponents: opponents(pod) };
}

export function simulate(deck: readonly DeckCard[], opts: SimulateOptions = {}): SimulateResult {
  const trials = opts.trials ?? 20_000;
  const turns = opts.turns ?? 8;
  const pod = opts.podSize ?? DEFAULT_POD_SIZE;
  const random = rng(opts.seed ?? 1);
  const holdUp = opts.holdUp ?? 0;

  const slots: DeckSlot[] = deck.map((dc) => {
    const isLand = /\bland\b/i.test(dc.card.typeLine ?? "");
    return {
      name: dc.card.name,
      manaValue: dc.card.manaValue ?? 0,
      typeLine: dc.card.typeLine ?? "",
      isLand,
      ...(isLand ? { land: classifyLand(dc.card) } : { accelerant: classifyAccelerant(dc) }),
    };
  });
  const nonlands = slots.filter((s) => !s.isLand);

  const manaAt: number[][] = Array.from({ length: turns }, () => [] as number[]);
  const payableShareAt: number[][] = Array.from({ length: turns }, () => [] as number[]);
  const byCardHits = new Map<string, number[]>();
  for (const s of nonlands) if (!byCardHits.has(s.name)) byCardHits.set(s.name, Array(turns).fill(0));

  for (let t = 0; t < trials; t++) {
    const library = [...slots];
    // Fisher-Yates against the seeded generator, so a run is reproducible card-for-card.
    for (let i = library.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [library[i], library[j]] = [library[j], library[i]];
    }
    const hand: DeckSlot[] = library.splice(0, 7);
    const lands: OnBoardLand[] = [];
    const rocks: number[] = [];   // the turn each landed
    const dorks: number[] = [];

    for (let turn = 1; turn <= turns; turn++) {
      // Rule 1: one card per turn, INCLUDING turn 1. On the play there is no turn-1 draw; modelling
      // the draw is the flattering direction by one card and is stated rather than hidden.
      const drawn = library.shift();
      if (drawn) hand.push(drawn);

      // Rule 2: one land per turn, preferring whichever enters UNTAPPED given the board right now.
      // GREEDY AND OCCASIONALLY WRONG — a player with spare mana banks the untapped land and plays
      // the tapped one first. Direction pessimistic, and small.
      const board = boardFor(lands, pod);
      const landIdx = hand.findIndex((c) => c.isLand && c.land && !entersTapped(c.land, board));
      const idx = landIdx >= 0 ? landIdx : hand.findIndex((c) => c.isLand);
      if (idx >= 0) {
        const played = hand.splice(idx, 1)[0];
        lands.push({
          cond: played.land!,
          enteredTurn: turn,
          enteredTapped: entersTapped(played.land!, board),
          typeLine: played.typeLine,
        });
      }

      // A land contributes unless it entered TAPPED this very turn. A rock pays the turn it lands
      // (CR 302.6); a dork waits one.
      const production = (): number =>
        lands.filter((l) => !(l.enteredTapped && l.enteredTurn === turn)).length
        + rocks.filter((r) => r <= turn).length
        + dorks.filter((d) => d < turn).length;

      // Rule 3: spend on accelerants, cheapest first, greedily. THIS RULE DOES NEARLY ALL THE WORK,
      // and it is what makes every output a ceiling: the owner's own decks hold mana up for
      // interaction, and this one never does.
      let pool = production();
      for (;;) {
        let best = -1;
        for (let i = 0; i < hand.length; i++) {
          const a = hand[i].accelerant;
          if (!a || hand[i].manaValue > pool - holdUp) continue;
          if (best < 0 || hand[i].manaValue < hand[best].manaValue) best = i;
        }
        if (best < 0) break;
        const cast = hand.splice(best, 1)[0];
        pool -= cast.manaValue;
        const a = cast.accelerant!;
        if (a.kind === "rock") { rocks.push(turn); pool += 1; }
        else if (a.kind === "dork") dorks.push(turn);
        else {
          // A FETCHED LAND DOES NOT CONSUME THE LAND DROP — it is put onto the battlefield, not
          // played — and it follows its own tapped state, which the spell's text states.
          // A FETCHED LAND'S IDENTITY IS UNKNOWN TO THIS MODEL — the spell says "a basic land" or
          // "a Forest" and the trial never chooses one. It counts as a LAND and as NEITHER a basic
          // nor a type, which is the pessimistic direction for every other conditional land on the
          // board: fewer suppliers means more of them enter tapped. Stated rather than guessed.
          lands.push({ cond: { template: "none", subtypes: [], bounces: false }, enteredTurn: turn, enteredTapped: a.fetchTapped === true, typeLine: "" });
          if (a.fetchTapped !== true) pool += 1;
        }
      }

      const made = production();
      manaAt[turn - 1].push(made);
      let payable = 0;
      for (const s of nonlands) {
        if (s.manaValue <= made) {
          payable++;
          byCardHits.get(s.name)![turn - 1]++;
        }
      }
      payableShareAt[turn - 1].push(nonlands.length > 0 ? payable / nonlands.length : 0);
    }
  }

  const byCard = new Map<string, number[]>();
  for (const [name, hits] of byCardHits) byCard.set(name, hits.map((h) => h / trials));
  return { trials, turns, manaAt, payableShareAt, byCard };
}

/** P(at least `m` mana by turn `t`) straight off a run. */
export function pAtLeastMana(result: SimulateResult, m: number, turn: number): number {
  const col = result.manaAt[turn - 1] ?? [];
  return col.length === 0 ? 0 : col.filter((v) => v >= m).length / col.length;
}

/** The spread, never just the middle — a median with no p25/p75 beside it invites the reader to
 *  treat a distribution as a number. */
export function quantiles(values: readonly number[]): { p25: number; median: number; p75: number } {
  if (values.length === 0) return { p25: 0, median: 0, p75: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (q: number): number => s[Math.min(s.length - 1, Math.floor(q * s.length))];
  return { p25: at(0.25), median: at(0.5), p75: at(0.75) };
}
