import { minCopies } from "@edh-seer/engine";
import { castableManaCost } from "./split-cost.js";
import { minSources } from "./mulligan.js";
import { classifyLand, entersTapped } from "./land-conditions.js";
import type { DeckCard } from "./types.js";

/** The five colours, in WUBRG order. Colourless is deliberately absent HERE, and the reason the old
 *  one gave was false as a statement of the rules: "every deck can pay generic and colourless costs
 *  from any source" is true of GENERIC and false of COLOURLESS — `{C}` is payable only with
 *  colourless mana (CR 107.4c), which `goldfish.ts` now models as a sixth mask bit (roadmap N11).
 *
 *  What is true is narrower: THIS table counts COLOURED SOURCES against Karsten's published
 *  thresholds, and those thresholds are about coloured pips. A sixth entry would change what the
 *  table counts rather than correct it, so the feasibility question is asked one module over, where
 *  a board is available to ask it of. */
export const COLORS = ["W", "U", "B", "R", "G"] as const;
export type Color = (typeof COLORS)[number];

/** The confidence a coloured source count is held to. 90% is the external spec's own figure and the
 *  one its reference table is computed at, so a different value here would quietly invalidate every
 *  number that table anchors. */
export const SOURCE_CONFIDENCE = 0.9;

/** The five basic land types, lowercased, as `classifyLand` reports them in `subtypes`. */
const BASIC_LAND_TYPES = ["plains", "island", "swamp", "mountain", "forest"] as const;
const EMPTY_TYPES: ReadonlySet<string> = new Set<string>();

/** Coloured pips per colour in a mana cost, e.g. `{2}{B}{B}` -> `{ B: 2 }`.
 *
 *  Generic (`{2}`), `{X}` and `{C}` are not pips: they say nothing about which colours the deck has
 *  to produce, which is the only question here.
 *
 *  HYBRID AND PHYREXIAN COUNT FOR EACH COLOUR THEY NAME. `{B/R}` is a demand on black and on red,
 *  which OVERSTATES both -- either half satisfies the card, so a deck that can produce only one of
 *  them is fine. Deliberate: the alternative is to silently drop the demand, and a card that needs
 *  one of two colours still needs the deck to produce at least one. Read a hybrid row as an upper
 *  bound. */
export function pipsByColor(manaCost: string | undefined): Partial<Record<Color, number>> {
  const out: Partial<Record<Color, number>> = {};
  if (!manaCost) return out;
  for (const symbol of manaCost.match(/\{[^{}]+\}/g) ?? []) {
    const inner = symbol.slice(1, -1).toUpperCase();
    // `{2/B}` (monocolour hybrid) and `{B/P}` (Phyrexian) both reach the colour they name; a plain
    // `{X}`, `{C}` or a number reaches none.
    for (const color of COLORS) {
      if (inner.split("/").includes(color)) out[color] = (out[color] ?? 0) + 1;
    }
  }
  return out;
}

/** A card whose mana you can still be holding: everything except a one-shot spell.
 *
 *  A ritual adds mana ONCE, on resolution, and is then gone. Counting it as a source claims you can
 *  hold it to a 90% confidence, which is the one thing it can never do -- and it made the two
 *  castability axes count different universes, the mana axis lands-only and the colour axis every
 *  `producedMana` card including Dark Ritual. Definitional, not probabilistic: a one-shot is not a
 *  source at any confidence.
 *
 *  A permanent type anywhere on the type line wins, so an "Instant // Land" modal DFC still counts
 *  -- `typeLine` is the union of the faces (`splitTypeLine`), and the land half is a real source. */
export const isManaSource = (dc: DeckCard): boolean =>
  !/\b(instant|sorcery)\b/i.test(dc.card.typeLine)
  || /\b(artifact|creature|enchantment|land)\b/i.test(dc.card.typeLine);

