import type { Card } from "./card.js";
import { extractTags, type Tag } from "./tags.js";
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

/** Push a reason for every tag that `producer` makes and `payoff` cares about. */
function matchDirection(
  producer: Card,
  produces: Set<Tag>,
  payoff: Card,
  cares: Set<Tag>,
  reasons: Reason[],
): void {
  for (const tag of produces) {
    if (cares.has(tag)) {
      reasons.push({
        tag,
        text: `${producer.name} produces ${tag}; ${payoff.name} pays off ${tag}.`,
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
