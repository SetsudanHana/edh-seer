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
  /** True when the producing side is a TOKEN node rather than a card in the deck. A name is not an
   *  identity: 92 of the 661 distinct token names in the corpus are also a real card (Llanowar
   *  Elves, Mutavault, Sacred Cat), and a card that makes a token copy of itself puts both in one
   *  deck. Without this the two collapse into one node and the token's relations are attributed to
   *  the card. Set by the structured matcher; unset by the flat engine. */
  producerIsToken?: boolean;
  /** True when the CONSUMING side is a token node. See `producerIsToken`. */
  consumerIsToken?: boolean;
  /** True when the producer side of this reason was a SYNTHESISED baseline event — the card
   *  supplying it does so merely by existing (any nonland is cast; any permanent enters), not by
   *  an authored effect. Absent when the supply was authored, i.e. surplus. Theme membership
   *  reads this to tell a deck's 35 lands apart from the fetchlands that actually feed landfall.
   *  Set by the structured matcher; unset by the flat engine. */
  impliedProducer?: boolean;
}

/**
 * Collapse reasons that say the SAME SENTENCE, keeping the first of each.
 *
 * ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE CLAIM, and the objects deliberately survive: Archon of
 * Cruelty's single entry trigger derives SIX reasons identical in tag and text and differing only in
 * `effectKind`, and `effectKind` is LOAD-BEARING for archetype detection (`mechanisms.ts` matches on
 * it, and Archon's six carry aristocrats' `forced-sacrifice`, `drain` and `player-life-loss` beside
 * `draw-card` and `lifegain`). Dropping five of six would silently narrow every detector that reads
 * them. `claimCount` already fixed what the SCORE counts; this is what the READER sees.
 *
 * Measured across the 71 decks: 9,268 of 40,563 reasons (22.8%) sit in a duplicate (tag, text)
 * group. The graph wire has deduped since it shipped; the CLI and the Archetypes board did not, so
 * Bontu's Monument printed "triggers on a creature being cast" THREE TIMES for each of three
 * partners — nine rows where three belong.
 */
export function dedupeReasonsByText(reasons: readonly Reason[]): Reason[] {
  const seen = new Set<string>();
  const out: Reason[] = [];
  for (const r of reasons) {
    if (seen.has(r.text)) continue;
    seen.add(r.text);
    out.push(r);
  }
  return out;
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
