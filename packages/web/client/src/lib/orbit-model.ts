import type { EngineCard, EngineGroup, EngineModel, Link } from "./engine-model.js";

/** ONE CARD'S WORLD, IN RINGS (graph evaluation 2026-09-25, design B).
 *
 *  The card in the middle; the cards it works with around it, in sectors by the group each link
 *  belongs to; then the deck cards one card further out, and the ones it doesn't reach in two. It
 *  answers "what does my commander connect to" with the whole deck accounted for, which the old
 *  one-card view (six strongest partners) could not.
 *
 *  Only the first ring is drawn. The prototype drew all three rings as discs, and the persona round
 *  could not read them: "I can't identify small art crops with no names" (phone). Rings two and
 *  three are lists of names, and every drawn disc carries its name. */

export interface OrbitPartner {
  card: EngineCard;
  /** Every line between the partner and the focus, repeating ones first. */
  links: Link[];
  /** Every one of those lines works only once. */
  once: boolean;
}

export interface OrbitSector {
  /** The group the partners' first repeating line belongs to; none for a tag with no group. */
  group?: EngineGroup;
  name: string;
  hue: string;
  partners: OrbitPartner[];
}

export interface OrbitModel {
  focus: EngineCard;
  sectors: OrbitSector[];
  /** Deck cards it works with: a card's two faces count once, and tokens are counted apart. At
   *  Kindred Discovery the totals came to 103 for a 100-card deck (orbit round 3). */
  direct: number;
  /** Tokens among the partners. */
  directTokens: number;
  /** Deck cards one step out, each with the direct partners that link it in. */
  near: { card: EngineCard; via: EngineCard[] }[];
  /** The same cards, grouped by the one partner each goes through: "31 cards through Harmonic
   *  Prodigy; … and 21 others", thirty rows deep, read as a wall on every seat (orbit round 1).
   *  Each card sits under the partner that links the most of them, so the fewest groups cover all. */
  through: { via: EngineCard; cards: EngineCard[]; example?: Link; lines: ReadonlyMap<string, Link[]> }[];
  /** Deck cards, lands aside, that don't reach the focus in two steps. */
  far: EngineCard[];
  /** Lands that don't reach it either, counted so "every other card connects" stays true. */
  farLands: number;
}

export const OTHER_HUE = "#6b5f7d";
/** Colours for sectors the deck's own groups don't colour: helpers all share one grey in the
 *  Overview, and four grey rows on one card could not be told apart (orbit round 2). */
/** The colours unlike the Overview's group colours come first: a helper coloured teal next to a
 *  blue group read as the same group (orbit round 3). */
const EXTRA_HUES = ["#c0703a", "#b5577a", "#8a8f3a", "#9a6bc0", "#b08e1d", "#5b40f6", "#277310", "#6b89f9", "#1c8db7", "#21a28f", "#4f7fa0"];

/** A card that belongs in a ring list: tokens are made by cards, not in the deck, and a land that
 *  reaches nothing is doing a land's job. */
const deckCard = (c: EngineCard) => !c.isToken;

export function buildOrbit(m: EngineModel, focusId: string): OrbitModel | null {
  const focus = m.cards.get(focusId);
  if (!focus) return null;
  const nb = m.partners.get(focusId) ?? new Map();
  const groupByTag = new Map(m.groups.map((g) => [g.tag, g]));
  const rank = new Map(m.groups.map((g, i) => [g.tag, g.helper ? 1000 + i : i]));

  const sectors = new Map<string, OrbitSector>();
  for (const [id, pair] of nb) {
    const card = m.cards.get(id);
    if (!card) continue;
    const links = [...pair.links].sort((a, b) => Number(a.repeat === "oneshot") - Number(b.repeat === "oneshot"));
    // The sector is the partner's strongest line's group: a repeating line over a one-time one, and
    // a group the deck is doing over a helper that touches everything.
    const grouped = links.filter((l) => groupByTag.has(l.tag))
      .sort((a, b) => Number(a.repeat === "oneshot") - Number(b.repeat === "oneshot") || rank.get(a.tag)! - rank.get(b.tag)!);
    const group = grouped[0] ? groupByTag.get(grouped[0].tag) : undefined;
    const key = group?.tag ?? "";
    if (!sectors.has(key)) sectors.set(key, { group, name: group?.name ?? "Other links", hue: group?.hue ?? OTHER_HUE, partners: [] });
    sectors.get(key)!.partners.push({ card, links, once: pair.once });
  }
  const ordered = [...sectors.values()].sort((a, b) =>
    (a.group ? rank.get(a.group.tag)! : 1e6) - (b.group ? rank.get(b.group.tag)! : 1e6));
  for (const s of ordered) {
    s.partners.sort((a, b) => Number(a.once) - Number(b.once) || b.card.score - a.card.score || a.card.name.localeCompare(b.card.name));
  }
  // One colour per sector on this card: a deck group keeps the Overview's, the rest take the next
  // one not used here.
  const used = new Set<string>();
  for (const s of ordered) if (s.group && !s.group.helper && !used.has(s.hue)) used.add(s.hue); else s.hue = "";
  for (const s of ordered) if (!s.hue) { s.hue = EXTRA_HUES.find((h) => !used.has(h)) ?? OTHER_HUE; used.add(s.hue); }

  // One entry per card, not per face: a back face whose card is already counted is left out, and
  // a card counts where it is closest (partner, then one step out, then not reached).
  const keyOf = (c: EngineCard) => c.faceOf ?? c.name;
  const counted = new Set<string>([keyOf(focus)]);
  let direct = 0, directTokens = 0;
  for (const id of nb.keys()) {
    const c = m.cards.get(id);
    if (!c) continue;
    if (c.isToken) directTokens++;
    else if (!counted.has(keyOf(c))) { counted.add(keyOf(c)); direct++; }
  }
  const near: OrbitModel["near"] = [];
  const rest: EngineCard[] = [];
  for (const c of m.cards.values()) {
    if (c.id === focusId || nb.has(c.id) || !deckCard(c)) continue;
    const via = [...(m.partners.get(c.id)?.keys() ?? [])].filter((x) => nb.has(x)).map((x) => m.cards.get(x)!)
      .sort((a, b) => b.score - a.score);
    if (via.length) near.push({ card: c, via });
    else rest.push(c);
  }
  const nearKept = near.filter((n) => !counted.has(keyOf(n.card)) && counted.add(keyOf(n.card)));
  near.length = 0;
  near.push(...nearKept);
  const far: EngineCard[] = [];
  let farLands = 0;
  for (const c of rest) {
    if (counted.has(keyOf(c))) continue;
    counted.add(keyOf(c));
    if (c.isLand) farLands++; else far.push(c);
  }
  near.sort((a, b) => b.via.length - a.via.length || a.card.name.localeCompare(b.card.name));
  far.sort((a, b) => a.name.localeCompare(b.name));
  return { focus, sectors: ordered, direct, directTokens, near, through: groupThrough(m, near), far, farLands };
}

