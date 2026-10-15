import { pairStrength, unread, type EngineModel, type Link } from "./engine-model.js";

/** THE PLAN LENS: one win plan read as a map of who feeds whom (persona rounds 2026-10-14..15, five
 *  rounds, the readers' tasks were "which cards keep my drain cards firing", "what does cutting
 *  Displacer Kitten cost", "which card hangs on one link"). The plan's cards sit on the inner ring;
 *  the cards that set them up sit outside; every count and sentence comes from the engine's links.
 *
 *  DIRECTION DECIDES WHO FEEDS WHOM (round 5, four of four seats). A link runs `from` the card that
 *  supplies `to` the card that benefits. Counted both ways, Curse of Opulence "fed" five drain cards
 *  with five links that keep working -- and every sentence read "When Forgeborn Oreads attacks, Curse
 *  of Opulence makes a token": the drain card feeding the Curse. Only a link INTO a plan card feeds
 *  the plan, so the Curse feeds it once (its enter trigger), and the attack links run the other way.
 *
 *  Pure, keyed by the physical card a player cuts: a two-faced card is one entry, and its link keeps
 *  working if either face's does. */

/** One card feeding another inside the plan, every face and reason folded into one. */
export interface LensLink {
  from: string; to: string;
  /** At least one reason repeats: a trigger, a static or an activated ability, not a one-shot. */
  lasting: boolean;
  /** Both cards are pieces of one combo the report found. */
  combo: boolean;
  /** The sentence a reader checks: a lasting, read reason first. */
  why: string;
  /** How well the two work together (`pairStrength`), for line width and ranking. */
  strength: number;
  /** The colour of the group the reason belongs to, when it has one. */
  hue?: string;
}

export interface PlanLens {
  /** The plan's cards, as the report lists them: the inner ring. */
  plan: string[];
  /** The cards that feed the plan most, strongest first: the outer ring. */
  setup: string[];
  /** Every link from a shown card into a plan card. */
  links: LensLink[];
}

/** What a card has, in this plan: the cards that feed it (a plan card) or that it feeds (a set-up
 *  card), one entry per partner. */
export interface Partner { name: string; lasting: boolean; combo: boolean; why: string; strength: number }

const SETUP_CAP = 10;

export function planLens(model: EngineModel, planCards: readonly string[], combos: readonly (readonly string[])[], cap = SETUP_CAP): PlanLens {
  const plan = [...new Set(planCards)].filter((n) => physicalIds(model, n).length);
  const inPlan = new Set(plan);
  const groups = new Map(model.groups.map((g) => [g.tag, g]));
  const smax = Math.max(1, ...[...model.cards.values()].map((c) => c.score));
  const comboKey = new Set(combos.flatMap((cs) => cs.flatMap((a) => cs.filter((b) => b !== a).map((b) => `${a}\u0001${b}`))));

  // Every directed link into a plan card, folded per physical pair.
  const acc = new Map<string, { from: string; to: string; links: Link[]; strength: number }>();
  const seen = new Set<object>();
  for (const row of model.partners.values()) {
    for (const pair of row.values()) {
      if (seen.has(pair)) continue;
      seen.add(pair);
      const strength = pairStrength(pair, model.cards, groups, smax);
      for (const l of pair.links) {
        const from = model.cards.get(l.from), to = model.cards.get(l.to);
        if (!from || !to || !inPlan.has(to.physical) || from.physical === to.physical) continue;
        // A token is drawn through the card that makes it, never as its own disc.
        if (from.isToken) continue;
        const k = `${from.physical}\u0001${to.physical}`;
        const e = acc.get(k) ?? { from: from.physical, to: to.physical, links: [], strength: 0 };
        e.links.push(l);
        e.strength = Math.max(e.strength, strength);
        acc.set(k, e);
      }
    }
  }
  const all: LensLink[] = [...acc.values()].map((e) => {
    const best = [...e.links].sort((x, y) => rank(x) - rank(y))[0]!;
    const hue = groups.get(e.links.find((l) => l.repeat !== "oneshot" && groups.has(l.tag))?.tag ?? best.tag)?.hue;
    return {
      from: e.from, to: e.to, lasting: e.links.some((l) => l.repeat !== "oneshot"),
      combo: comboKey.has(`${e.from}\u0001${e.to}`), why: best.text, strength: e.strength,
      ...(hue ? { hue } : {}),
    };
  });

  // THE CARDS THAT SET IT UP: outside the plan, ranked by what they feed into it -- a link that keeps
  // working counts twice what a one-shot does -- then by how many plan cards they reach.
  const feed = new Map<string, { s: number; n: number }>();
  for (const l of all) {
    if (inPlan.has(l.from)) continue;
    const f = feed.get(l.from) ?? { s: 0, n: 0 };
    f.s += (l.lasting ? 1 : 0.5) * Math.max(1, l.strength);
    f.n++;
    feed.set(l.from, f);
  }
  const setup = [...feed.entries()]
    .sort((a, b) => b[1].s - a[1].s || b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1))
    .slice(0, cap).map(([n]) => n);
  const shown = new Set([...plan, ...setup]);
  return { plan, setup, links: all.filter((l) => shown.has(l.from)) };
}

