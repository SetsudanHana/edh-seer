import type { DeckCard, Hierarchy } from "./types.js";
import { cardSupplyTags } from "./edges.js";
import { subsumptionMap } from "./hierarchy.js";
import { makeFold } from "./theme-fold.js";

/** DECK FIT: a condition naming something the deck does not have (owner, 2026-08-20). "If you have
 *  a card that cares about red permanents and have none, it is not a very good card in the deck."
 *  `conditionCares` states the demand as a theme tag and the cards' supply tags state what the deck
 *  has, so this is a JOIN over what is computed rather than new analysis.
 *
 *  FOLDED, because supply is keyed FINER than demand: a planeswalker's own entry themes at its
 *  SUBTYPE (`enters:liliana`), while Oath of Liliana asks for `enters:planeswalker`. That is the
 *  same predicate `computeCohesion` settled on -- `tag === want || fold(tag) === want`.
 *
 *  A NARROWER SUPPLIER MEETS A WIDER DEMAND (#1166): "if you descended" asks for a permanent dying
 *  (`dies:permanent`, CR 700.11) and a creature dying (`dies:creature`) is one. `subsumptionMap` is the
 *  one helper that knows `creature` is inside `permanent`; a hand-rolled list would be a second one.
 *
 *  The card's OWN tags are excluded: Warlock Class must not satisfy its own demand for a creature
 *  dying. A card with no condition, or one whose demand the deck meets, reports nothing.
 *  Returns the unmet demand tags by physical card name. */
export function unmetConditionTags(resolved: readonly DeckCard[], hierarchy: Hierarchy): Map<string, string[]> {
  const foldFit = makeFold(hierarchy);
  const suppliedTags = new Map<string, Set<string>>();
  for (const dc of resolved) {
    if (!dc.tags) continue;
    for (const tag of cardSupplyTags(dc.tags)) {
      for (const key of new Set([tag, foldFit(tag)])) {
        const set = suppliedTags.get(key) ?? new Set<string>();
        set.add(dc.card.name);
        suppliedTags.set(key, set);
      }
    }
  }
  const allWants = resolved.flatMap((dc) => (dc.tags?.abilities ?? []).flatMap((a) => a.conditionCares ?? []));
  const narrower = subsumptionMap([...suppliedTags.keys(), ...allWants]);
  const unmetByCard = new Map<string, string[]>();
  for (const dc of resolved) {
    if (!dc.tags) continue;
    const wants = [...new Set(dc.tags.abilities.flatMap((a) => a.conditionCares ?? []))];
    const unmet = wants.filter((w) => {
      const suppliers = new Set(suppliedTags.get(w));
      for (const t of narrower.get(w) ?? []) for (const n of suppliedTags.get(t) ?? []) suppliers.add(n);
      return [...suppliers].every((n) => n === dc.card.name);
    });
    if (unmet.length > 0) unmetByCard.set(dc.card.name, unmet);
  }
  return unmetByCard;
}