/** Which partners get a disc when there is room for `cap`: each sector keeps a share by its size,
 *  at least one, so a small group is never dropped for a big one. The rest are counted on the
 *  sector's "+N" and listed in full in the panel. */
export function visiblePartners(o: OrbitModel, cap: number): { sector: OrbitSector; shown: OrbitPartner[]; hidden: number; hiddenOnce: number }[] {
  const total = o.sectors.reduce((t, s) => t + s.partners.length, 0);
  if (total <= cap) return o.sectors.map((s) => ({ sector: s, shown: s.partners, hidden: 0, hiddenOnce: 0 }));
  // Largest remainder over the sectors, one disc each first.
  const room = Math.max(0, cap - o.sectors.length);
  const quota = o.sectors.map((s) => 1 + Math.floor((room * (s.partners.length - 1)) / Math.max(1, total - o.sectors.length)));
  let left = cap - quota.reduce((t, q) => t + q, 0);
  const order = o.sectors.map((_, i) => i).sort((a, b) => o.sectors[b]!.partners.length - o.sectors[a]!.partners.length);
  for (const i of order) { if (left <= 0) break; if (quota[i]! < o.sectors[i]!.partners.length) { quota[i]!++; left--; } }
  return o.sectors.map((s, i) => {
    const n = Math.min(s.partners.length, quota[i]!);
    const shown = s.partners.slice(0, n);
    // A sector with one-time links shows one, so the dashed line the key promises is on the ring:
    // repeating partners sort first, and every one-time partner hid behind "+N" (orbit round 2).
    const firstOnce = s.partners.find((p) => p.once);
    if (firstOnce && !shown.includes(firstOnce) && n >= 2) shown[n - 1] = firstOnce;
    return { sector: s, shown, hidden: s.partners.length - n, hiddenOnce: s.partners.filter((p) => p.once && !shown.includes(p)).length };
  });
}

/** Greedy cover: the partner linking the most remaining cards takes them, then the next. */
function groupThrough(m: EngineModel, near: OrbitModel["near"]): OrbitModel["through"] {
  const left = new Map(near.map((n) => [n.card.id, n]));
  const out: OrbitModel["through"] = [];
  while (left.size) {
    const count = new Map<string, number>();
    for (const n of left.values()) for (const v of n.via) count.set(v.id, (count.get(v.id) ?? 0) + 1);
    const [best] = [...count.entries()].sort((a, b) => b[1] - a[1] || (m.cards.get(b[0])!.score - m.cards.get(a[0])!.score) || a[0].localeCompare(b[0]));
    if (!best) break;
    const via = m.cards.get(best[0])!;
    const cards = [...left.values()].filter((n) => n.via.some((v) => v.id === via.id)).map((n) => n.card);
    for (const c of cards) left.delete(c.id);
    // One sentence to check the group by: a repeating one, from the best-known card in it.
    const links = cards.flatMap((c) => m.partners.get(c.id)?.get(via.id)?.links ?? []);
    const example = links.find((l) => l.repeat !== "oneshot") ?? links[0];
    const lines = new Map(cards.map((c) => [c.id, m.partners.get(c.id)?.get(via.id)?.links ?? []]));
    out.push({ via, cards: cards.sort((a, b) => a.name.localeCompare(b.name)), example, lines });
  }
  return out;
}
