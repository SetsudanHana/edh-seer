import type { Card } from "./card.js";
import { extractTags, describeTag, type Tag } from "./tags.js";
import type { ComboIndex } from "./combos.js";

export interface Reason {
  /** The tag that produced this reason, or "combo". */
  tag: string;
  /** Human-readable explanation naming both cards. */
  text: string;
}

export interface SynergyResult {
  score: number;
  reasons: Reason[];
  combo: boolean;
}

const TRIBE_PREFIX = "tribe:";
const TRIBE_WILDCARD = "tribe:*";

function concreteTribes(tags: Set<Tag>): Tag[] {
  return [...tags].filter((t) => t.startsWith(TRIBE_PREFIX) && t !== TRIBE_WILDCARD);
}

/** Push a reason for every tag that `producer` makes and `payoff` cares about. */
function matchDirection(
  producer: Card,
  produces: Set<Tag>,
  payoff: Card,
  cares: Set<Tag>,
  reasons: Reason[],
): void {
  // Concrete + all non-tribe exact matches (unchanged behavior).
  for (const t of produces) {
    if (t !== TRIBE_WILDCARD && cares.has(t)) {
      const label = describeTag(t);
      reasons.push({
        tag: t,
        text: `${producer.name} produces ${label}; ${payoff.name} pays off ${label}.`,
      });
    }
  }
  // Wildcard payoff ("of the chosen type") — one collapsed reason.
  if (cares.has(TRIBE_WILDCARD)) {
    const prodTribes = concreteTribes(produces);
    if (prodTribes.length > 0) {
      const t = prodTribes[0];
      reasons.push({
        tag: t,
        text: `${producer.name} produces ${describeTag(t)}; ${payoff.name} pays off any creature type.`,
      });
    } else if (produces.has(TRIBE_WILDCARD)) {
      reasons.push({
        tag: TRIBE_WILDCARD,
        text: `${producer.name} produces any creature type; ${payoff.name} pays off any creature type.`,
      });
    }
  }
  // Wildcard producer (changeling) vs a concrete tribal payoff — one collapsed reason.
  if (produces.has(TRIBE_WILDCARD) && !cares.has(TRIBE_WILDCARD)) {
    const careTribes = concreteTribes(cares);
    if (careTribes.length > 0) {
      const t = careTribes[0];
      reasons.push({
        tag: t,
        text: `${producer.name} produces any creature type; ${payoff.name} pays off ${describeTag(t)}.`,
      });
    }
  }
}

export function synergyScore(a: Card, b: Card, combos?: ComboIndex): SynergyResult {
  const ta = extractTags(a);
  const tb = extractTags(b);
  const reasons: Reason[] = [];
  matchDirection(a, ta.produces, b, tb.cares, reasons);
  matchDirection(b, tb.produces, a, ta.cares, reasons);

  const found = combos?.combosContainedIn(new Set([a.name, b.name])) ?? [];
  if (found.length > 0) {
    for (const c of found) {
      reasons.push({ tag: "combo", text: `Combo: ${a.name} + ${b.name} — ${c.result}` });
    }
    return { score: 100, reasons, combo: true };
  }
  return { score: reasons.length, reasons, combo: false };
}
