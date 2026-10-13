import { loadRules, ruleMatches } from "./rules.js";
import { RAMP_RESILIENCE } from "./mana-base.js";
import { cardLines, paidWithResource } from "./mana-lines.js";
import { countsAsLand } from "./typeline.js";
import type { DeckCard } from "./types.js";

/** WHAT A RAMP-ROLE CARD IS WHEN THE GOLDFISH DOES NOT PLAY IT AS AN ACCELERANT (#1190, Fable round 2 finding 1). The land target weighed every such card 0.15 as "a one-shot" and the
 *  report called them "one-shots, like a ritual or a Treasure", which Birgi (trigger mana) and Phyrexian Altar (a sacrifice outlet) are not. The class is read from the card's derived
 *  mana lines (`CardTags.manaLines`, `landFetch`, `isOneShot`), the same record every other mana reader asks.
 *
 *  - `land`: a land in the Ramp role (Myriad Landscape, Temple of the False God). The land count holds it; it is no ramp PIECE.
 *  - `land-drop`: puts a land onto the battlefield once (Wayfarer's Bauble, Growth Spiral): the land it finds keeps producing, the card does not.
 *  - `one-shot`: spent in the using -- a ritual, a Lotus Petal, a Treasure or Gold or Spawn maker.
 *  - `sacrifice`: mana for sacrificing another permanent (Phyrexian Altar, Priest of Forgotten Gods: owner 2026-10-10, ramp and not a colour source).
 *  - `trigger-mana`: mana when something happens (Birgi: owner 2026-10-10, ramp and not a dork).
 *  - `gated-off`: a gated source whose gate the deck does not meet (Mox Jasper outside a Dragon deck, owner 2026-10-13).
 *  - `restricted`: "spend this mana only ..." (Jegantha, Smokebraider).
 *  - `paid`: mana bought with a counter, a tapped permanent or another resource (Cryptic Trilobite, Springleaf Drum).
 *  - `other`: what none of those names (Mox Tantalite: suspend only).
 *
 *  NO COST-REDUCER CLASS: the brief for this change listed one, but the Ramp role holds no cost reducer (`rules.json` has no ramp rule for "costs {1} less", so Sapphire Medallion is not Ramp
 *  even though the 2026-08-06 ruling files cost reduction under ramp). A class nobody can be in is dead code; if that ruling is wired into the rules, it joins here.
 *
 *  ASK ONLY OF A RAMP-ROLE CARD THAT `classifyAccelerant` returned null for. The first match wins, in the order below: a card with two reasons is named by the more telling one. */
export type NonAccelerantRamp = "land" | "land-drop" | "one-shot" | "sacrifice" | "trigger-mana" | "gated-off" | "restricted" | "paid" | "other";

/** THE WEIGHT EACH CLASS CARRIES IN THE LAND TARGET: 0.15 for every one that is a piece (`RAMP_RESILIENCE.oneShot`), exactly what every non-accelerant has carried. NOT A RULING ON THE
 *  CLASSES: no owner ruling has priced them apart, so they share a number and a land is no piece (`null`, as the fallback always skipped a land). A weight change needs an owner ruling. */
export const NON_ACCELERANT_WEIGHT: Record<NonAccelerantRamp, number | null> = {
  land: null, "land-drop": RAMP_RESILIENCE.oneShot, "one-shot": RAMP_RESILIENCE.oneShot, sacrifice: RAMP_RESILIENCE.oneShot, "trigger-mana": RAMP_RESILIENCE.oneShot,
  "gated-off": RAMP_RESILIENCE.oneShot, restricted: RAMP_RESILIENCE.oneShot, paid: RAMP_RESILIENCE.oneShot, other: RAMP_RESILIENCE.oneShot,
};

const landPutRule = () => loadRules().rules.find((r) => r.id === "ramp.landPut")!;

export function nonAccelerantRamp(dc: DeckCard, _deck?: readonly DeckCard[]): NonAccelerantRamp {
  if (countsAsLand(dc.card)) return "land";
  const tags = dc.tags;
  const lines = cardLines(dc, true);
  // CEILING: "puts a land from hand / from among the cards looked at" (Growth Spiral, Planar Genesis) has no derived field -- `landFetch` is a fetch from the library -- so it is the
  // `ramp.landPut` rule's own printed-text pattern, the one rule the Ramp role still reads from the oracle text.
  if (tags?.landFetch !== undefined || ruleMatches(landPutRule(), dc)) return "land-drop";
  if (tags?.isOneShot || lines.some((l) => l.source === "one-shot-spell" || l.source === "token-maker" || l.cost.sacrificeSelf)) return "one-shot";
  if (lines.some((l) => l.cost.sacrificeOther)) return "sacrifice";
  if (lines.some((l) => l.source === "trigger" || l.source === "aura-trigger")) return "trigger-mana";
  if (lines.length > 0 && lines.every((l) => l.gate !== null)) return "gated-off";
  if (lines.some((l) => l.restriction !== null)) return "restricted";
  if (lines.some((l) => paidWithResource(l))) return "paid";
  return "other";
}
