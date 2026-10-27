/** A GATED EFFECT STILL COUNTS, WEIGHTED BY HOW LIKELY ITS CONDITION IS TO HOLD IN THIS DECK (#1357 task 2; owner ruling 2026-10-27). Derive records the trailing "if <condition>" of an effect on its ability (`Ability.gate`,
 *  parsed by the same `parseGate` as a mana line's gate); this module is the ONE place that turns it into a number in [0, 1], so the role counts, the land recommendation and the goldfish cannot disagree about how much
 *  a gated draw is worth in a deck.
 *
 *  SIX BASES, and the report says which (`EffectWeight.basis`):
 *   - `ungated`: no gate, weight 1, not conditional.
 *   - `evaluated`: a gate a decklist settles (a board count, a graveyard count, an event this turn, counters the card puts on itself): `gateProbability`, the SAME evaluator a mana line's gate uses, at the same median
 *     clock. A READABLE condition the deck has no support for weighs EXACTLY 0 (owner ruling 2026-10-27 A: Roadside Reliquary's enchantment draw with no enchantments "basically does nothing").
 *   - `supply`: a condition derive could not parse but whose DEMAND it named (`conditionCares`: "if you control a permanent with a counter on it" wants `counter-added:any`). The chance the deck has at least one
 *     card that supplies the demand among the cards seen by the median clock (`pAtLeast(1, suppliers, seen(CORPUS_MEDIAN_CLOCK), size)`), the holder excluded: a card's own counter is no counters deck (Federation
 *     Field Medic). No supplier is exactly 0, as above. The demand is a REASON the gate is judged by and never an edge (ruling 2026-08-20): nothing here adds a pair.
 *   - `unread`: a condition NOTHING here can read (an opponent's board or hand, a spell an opponent cast this turn, a game state, the game's speed or initiative, or one this reader does not parse): the FIXED partial weight
 *     `UNREAD_WEIGHT` (effect-gate-weight.json), flagged conditional. Only an unreadable condition keeps it; it is never a sure effect.
 *   - `target`: a condition on the effect's own TARGET ("counter target spell if it's blue"): a targeting restriction and no weight, whole (`target-condition.ts`). The report marks the card a narrow answer.
 *
 *   - `choice`: an optional-cost condition ("if this spell was kicked / bargained", "if the gift was promised"): the PLAYER's choice, weight 1, flagged so the report says "when kicked" (`choice-condition.ts`, owner ruling 2026-10-27).
 *
 *  `speed` and `initiative` are evaluated by `gateProbability` for a MANA LINE (speed 4 from turn 4, initiative if a card takes it) and read as sure when no turn is asked. For an effect they are `unread` instead: an
 *  opponent can take the initiative and speed rises only as opponents lose life, so a sure 1 would be the very thing the ruling forbids.
 *
 *  CEILING: ONE CLOCK. An effect gate is judged at the single median clock (turn 9, `CORPUS_MEDIAN_CLOCK`), as a mana line's deck-level verdict is; a gate that holds early and fails late (a land drop this turn) or the other way round is
 *  read at turn 9 for every ability of every kind. CEILING: more than one demand on a gate takes the LOWEST chance of them (an under-claim: "twenty counters or twenty cards in hand" is an or). CEILING: `supply` counts that a
 *  card exists, not that it lands on the holder's turn or its board, and the COMMANDER counts as a supplier and as one of the hundred (gate.ts's own rule, owner 2026-10-13: it is a card of the deck), though it is not
 *  drawn from the library. CEILING: a `counter` gate is judged only where the matcher knows who puts the counters (`put`, mana lines); an effect's "it has seven or more phyresis counters" has no `put` and is `unread`.
 *  CEILING: `entered-this-turn` and `opponent-cast` are `unread` (gate.ts answers 0 for both: unmet in a mana line, the safe direction there; an unreadable effect condition must not read that 0). */
import { pAtLeast, seen } from "@edh-seer/engine";
import type { Ability, Gate } from "@edh-seer/tagger";
import { CORPUS_MEDIAN_CLOCK } from "./corpus-clock.js";
import { conditionSupply } from "./deck-fit.js";
import config from "./effect-gate-weight.json" with { type: "json" };
import { isChoiceCondition } from "./choice-condition.js";
import { gateProbability } from "./gate.js";
import { isTargetCondition } from "./target-condition.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** The fixed weight of a gated effect nothing settles. */
export const UNREAD_WEIGHT: number = config.unreadable;

export type EffectBasis = "ungated" | "evaluated" | "supply" | "unread" | "target" | "choice";

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
  if (g.kind === "unknown" || g.kind === "speed" || g.kind === "initiative") return false;
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
      // A CONDITION ON THE TARGET RESTRICTS WHAT THE CARD ANSWERS; it does not make the effect chancy (owner ruling 2026-10-27 C): whole weight, flagged `target` so the report names it narrow.
      if (isTargetCondition(holder.card.oracleText, needs)) return { weight: 1, conditional: true, basis: "target", needs };
      // AN OPTIONAL COST IS A CHOICE, not a chance (owner ruling 2026-10-27): whole, flagged.
      if (g.kind === "unknown" && isChoiceCondition(needs)) return { weight: 1, conditional: true, basis: "choice", needs };
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