/** One "N cards want this many pips by this turn" demand, and whether the deck supplies it. */
export interface ColorDemand {
  pips: number;
  /** The deadline: the card's own mana value. You want to cast a 3-drop on turn 3, which is a
   *  defensible assumption rather than a fitted parameter -- and it is the one place the spec's
   *  per-card idea kills a Tier C guess outright. */
  turn: number;
  /** Sources needed for `SOURCE_CONFIDENCE` of having `pips` of them by `turn`, WITH the free
   *  mulligan priced in (`mulligan.ts`). An UPPER BOUND on the mulligan's help: the keep band reads
   *  a hand's LAND count and this applies it to one colour, which a real player does not do. */
  required: number;
  /** The same figure with NO mulligan at all -- what this field held until 2026-08-25, and the other
   *  end of the interval. It UNDER-states by the same keep-rule mismatch `required` over-states by,
   *  so the truth sits between them and neither is deleted (roadmap L5, spec §11).
   *
   *  Absent only when no source count in the deck reaches the confidence raw, which cannot happen
   *  for a demand a real card presents. */
  requiredRaw: number;
  /** How many cards in the deck carry exactly this demand. */
  cards: number;
  /** THE SOURCES THAT COULD ACTUALLY BE PRODUCING BY `turn`, which is the number `met` is read
   *  against. `supplied` on the row is every source in the deck and is a true DECK fact; holding a
   *  turn-1 demand to it counted mana rocks that cost two and lands that enter tapped exactly then.
   *  Never greater than `supplied`. */
  available: number;
  /** `available >= required`. Read against `required` rather than `requiredRaw`, so the report
   *  UNDER-claims a shortfall rather than over-claiming one: anchoring on `requiredRaw` instead told
   *  62 of the 71 calibration decks they were short by a median of ten sources, off a model measured
   *  to over-state by up to fourteen. */
  met: boolean;
}

export interface ManaAuditRow {
  color: Color;
  /** Cards in the LIBRARY that can produce this colour, on ANY turn. Excludes commanders:
   *  `required` is computed against a library that does not contain them either.
   *
   *  A DECK FACT, AND THE WRONG NUMBER TO HOLD AN EARLY DEMAND TO -- see `ColorDemand.available`,
   *  which is what `met` reads. */
  supplied: number;
  demands: ColorDemand[];
  /** The demand that misses by the most sources, absent when every demand is met. This is the row
   *  worth showing: "your double-black is a turn 5 spell in practice". */
  worst?: ColorDemand;
}

/** Per-card colour feasibility: what each card's own pips demand by its own deadline, against what
 *  the deck can produce. Exact, per deck, Tier A.
 *
 *  This is the thing a land-count regression fundamentally cannot do -- Karsten has no colour term
 *  at all, which is correct for COUNT and silent about COMPOSITION.
 *
 *  TWO OF THE THREE THINGS IT DID NOT MODEL ARE MODELLED NOW, per demand, in `available` (T18b).
 *  They were found because the panel printed *"R, 25 sources, enough"* beside the simulator's *"Curse
 *  of Opulence, turn 1, 40%"* -- one card, one turn, one screen, two models that never met:
 *  - **Tapped lands.** A land that enters tapped is not a source for a demand due the turn it would
 *    arrive. Asked of `land-conditions.ts`, the same classifier the simulator uses, so a slow land
 *    is tapped for a turn-1 demand and untapped for a turn-3 one rather than flatly one or the other.
 *  - **Rocks are sources but not ramp.** A Signet is a source on the turn AFTER it is cast, never on
 *    turn one, and a nonland source now counts only for a demand due later than its own mana value.
 *
 *  ONE REMAINS, and it is the one no turn number fixes:
 *  - **Conditional production.** `producedMana` is what a card CAN add: "any color" lists all five,
 *    and a source gated behind a condition counts the same as a basic.
 *
 *  ONE THING IT NO LONGER GETS WRONG: the requirement is priced WITH the free mulligan. `required`
 *  was `minCopies` alone until 2026-08-25 -- raw hypergeometric, the same model that read 37 lands
 *  as an 80% three-land-drop deck before `mulligan.ts` corrected it to 90.3%. Raw, {C}{C} by turn 2
 *  "needs" 36 sources of 99 and {C}{C}{C} by turn 3 "needs" 44, and 139 of the 71 decks' 153 colour
 *  rows carried an unmet demand off those numbers. Both ends now ship (`required`, `requiredRaw`):
 *  the keep band reads LANDS, so applying it to one colour over-states the mulligan's help exactly
 *  as ignoring it under-states, and the truth is between. Roadmap L5, spec §11.
 *
 *  One thing it does NOT do any more: a one-shot ritual is not a source (`isManaSource`). Measured
 *  over the 71 calibration decks, 139 of 3,197 `producedMana` library cards were one-shots, moving
 *  `supplied` on 103 of 153 colour rows and flipping 59 of 1,250 demands from met to unmet, with 9
 *  colours acquiring a `worst` row they did not report before.
 *
 *  It also says nothing about how many lands to run -- pip density drives composition only. */
