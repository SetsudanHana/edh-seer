import type { EngineModel } from "./engine-model.js";

/** THE DECK AS A SKY (owner, 2026-09-27: "can we visualize other data in the report with the
 *  graph? So you know it becomes more of our identity"). One picture per deck, laid out the same
 *  way every time: the commander in the middle, each of the deck's themes a constellation around
 *  it, the cards no theme claims and the lands a faint band at the edge. Every chapter can light a
 *  different set of its stars, so the same sky says what the deck does, how it wins, what comes
 *  online first and what to cut.
 *
 *  NOT THE WHOLE-DECK BOARD AGAIN. The board drew every link and was a hairball; the owner retired
 *  it. A sky draws every CARD and only a few lines: inside each constellation, the fewest links
 *  that join its cards (a tree, as a star chart draws one), and whatever a chapter lights. */

export type StarKind = "commander" | "hub" | "member" | "rest" | "land";

export interface Star {
  id: string;
  name: string;
  x: number; y: number;
  kind: StarKind;
  /** The constellation's index, or -1 for the band at the edge. */
  cluster: number;
  hue: string;
}

export interface Cluster {
  tag: string; name: string; hue: string;
  x: number; y: number; r: number;
  /** Where its name goes: outside the constellation, away from the middle. */
  lx: number; ly: number; anchor: "start" | "middle" | "end";
  ids: string[];
}

export interface Sky {
  stars: Star[];
  byId: ReadonlyMap<string, Star>;
  clusters: Cluster[];
  /** The constellation lines: inside each theme, and from the commander to the themes it leads. */
  lines: [string, string][];
  box: { x: number; y: number; w: number; h: number };
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** A stable number in [0, 1) from a card's id, so the band's scatter is the same every visit. */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10007) / 10007;
}

export const REST_HUE = "#8a8494";

