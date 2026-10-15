import { pairStrength, unread, type EngineCard, type EngineModel, type Link } from "./engine-model.js";

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
  /** The token the sentence is about, when the link reaches the plan card through a token its giver
   *  makes: "When Mark of the Rani enters, …" on The Rani's row needs "through its Mark of the Rani
   *  token" to be checkable (round 6). */
  via?: string;
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
  /** Every link into a plan card, from any card: the counts read all of them, so a card past the
   *  drawn ring still counts for the plan card it feeds. */
  links: LensLink[];
}

/** What a card has, in this plan: the cards that feed it (a plan card) or that it feeds (a set-up
 *  card), one entry per partner. */
export interface Partner { name: string; lasting: boolean; combo: boolean; why: string; via?: string; strength: number }

const SETUP_CAP = 10;

export function planLens(model: EngineModel, planCards: readonly string[], combos: readonly (readonly string[])[], cap = SETUP_CAP): PlanLens {
  const plan = [...new Set(planCards)].filter((n) => physicalIds(model, n).length);
  const inPlan = new Set(plan);
  const groups = new Map(model.groups.map((g) => [g.tag, g]));
  const smax = Math.max(1, ...[...model.cards.values()].map((c) => c.score));
  const comboKey = new Set(combos.flatMap((cs) => cs.flatMap((a) => cs.filter((b) => b !== a).map((b) => `${a}\u0001${b}`))));

  // Every directed link into a plan card, folded per physical pair.
  const acc = new Map<string, { from: string; to: string; links: { l: Link; lasting: boolean; via?: string }[]; strength: number }>();
  const seen = new Set<object>();
  for (const row of model.partners.values()) {
    for (const pair of row.values()) {
      if (seen.has(pair)) continue;
      seen.add(pair);
      const strength = pairStrength(pair, model.cards, groups, smax);
      for (const l of pair.links) {
        const from = model.cards.get(l.from), to = model.cards.get(l.to);
        if (!from || !to || !inPlan.has(to.physical) || to.isToken) continue;
        // A TOKEN FEEDS THROUGH THE CARD THAT MAKES IT (as the cut list credits it): a token dying into a
        // drain card is its maker setting the plan up. A token nothing in the deck makes is left out.
        // It keeps working only if the maker keeps making it: Asinine Antics makes its Cursed Roles
        // once, though each Role's enter trigger repeats; The Rani makes a Mark every time she hits.
        for (const { name: giver, again } of owners(model, from)) {
          if (giver === to.physical) continue;
          const k = `${giver}\u0001${to.physical}`;
          const e = acc.get(k) ?? { from: giver, to: to.physical, links: [], strength: 0 };
          e.links.push({ l, lasting: l.repeat !== "oneshot" && again, ...(from.isToken ? { via: from.name } : {}) });
          e.strength = Math.max(e.strength, strength);
          acc.set(k, e);
        }
      }
    }
  }
  const all: LensLink[] = [...acc.values()].map((e) => {
    const top = [...e.links].sort((x, y) => rank(x) - rank(y))[0]!, best = top.l;
    const hue = groups.get(e.links.find((x) => x.lasting && groups.has(x.l.tag))?.l.tag ?? best.tag)?.hue;
    return {
      from: e.from, to: e.to, lasting: e.links.some((x) => x.lasting),
      combo: comboKey.has(`${e.from}\u0001${e.to}`), why: best.text, strength: e.strength,
      ...(top.via ? { via: top.via } : {}),
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
  return { plan, setup, links: all };
}

/** A lasting, read reason first, then any read one: the sentence a reader can check. */
const rank = (x: { l: Link; lasting: boolean; via?: string }) => (x.lasting ? 0 : 2) + (unread(x.l) ? 1 : 0);

/** THE DECK CARDS A CARD'S LINKS COUNT FOR: itself, or for a token the cards that make it, each with
 *  whether it makes the token over and over. `madeBy` names FACES (Legion's Landing, not "Legion's
 *  Landing // Adanto, the First Fort"), so each is read back to the physical card a player cuts. */
function owners(model: EngineModel, card: EngineCard): { name: string; again: boolean }[] {
  if (!card.isToken) return [{ name: card.physical, again: true }];
  const out = new Map<string, boolean>();
  for (const face of card.madeBy ?? []) {
    for (const c of model.cards.values()) {
      if (c.isToken || (c.name !== face && c.physical !== face)) continue;
      // A REPEATING "creates" link, the tag the cut list's makers key on: a static anthem from the
      // same card to its token is not making it again.
      const again = (model.partners.get(c.id)?.get(card.id)?.links ?? []).some((l) => l.from === c.id && /^creates/.test(l.tag) && l.repeat !== "oneshot");
      out.set(c.physical, (out.get(c.physical) ?? false) || again);
    }
  }
  return [...out].map(([name, again]) => ({ name, again }));
}

const physicalIds = (model: EngineModel, name: string) => [...model.cards.values()].filter((c) => c.physical === name).map((c) => c.id);

/** A plan card's feeders, or the plan cards any other card feeds, with `cut` left out. Lasting
 *  partners first, then the strongest. A plan card that feeds another plan card is counted on the
 *  card it feeds, never as fed by it. */
export function partnersOf(lens: PlanLens, name: string, cut: ReadonlySet<string> = new Set()): Partner[] {
  const inPlan = lens.plan.includes(name);
  const out = new Map<string, Partner>();
  for (const l of lens.links) {
    const other = inPlan ? (l.to === name ? l.from : null) : l.from === name ? l.to : null;
    if (other === null || cut.has(other)) continue;
    const p = out.get(other);
    // Two faces feeding the same card: one entry, lasting if either is.
    const mine = { name: other, lasting: l.lasting, combo: l.combo, why: l.why, strength: l.strength, ...(l.via ? { via: l.via } : {}) };
    if (!p) out.set(other, mine);
    else if (!p.lasting && l.lasting) out.set(other, { ...mine, combo: p.combo || l.combo, strength: Math.max(p.strength, l.strength) });
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
  const seen = new Set<object>();
  for (const row of model.partners.values()) {
    for (const pair of row.values()) {
      if (seen.has(pair)) continue;
      seen.add(pair);
      for (const l of pair.links) {
        const ends = [model.cards.get(l.from), model.cards.get(l.to)];
        if (!ends[0] || !ends[1]) continue;
        // Either way round, a token counting for its maker as the plan lens credits it.
        for (const [mine, theirs] of [[ends[0], ends[1]], [ends[1], ends[0]]] as const) {
          const me = owners(model, mine).find((o) => o.name === name);
          if (!me || theirs.isToken || theirs.physical === name || !wins.has(theirs.physical)) continue;
          all.add(theirs.physical);
          if (l.repeat !== "oneshot" && me.again) lasting.add(theirs.physical);
        }
      }
    }
  }
  return { all: all.size, lasting: lasting.size, of: wins.size - (wins.has(name) ? 1 : 0) };
}
