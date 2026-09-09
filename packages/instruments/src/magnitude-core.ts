/** THE MAGNITUDE INSTRUMENT'S PURE HALF: the product weight the design proposes, the demand-width
 *  strata the draw is stratified on, and the concordance score the owner's rankings are judged by.
 *  Spec: `docs/superpowers/specs/2026-09-09-edge-magnitude-design.md`. No Mongo, no engine change:
 *  this computes a CANDIDATE weight beside today's so the sealed key can carry both orderings.
 *
 *  EVERY SEED HERE IS A PRIOR THE OWNER JUDGES, not a finding. They are named constants so the
 *  scorer's report can say which term lost. */
import type { Reason } from "@edh-seer/engine";
import type { CardTags } from "@edh-seer/tagger";

/** How wide the demand class of a payoff's best inbound tag is. The draw takes 20 of each. */
export type Width = "narrow" | "type" | "wide";

const WIDE = new Set(["any", "creature", "permanent", "card", "spell", "nonland", "noncreature", "nontoken"]);
const TYPES = new Set(["artifact", "enchantment", "land", "instant", "sorcery", "planeswalker", "battle", "legendary", "kindred"]);
/** Families whose tag subject is not a class of cards (a kind, a role, a name). Not stratified. */
const NOT_A_CLASS = new Set(["static", "combo", "tutor", "ramp-target", "copies", "creates", "land-condition"]);

/** The width of ONE tag's demand, or undefined when the tag names no class. */
export function widthOf(tag: string): Width | undefined {
  const [family, subject = "any"] = tag.split(":");
  if (NOT_A_CLASS.has(family!)) return undefined;
  const head = subject.replace(/^-/, "").split("|")[0]!.split("/")[0]!;
  if (WIDE.has(head)) return "wide";
  if (TYPES.has(head)) return "type";
  return "narrow";
}

/** The narrowest width among a payoff's inbound tags: a payoff that reads Goblins AND creatures is a
 *  Goblin payoff for the draw. */
export function narrowestWidth(tags: readonly string[]): Width | undefined {
  const order: Width[] = ["narrow", "type", "wide"];
  const seen = new Set(tags.map(widthOf).filter((w): w is Width => w !== undefined));
  return order.find((w) => seen.has(w));
}

/** SPECIFICITY = 1 − the class's share of the commander-legal corpus (31,829 cards, measured
 *  2026-09-09): creature 55.8%, artifact 11.2%, enchantment 11.4%, instant 11.7%, sorcery 11.1%,
 *  legendary 12.7%, land 3.8%, planeswalker 1.0%; a subtype 1–4%. Whole-deck classes are FLOORED
 *  at 0.05: admitted at a twentieth, never refused (owner, 2026-09-09). */
export const SPECIFICITY: Readonly<Record<string, number>> = {
  any: 0.05, card: 0.05, spell: 0.05, permanent: 0.05, nonland: 0.05, noncreature: 0.05, nontoken: 0.05,
  creature: 0.44,
  artifact: 0.89, enchantment: 0.89, instant: 0.88, sorcery: 0.89, legendary: 0.87, land: 0.96, planeswalker: 0.99,
};
export const SPECIFICITY_NARROW = 0.98;

export function specificityOf(tag: string): number {
  const subject = (tag.split(":")[1] ?? "any").replace(/^-/, "").split("|")[0]!.split("/")[0]!;
  return SPECIFICITY[subject] ?? SPECIFICITY_NARROW;
}

/** RATE seeds: events per game, log-shaped on purpose (a per-turn engine is worth more than a
 *  one-shot, not thirty-two times more). `repeatable` is a CEILING until the mana model prices it. */
export const RATE: Readonly<Record<string, number>> = {
  once: 1, "per-cycle": 4, "per-turn": 6, repeatable: 3, continuous: 1,
};
/** REACH seeds: pod of four, a board-size assumption for `each`/`all`. */
export const REACH: Readonly<Record<string, number>> = { self: 1, one: 1, target: 1, each: 3, all: 4 };
export const AMOUNT_CAP = 10;
/** The strategy term that already ships: `1 + AXIS_BOOST × maxAxisWeight` (analyze.ts). Kept in
 *  the product because the owner ruled a deck's strategy should favour its own edges (2026-09-09). */
export const AXIS_BOOST = 1.5;
export const UNKNOWN_KIND = 0.2;

const num = (s: string | undefined): number => (s !== undefined && /^\d+$/.test(s) ? Math.min(Number(s), AMOUNT_CAP) : 1);

