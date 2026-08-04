import type { Card } from "./card.js";
import { extractTags, describeTag, type Tag } from "./tags.js";
import type { ComboIndex } from "./combos.js";

export interface Reason {
  /** The tag that produced this reason, or "combo". */
  tag: string;
  /** Human-readable explanation naming both cards. */
  text: string;
  /** Payoff synergy type (tagger EFFECT_KIND). Set by the structured matcher; unset by the flat engine. */
  effectKind?: string;
  /** Repeatability class: "triggered" | "activated" | "static" | "oneshot". Set by the structured matcher. */
  repeatability?: string;
  /** Payoff scaling basis (tagger SCALING_BASES). Set by the structured matcher; unset → "fixed". */
  scaling?: string;
  /** True iff the matched subject filter carried a non-empty `stats` predicate array. Lets
   *  stat-gated categories (power-matters, toughness-matters) distinguish a genuinely
   *  predicate-gated match from a coincidental unconditional match sharing the same tag. */
  hasStatPredicate?: boolean;
  /** Card name on the consuming side: the card that triggers on, benefits from, or is enabled
   *  by this reason's event. Set by the structured matcher; unset by the flat engine.
   *  Before this existed, direction was only recoverable by parsing `text`, which failed on
   *  ~10% of reasons — the produces/cares direction is the core of the model and belongs in a
   *  field, not in prose. */
  consumer?: string;
  /** Card name on the supplying side. See `consumer`. */
  producer?: string;
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
  const payoffWild = cares.has(TRIBE_WILDCARD);
  const producerWild = produces.has(TRIBE_WILDCARD);

  // Pass 1: concrete + non-tribe exact matches. Skip a concrete tribe tag when the
  // payoff also cares about the wildcard — the wildcard branch emits the one collapsed
  // reason for it, so pass 1 must not also push an exact tribe reason (avoids double-count).
  for (const t of produces) {
    if (t === TRIBE_WILDCARD) continue;
    if (payoffWild && t.startsWith(TRIBE_PREFIX)) continue;
    if (cares.has(t)) {
      const label = describeTag(t);
      reasons.push({
        tag: t,
        text: `${producer.name} produces ${label}; ${payoff.name} pays off ${label}.`,
      });
    }
  }

  // Pass 2: wildcard payoff ("of the chosen type") — one collapsed reason.
  if (payoffWild) {
    const prodTribes = concreteTribes(produces);
    if (prodTribes.length > 0) {
      const t = prodTribes[0];
      reasons.push({
        tag: t,
        text: `${producer.name} produces ${describeTag(t)}; ${payoff.name} pays off any creature type.`,
      });
    } else if (producerWild) {
      reasons.push({
        tag: TRIBE_WILDCARD,
        text: `${producer.name} produces any creature type; ${payoff.name} pays off any creature type.`,
      });
    }
  }

  // Pass 3: wildcard producer (changeling) vs a concrete tribal payoff — one collapsed
  // reason. Exclude tribes the producer also makes concretely (already exact-matched in
  // pass 1) so the same tribe is never reasoned twice.
  if (producerWild && !payoffWild) {
    const careTribes = concreteTribes(cares).filter((t) => !produces.has(t));
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
