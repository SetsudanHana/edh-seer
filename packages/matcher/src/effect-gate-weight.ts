/** A GATED EFFECT STILL COUNTS, WEIGHTED BY HOW LIKELY ITS CONDITION IS TO HOLD IN THIS DECK (#1357 task 2; owner ruling 2026-10-27). Derive records the trailing "if <condition>" of an effect on its ability (`Ability.gate`,
 *  parsed by the same `parseGate` as a mana line's gate); this module is the ONE place that turns it into a number in [0, 1], so the role counts, the land recommendation and the goldfish cannot disagree about how much
 *  Inspiring Call's cousins are worth in a deck.
 *
 *  FOUR BASES, and the report says which (`EffectWeight.basis`):
 *   - `ungated`: no gate, weight 1, not conditional.
 *   - `evaluated`: a gate a decklist settles (a board count, a graveyard count, an event this turn, counters the card puts on itself): `gateProbability`, the SAME evaluator a mana line's gate uses, at the same median clock.
 *     It may be 0: Roadside Reliquary's artifact draw in a deck with no artifact is worth nothing, which is the ruling's "basically nothing without it".
 *   - `supply`: a condition derive could not parse but whose DEMAND it named (`conditionCares`: "if you control a permanent with a counter on it" wants `counter-added:any`). The chance the deck has at least one
 *     card that supplies the demand among the cards seen by the median clock (`pAtLeast(1, suppliers, seen(CORPUS_MEDIAN_CLOCK), size)`), the holder excluded: a card's own counter is no counters deck (Federation Field Medic).
 *     The demand is a REASON the gate is judged by and never an edge (ruling 2026-08-20): nothing here adds a pair.
 *   - `unreadable`: a condition no decklist settles (an opponent's board or hand, a spell an opponent cast this turn, a game state) or one this reader does not parse: the FIXED partial weight `UNREADABLE`
 *     (effect-gate-weight.json), flagged conditional. Never 1 (a sure effect) and never 0.
 *
 *  CEILING: more than one demand on a gate takes the LOWEST chance of them (an under-claim: "twenty counters or twenty cards in hand" is an or). CEILING: `supply` counts that a card exists, not that it lands on the
 *  holder's turn or its board. CEILING: a `counter` gate is judged only where the matcher knows who puts the counters (`put`, mana lines); an effect's "it has seven or more phyresis counters" has no `put` and is `unreadable`.
 *  CEILING: `entered-this-turn` and `opponent-cast` are `unreadable` (gate.ts answers 0 for both: unmet in a mana line, which is the safe direction there; an effect that is never zero must not read that 0). */
import { pAtLeast, seen } from "@edh-seer/engine";
import type { Ability, Gate } from "@edh-seer/tagger";
import { CORPUS_MEDIAN_CLOCK } from "./corpus-clock.js";
import { conditionSupply } from "./deck-fit.js";
import config from "./effect-gate-weight.json" with { type: "json" };
import { gateProbability } from "./gate.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** The fixed weight of a gated effect nothing settles. */
export const UNREAD_WEIGHT: number = config.unreadable;

export type EffectBasis = "ungated" | "evaluated" | "supply" | "unread";

export interface EffectWeight {
  /** In [0, 1]. */
  weight: number;
  /** The effect sits behind a condition (any basis but `ungated`): the report says "conditional". */
  conditional: boolean;
  basis: EffectBasis;
  /** The condition, verbatim lowercase (`Gate.text`), for a display. Absent when ungated. */
  needs?: string;
}

export interface GateWeigher {
  /** The weight of one ability of `holder` in this deck. */
  of(ability: Ability, holder: DeckCard): EffectWeight;
}

const UNGATED: EffectWeight = { weight: 1, conditional: false, basis: "ungated" };
const clamp = (p: number): number => Math.min(1, Math.max(0, p));

/** The gate kinds whose chance `gateProbability` answers FOR AN EFFECT. A `counter` gate is one only when the matcher knows who puts the counters; the two turn events no decklist supplies are not. */
function evaluable(g: Gate): boolean {
  if (g.kind === "unknown") return false;
  if (g.kind === "counter") return g.put !== undefined;
  if (g.kind === "turn-event") return g.event !== "opponent-cast" && g.event !== "entered-this-turn";
  return true;
}

/** THE WEIGHER FOR ONE DECK (the whole decklist, commanders included, as gate.ts asks). The supplier index is built on first use, so a deck with no gated effect pays nothing. */
export function makeGateWeigher(deck: readonly DeckCard[], hierarchy: Hierarchy = {}): GateWeigher {
  let supply: ((want: string) => Set<string>) | undefined;
  const suppliers = (want: string, holder: DeckCard): number => {
    supply ??= conditionSupply(deck, hierarchy);
    return [...supply(want)].filter((n) => n !== holder.card.name).length;
  };
  return {
    of(a, holder) {
      const g = a.gate;
      if (g === undefined) return UNGATED;
      const needs = g.text;
      if (evaluable(g)) {
        const p = gateProbability(g, deck);
        if (p !== null) return { weight: clamp(p), conditional: true, basis: "evaluated", needs };
      }
      const wants = a.conditionCares ?? [];
      if (g.kind === "unknown" && wants.length > 0) {
        const chances = wants.map((w) => pAtLeast(1, suppliers(w, holder), seen(CORPUS_MEDIAN_CLOCK), deck.length));
        return { weight: clamp(Math.min(...chances)), conditional: true, basis: "supply", needs };
      }
      return { weight: UNREAD_WEIGHT, conditional: true, basis: "unread", needs };
    },
  };
}