/** RATE(P→C) for one tag: the producing ability's `repeats` × amount, over P's abilities whose emits
 *  carry the tag's verb; an implied event (no such ability) is `once`. */
export function rateOf(producer: CardTags | null | undefined, tag: string): number {
  const verb = tag.split(":")[0]!;
  let best = 0;
  for (const a of producer?.abilities ?? []) {
    if (!(a.emits ?? []).some((e) => e.verb === verb)) continue;
    best = Math.max(best, (RATE[a.repeats ?? "once"] ?? 1) * num(a.amount));
  }
  return best || 1;
}

/** REACH(C) for one tag: the consuming ability's effect scope × amount, over C's abilities whose
 *  trigger carries the tag's verb; a static or unmatched consumer reaches 1. */
export function reachOf(consumer: CardTags | null | undefined, tag: string): number {
  const verb = tag.split(":")[0]!;
  let best = 0;
  for (const a of consumer?.abilities ?? []) {
    if (!(a.trigger?.verbs ?? []).includes(verb as never)) continue;
    const s = a.effect.subject;
    const scope = s === undefined ? "none" : s.scope ?? (s.self ? "self" : "one");
    const reach = scope === "none" ? num(a.amount) : (REACH[scope] ?? 1);
    best = Math.max(best, reach);
  }
  return best || 1;
}

export interface WeightContext {
  kinds: Readonly<Record<string, number>>;
  producer: CardTags | null | undefined;
  consumer: CardTags | null | undefined;
  /** The deck's theme axis, tag → weight in [0, 1]. */
  axis: ReadonlyMap<string, number>;
}

/** The five terms of the best reason per tag, so a scorer can ablate one term at a time against the
 *  owner's rankings and say WHICH term lost -- the report the spec's §4.3 promises. */
export interface EdgeTerms { tag: string; kind: number; rate: number; reach: number; specificity: number; strategy: number }

export function edgeTerms(reasons: readonly Reason[], ctx: WeightContext): EdgeTerms[] {
  const best = new Map<string, EdgeTerms>();
  for (const r of reasons) {
    const t: EdgeTerms = {
      tag: r.tag,
      kind: r.effectKind ? (ctx.kinds[r.effectKind] ?? UNKNOWN_KIND) : UNKNOWN_KIND,
      rate: rateOf(ctx.producer, r.tag), reach: reachOf(ctx.consumer, r.tag),
      specificity: specificityOf(r.tag), strategy: 1 + AXIS_BOOST * (ctx.axis.get(r.tag) ?? 0),
    };
    const w = t.kind * t.rate * t.reach * t.specificity * t.strategy;
    const prev = best.get(r.tag);
    if (!prev || prev.kind * prev.rate * prev.reach * prev.specificity * prev.strategy < w) best.set(r.tag, t);
  }
  return [...best.values()];
}

/** The candidate: KIND × RATE × REACH × SPECIFICITY × STRATEGY, per reason; summed over distinct tags
 *  keeping the max per tag, the same anti-inflation shape `impactEdgeWeight` uses. */
export function productEdgeWeight(reasons: readonly Reason[], ctx: WeightContext): number {
  const best = new Map<string, number>();
  for (const r of reasons) {
    const kind = r.effectKind ? (ctx.kinds[r.effectKind] ?? UNKNOWN_KIND) : UNKNOWN_KIND;
    const strategy = 1 + AXIS_BOOST * (ctx.axis.get(r.tag) ?? 0);
    const w = kind * rateOf(ctx.producer, r.tag) * reachOf(ctx.consumer, r.tag) * specificityOf(r.tag) * strategy;
    if ((best.get(r.tag) ?? 0) < w) best.set(r.tag, w);
  }
  let sum = 0;
  for (const w of best.values()) sum += w;
  return sum;
}

/** Pairwise concordance of an engine ordering with the owner's ranking of one triple. `ranks[i]` is
 *  the owner's rank of feeder i (1 = feeds most); ties share a rank and are not compared. `weights[i]`
 *  is the engine's weight. An engine tie on a pair the owner ordered is half a disagreement. */
export function concordance(ranks: readonly number[], weights: readonly number[]): { agree: number; pairs: number } {
  let agree = 0, pairs = 0;
  for (let i = 0; i < ranks.length; i++) for (let j = i + 1; j < ranks.length; j++) {
    if (ranks[i] === ranks[j]) continue;
    pairs++;
    const ownerSaysI = ranks[i]! < ranks[j]!;
    if (weights[i] === weights[j]) { agree += 0.5; continue; }
    if ((weights[i]! > weights[j]!) === ownerSaysI) agree++;
  }
  return { agree, pairs };
}
