import { discountsOtherSpells, loadRules, ruleMatches } from "./rules.js";
import { RAMP_RESILIENCE } from "./mana-base.js";
import { cardLines, paidWithResource } from "./mana-lines.js";
import { countsAsLand } from "./typeline.js";
import type { DeckCard } from "./types.js";

/** WHAT A RAMP-ROLE CARD IS WHEN THE GOLDFISH DOES NOT PLAY IT AS AN ACCELERANT (#1190, Fable round 2 finding 1). The land target weighed every such card 0.15 as "a one-shot" and the
 *  report called them "one-shots, like a ritual or a Treasure", which Birgi (trigger mana) and Phyrexian Altar (a sacrifice outlet) are not. The class is read from the card's derived
 *  mana lines (`CardTags.manaLines`, `landFetch`, `isOneShot`), the same record every other mana reader asks.
 *
 *  - `land`: a land in the Ramp role (Myriad Landscape, Temple of the False God). The land count holds it; it is no ramp PIECE.
 *  - `land-drop`: puts a land onto the battlefield once (Wayfarer's Bauble, Growth Spiral, a Lander token's maker): the land it finds keeps producing, the card does not.
 *  - `one-shot`: spent in the using -- a ritual, a Lotus Petal, a Treasure or Gold or Spawn maker.
 *  - `sacrifice`: mana for sacrificing another permanent (Phyrexian Altar, Priest of Forgotten Gods: owner 2026-10-10, ramp and not a colour source).
 *  - `trigger-mana`: mana when something happens (Birgi: owner 2026-10-10, ramp and not a dork).
 *  - `gated-off`: a gated source whose gate the deck does not meet (Mox Jasper outside a Dragon deck, owner 2026-10-13).
 *  - `restricted`: "spend this mana only ..." (Jegantha, Smokebraider).
 *  - `paid`: mana bought with a counter, a tapped permanent or another resource (Cryptic Trilobite, Springleaf Drum).
 *  - `other`: what none of those names (Mox Tantalite: suspend only).
 *
 *  - `cost-reducer`: a discount for OTHER spells (Sapphire Medallion, owner 2026-08-06 and 2026-10-13: cost reduction is ramp). It makes no mana and replaces no land: a discount is worth what the deck has to reduce, so the land target weighs it 0 (owner 2026-10-14; Heartstone and Training Grounds, which reduce activated abilities, are cost reducers too).
 *
 *  ASK ONLY OF A RAMP-ROLE CARD THAT `classifyAccelerant` returned null for. The first match wins, in the order below: a card with two reasons is named by the more telling one. */
export type NonAccelerantRamp = "land" | "land-drop" | "cost-reducer" | "one-shot" | "sacrifice" | "trigger-mana" | "gated-off" | "restricted" | "paid" | "other";

/** THE WEIGHT EACH CLASS CARRIES IN THE LAND TARGET: 0.15 for every one that is a piece (`RAMP_RESILIENCE.oneShot`), exactly what every non-accelerant has carried, EXCEPT the cost reducer: 0 (owner 2026-10-14, "it is worth more if you have
 *  something to reduce"; it is still a ramp piece, it replaces no land). No other ruling has priced the classes apart, so the rest share a number and a land is no piece (`null`, as the fallback always skipped a land). A weight change needs an owner ruling. */
export const NON_ACCELERANT_WEIGHT: Record<NonAccelerantRamp, number | null> = {
  land: null, "land-drop": RAMP_RESILIENCE.oneShot, "cost-reducer": 0, "one-shot": RAMP_RESILIENCE.oneShot, sacrifice: RAMP_RESILIENCE.oneShot, "trigger-mana": RAMP_RESILIENCE.oneShot,
  "gated-off": RAMP_RESILIENCE.oneShot, restricted: RAMP_RESILIENCE.oneShot, paid: RAMP_RESILIENCE.oneShot, other: RAMP_RESILIENCE.oneShot,
};

const landPutRule = () => loadRules().rules.find((r) => r.id === "ramp.landPut")!;

export function nonAccelerantRamp(dc: DeckCard, _deck?: readonly DeckCard[]): NonAccelerantRamp {
  if (countsAsLand(dc.card)) return "land";
  const tags = dc.tags;
  const lines = cardLines(dc, true);
  // CEILING: "puts a land from hand / from among the cards looked at" (Growth Spiral, Planar Genesis) has no derived field -- `landFetch` is a fetch from the library -- so it is the
  // `ramp.landPut` rule's own printed-text pattern, the one rule the Ramp role still reads from the oracle text.
  // A LANDER TOKEN (owner 2026-10-13) is a land-fetch token: its maker puts a land onto the battlefield later, once.
  if (tags?.landFetch !== undefined || ruleMatches(landPutRule(), dc) || lines.some((l) => l.producesToken === "lander")) return "land-drop";
  if (tags?.isOneShot || lines.some((l) => l.source === "one-shot-spell" || l.source === "token-maker" || l.cost.sacrificeSelf)) return "one-shot";
  if (lines.some((l) => l.cost.sacrificeOther)) return "sacrifice";
  if (lines.some((l) => l.source === "trigger" || l.source === "aura-trigger")) return "trigger-mana";
  if (lines.length > 0 && lines.every((l) => l.gate !== null)) return "gated-off";
  if (lines.some((l) => l.restriction !== null)) return "restricted";
  if (lines.some((l) => paidWithResource(l))) return "paid";
  // A COST REDUCER has no mana line at all: it saves mana for the other spells (owner 2026-10-13). Last of the named classes because a card with a line is named by it first.
  if ((tags?.abilities ?? []).some((a) => discountsOtherSpells(a.effect as never))) return "cost-reducer";
  return "other";
}