export function deckSky(m: EngineModel): Sky {
  const cards = [...m.cards.values()].filter((c) => !c.isToken && !c.isFace);
  const commanders = cards.filter((c) => c.isCommander);
  const all = m.groups.filter((g) => !g.helper);
  const linked = (a: string, b: string) => !!m.partners.get(a)?.get(b);
  const score = (id: string) => m.cards.get(id)?.score ?? 0;

  // Each card joins the first theme it belongs to (themes come strongest first): one place each.
  // A theme every one of whose cards an earlier theme took has no stars of its own, and no name.
  const first = new Map<string, number>();
  for (const c of cards) {
    if (c.isCommander) continue;
    const gi = all.findIndex((g) => g.hubs.includes(c.id) || g.members.includes(c.id));
    if (gi >= 0) first.set(c.id, gi);
  }
  const groups = all.filter((_, gi) => [...first.values()].includes(gi));
  const home = new Map([...first].map(([id, gi]) => [id, groups.indexOf(all[gi]!)] as const));

  const stars: Star[] = [];
  const clusters: Cluster[] = [];
  const lines: [string, string][] = [];

  // THE MIDDLE: the commander, or both halves of a pair side by side.
  commanders.forEach((c, i) => {
    const x = commanders.length > 1 ? (i - (commanders.length - 1) / 2) * 70 : 0;
    stars.push({ id: c.id, name: c.name, x, y: 0, kind: "commander", cluster: -1, hue: "var(--foreground)" });
  });

  // THE CONSTELLATIONS, evenly round the middle, first at the top. A bigger theme sits further out
  // so neighbours do not touch.
  const n = groups.length;
  const sizes = groups.map((_, gi) => cards.filter((c) => home.get(c.id) === gi).length);
  const spread = (k: number) => 9 + 13 * Math.sqrt(k);
  const radii = sizes.map(spread);
  // EACH THEME AS CLOSE AS IT CAN SIT: clear of the commander, and of both neighbours on the ring.
  // One distance for all put three-card themes as far out as a forty-card one.
  const chord = n > 1 ? 2 * Math.sin(Math.PI / n) : 1;
  const dist = radii.map((r, i) => {
    const nb = n > 1 ? Math.max(radii[(i + 1) % n]!, radii[(i + n - 1) % n]!) : 0;
    return Math.max(80 + r, n > 1 ? (r + nb + 40) / chord : 0);
  });
  const ring = Math.max(0, ...dist);
  groups.forEach((g, gi) => {
    const a = -Math.PI / 2 + (2 * Math.PI * gi) / Math.max(1, n);
    const cx = Math.cos(a) * dist[gi]!, cy = Math.sin(a) * dist[gi]!;
    // Key cards at the heart, then the rest by how much they do here: a sunflower, so it packs
    // evenly without a simulation and is the same every time.
    const ids = cards.filter((c) => home.get(c.id) === gi).map((c) => c.id)
      .sort((x, y) => Number(g.hubs.includes(y)) - Number(g.hubs.includes(x)) || score(y) - score(x) || (x < y ? -1 : 1));
    const step = 13;
    ids.forEach((id, k) => {
      const r = step * Math.sqrt(k + 0.5), t = k * GOLDEN + a;
      stars.push({ id, name: m.cards.get(id)!.name, x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r, kind: g.hubs.includes(id) ? "hub" : "member", cluster: gi, hue: g.hue });
    });
    const r = spread(ids.length);
    // The name centred over the constellation, or under it in the lower half of the sky: set
    // beside it, a long name ran off the picture's edge.
    const below = Math.sin(a) > 0.2;
    clusters.push({
      tag: g.tag, name: g.name, hue: g.hue, x: cx, y: cy, r,
      lx: cx, ly: below ? cy + r + 16 : cy - r - 10, anchor: "middle", ids,
    });
    // THE CONSTELLATION'S LINES: from its key card outward, each card joined to the nearest card
    // already drawn that it actually works with. A card that works with none of them stays a star.
    const placed = new Map(stars.filter((s) => s.cluster === gi).map((s) => [s.id, s] as const));
    const inTree: string[] = ids.length ? [ids[0]!] : [];
    for (const id of ids.slice(1)) {
      const s = placed.get(id)!;
      let best: string | null = null, bestD = Infinity;
      for (const t of inTree) {
        if (!linked(id, t)) continue;
        const u = placed.get(t)!, d = Math.hypot(u.x - s.x, u.y - s.y);
        if (d < bestD) { bestD = d; best = t; }
      }
      if (best) lines.push([best, id]);
      inTree.push(id);
    }
    // The commander reaches into each theme through its key card, where it works with it.
    for (const c of commanders) {
      const hub = ids.find((id) => linked(c.id, id));
      if (hub) lines.push([c.id, hub]);
    }
  });

  // THE BAND AT THE EDGE: what no theme claims, and the lands, fainter still.
  const outer = Math.max(ring, ...clusters.map((c) => Math.hypot(c.x, c.y) + c.r)) + 45;
  const rest = cards.filter((c) => !c.isCommander && !home.has(c.id));
  rest.sort((x, y) => Number(x.isLand) - Number(y.isLand) || (x.id < y.id ? -1 : 1));
  rest.forEach((c, i) => {
    const t = -Math.PI / 2 + (2 * Math.PI * (i + hash01(c.id) * 0.6)) / Math.max(1, rest.length);
    const r = outer + (hash01(`${c.id}#r`) - 0.5) * 50 + (c.isLand ? 30 : 0);
    stars.push({ id: c.id, name: c.name, x: Math.cos(t) * r, y: Math.sin(t) * r, kind: c.isLand ? "land" : "rest", cluster: -1, hue: REST_HUE });
  });

  const xs = stars.map((s) => s.x), ys = stars.map((s) => s.y);
  const pad = 70;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys, ...clusters.map((c) => c.ly)) - pad, y1 = Math.max(...ys, ...clusters.map((c) => c.ly)) + pad;
  return { stars, byId: new Map(stars.map((s) => [s.id, s])), clusters, lines, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

/** Every link from `ids` to another card on the sky, once each: the lines a chapter draws to show
 *  how a set of cards is tied into the deck. Tokens are not stars, so a link to one is left off. */
export function linksFrom(m: EngineModel, ids: Iterable<string>): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const other of m.partners.get(id)?.keys() ?? []) {
      const c = m.cards.get(other);
      if (!c || c.isToken || c.isFace) continue;
      const k = id < other ? `${id}|${other}` : `${other}|${id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([id, other]);
    }
  }
  return out;
}

/** The links inside a set of cards: a plan's own shape, a combo's loop. */
export function linksWithin(m: EngineModel, ids: ReadonlySet<string>): [string, string][] {
  return linksFrom(m, ids).filter(([, b]) => ids.has(b));
}