/** A lasting, read reason first, then any read one: the sentence a reader can check. */
const rank = (l: Link) => (l.repeat === "oneshot" ? 2 : 0) + (unread(l) ? 1 : 0);

const physicalIds = (model: EngineModel, name: string) => [...model.cards.values()].filter((c) => c.physical === name).map((c) => c.id);

/** A plan card's feeders, or the plan cards a set-up card feeds, with `cut` left out. Lasting
 *  partners first, then the strongest. */
export function partnersOf(lens: PlanLens, name: string, cut: ReadonlySet<string> = new Set()): Partner[] {
  const inPlan = lens.plan.includes(name);
  const out = new Map<string, Partner>();
  for (const l of lens.links) {
    const other = inPlan && l.to === name ? l.from : l.from === name ? l.to : null;
    if (other === null || cut.has(other)) continue;
    const p = out.get(other);
    // A plan card both feeds and is fed by another plan card: one entry, lasting if either is.
    if (!p) out.set(other, { name: other, lasting: l.lasting, combo: l.combo, why: l.why, strength: l.strength });
    else if (!p.lasting && l.lasting) out.set(other, { ...p, lasting: true, why: l.why, combo: p.combo || l.combo, strength: Math.max(p.strength, l.strength) });
  }
  return [...out.values()].sort((a, b) => Number(b.lasting) - Number(a.lasting) || b.strength - a.strength || (a.name < b.name ? -1 : 1));
}

export const counts = (ps: readonly Partner[]) => ({ all: ps.length, lasting: ps.filter((p) => p.lasting).length });

/** WHAT A CUT COSTS THE PLAN: each plan card's lasting links before and after. A card that had none
 *  to begin with is told apart from one the cut leaves with none (round 4: "None is left without a
 *  lasting link (… had none to begin with)" read as a contradiction to three seats of four). */
export function cutPreview(lens: PlanLens, cut: ReadonlySet<string>) {
  const rows = lens.plan.filter((n) => !cut.has(n)).map((name) => ({
    name, before: counts(partnersOf(lens, name)).lasting, after: counts(partnersOf(lens, name, cut)).lasting,
  }));
  return {
    rows,
    lose: rows.filter((r) => r.after < r.before).map((r) => r.name),
    left: rows.filter((r) => r.before > 0 && r.after === 0).map((r) => r.name),
    never: rows.filter((r) => r.before === 0).map((r) => r.name),
  };
}

/** HOW A CARD SITS ACROSS EVERY WIN PLAN: the plan cards it works with in either direction, and how
 *  many of those links keep working. Round 3's strongest single answer ("works with 11 of your 12
 *  cards that win"). */
export function acrossPlans(model: EngineModel, name: string, planCards: readonly string[]) {
  const wins = new Set(planCards);
  const all = new Set<string>(), lasting = new Set<string>();
  for (const c of model.cards.values()) {
    if (c.physical !== name) continue;
    for (const [o, pair] of model.partners.get(c.id) ?? []) {
      const other = model.cards.get(o)?.physical;
      if (!other || other === name || !wins.has(other)) continue;
      all.add(other);
      if (!pair.once) lasting.add(other);
    }
  }
  return { all: all.size, lasting: lasting.size, of: wins.size - (wins.has(name) ? 1 : 0) };
}