export function manaAudit(
  deck: readonly DeckCard[],
  opts: { commanderNames?: readonly string[] } = {},
): ManaAuditRow[] {
  const commanders = new Set(opts.commanderNames ?? []);
  const library = deck.filter((dc) => !commanders.has(dc.card.name));

  // The basic land types the deck's own lands carry, lowercased to match `classifyLand`'s subtypes.
  // A check land ("unless you control a Mountain") is satisfiable only if the deck runs something
  // with that type at all, so this is the ceiling on the optimistic board below.
  const deckBasicTypes = new Set<string>();
  for (const dc of library) {
    if (!/\bland\b/i.test(dc.card.typeLine)) continue;
    for (const t of BASIC_LAND_TYPES) if (dc.card.typeLine.toLowerCase().includes(t)) deckBasicTypes.add(t);
  }

  const rows: ManaAuditRow[] = [];
  for (const color of COLORS) {
    const sources = library.filter(
      (dc) => isManaSource(dc) && (dc.card.producedMana ?? []).includes(color),
    );
    const supplied = sources.length;

    // WHAT COULD BE PRODUCING BY TURN N, asked once per deadline and cached, because a deck's
    // demands share very few distinct turns.
    //
    // THE BOARD IS THE OPTIMISTIC ONE, deliberately: on turn N you have made N-1 earlier land drops,
    // and this assumes every one of them was the land a conditional wanted. That is the same
    // under-claiming direction `met` already takes with `required` over `requiredRaw` -- the report
    // would rather miss a shortfall than invent one.
    //
    // CEILING: a nonland source counts from the turn after its own mana value, which assumes it was
    // cast on curve. Pricing how often that actually happens needs the simulator, and the simulator
    // is the other half of this pair; a turn number is the cheap half that closes the contradiction.
    const availableAt = new Map<number, number>();
    const availableBy = (turn: number): number => {
      const hit = availableAt.get(turn);
      if (hit !== undefined) return hit;
      // The lands already down when the turn-N drop is made. Empty on turn 1, which is what makes a
      // slow land tapped exactly then.
      const board = {
        lands: turn - 1,
        basics: turn - 1,
        types: turn > 1 ? deckBasicTypes : EMPTY_TYPES,
        opponents: 3,
      };
      const n = sources.filter((dc) => {
        if (/\bland\b/i.test(dc.card.typeLine)) return !entersTapped(classifyLand(dc.card), board);
        // A rock cast on turn M taps for mana from turn M+1: you spent the turn's mana casting it.
        return dc.card.manaValue < turn;
      }).length;
      availableAt.set(turn, n);
      return n;
    };

    // Group by (pips, deadline): "12 cards want {B}{B} by T3" is one row, not twelve.
    const groups = new Map<string, ColorDemand>();
    for (const dc of library) {
      // THE SAME SPLIT-CARD FICTION, AND IT SURFACED HERE FIRST. `Dusk // Dawn`'s joined
      // "{2}{W}{W} // {3}{W}{W}" read as a FOUR-white-pip demand on turn nine, which was the entire
      // content of the precon's only colour warning — a requirement for 31 white sources generated
      // by a cost no player pays. Two readers of one string produced the same fiction independently,
      // which is why the correction lives in `split-cost.ts` rather than in either of them.
      const pips = pipsByColor(castableManaCost(dc.card))[color];
      if (!pips) continue;
      // A 0-drop still has to be castable on turn 1 -- there is no turn 0 to draw into.
      const turn = Math.max(1, Math.round(dc.card.manaValue));
      const key = `${pips}:${turn}`;
      const existing = groups.get(key);
      if (existing) {
        existing.cards++;
        continue;
      }
      const requiredRaw = minCopies(pips, turn, SOURCE_CONFIDENCE, library.length);
      // `minSources` searches a 99-card deck while `minCopies` is told the real library size, so the
      // pair is not perfectly commensurable on a deck that lost cards to resolution -- and the raw
      // figure is the conservative end, so the corrected one is clamped never to exceed it rather
      // than allowed to read HIGHER than the model it corrects (criterion S2).
      const required = Math.min(requiredRaw, minSources(pips, turn, SOURCE_CONFIDENCE) ?? requiredRaw);
      const available = availableBy(turn);
      groups.set(key, { pips, turn, required, requiredRaw, cards: 1, available, met: available >= required });
    }
    if (groups.size === 0) continue;

    const demands = [...groups.values()].sort(
      (a, b) => b.pips - a.pips || a.turn - b.turn || b.cards - a.cards,
    );
    const unmet = demands.filter((d) => !d.met);
    rows.push({
      color,
      supplied,
      demands,
      // Ranked by the SHORTFALL, not by pip count: a 2-pip demand met with room to spare matters
      // less than a 1-pip demand the deck misses by ten sources. Each demand's shortfall is read
      // against its OWN `available`, since two demands on one colour no longer share a supply.
      worst: unmet.sort((a, b) => (b.required - b.available) - (a.required - a.available))[0],
    });
  }
  return rows;
}
