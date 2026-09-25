/** THE BOARD'S MODEL: the simulation nodes and links for one graph, and the maps the paint pass
 *  and the gestures read off them.
 *
 *  Split out of `GraphView`'s layout effect (2026-09-25), where it was the first hundred lines. It
 *  is pure over its inputs apart from the simulation it creates: it reads the graph, the tuning
 *  parameters, whether the board is bare, and where each card sat in the previous layout, and it
 *  returns what the effect goes on to animate and draw. */
import type { CardGraph } from "../types.js";
import { drawnEdges } from "./board-edges.js";
import { EDIT_REHEAT_ALPHA, createBoardSimulation, type BoardParams, type Sim, type SimLink } from "./board-force.js";
import type { Point } from "./board-paint.js";

/** A stable pseudo-random number in [0, 1) for a node id — FNV-1a, so the SAME deck lays out the
 *  same way on every page load. This was `Math.random()`, which made the seed cloud different every
 *  time: a report can shrug at that, but the board is becoming a deckbuilding surface, and a player
 *  who has learned where their combo sits should not have to re-learn it because they refreshed.
 *  `salt` gives the y axis its own draw without a second hash function. */
export function jitterFromId(id: string, salt = ""): number {
  let h = 0x811c9dc5;
  const s = `${id}${salt}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/** Where a node that's new since the last render should start: the centroid of whichever of its
 *  neighbours already had a position (from the previous layout), so it visibly joins the cluster
 *  it connects to rather than dropping in at an arbitrary spot. Falls back to `fallback` when none
 *  of its neighbours are known yet (e.g. two brand-new nodes linked only to each other). */
export function seedPosition(neighborIds: string[], prevPositions: Map<string, Point>, fallback: Point): Point {
  let sx = 0, sy = 0, count = 0;
  for (const id of neighborIds) {
    const p = prevPositions.get(id);
    if (!p) continue;
    sx += p.x; sy += p.y; count++;
  }
  return count > 0 ? { x: sx / count, y: sy / count } : fallback;
}

/** What one layout of the board is made of. */
export interface BoardModel {
  /** No card had a position before this layout, so the simulation starts from full energy. */
  isFirstLayout: boolean;
  neighborsOf: Map<string, string[]>;
  nodes: Sim[];
  byId: Map<string, Sim>;
  /** The edges the board draws and the simulation pulls on. */
  links: SimLink[];
  /** Edges the board does not draw, kept for the flow view. Empty on a bare board. */
  undrawnLinks: SimLink[];
  tagsByPair: Map<string, string[]>;
  weightedDegree: Map<string, number>;
  maxWeight: number;
  /** Force-only links that seat a card's faces together; never drawn. */
  facePairLinks: SimLink[];
  simulation: ReturnType<typeof createBoardSimulation>;
}

export function buildBoardModel(
  graph: CardGraph, params: BoardParams, bare: boolean, prevPositions: Map<string, Sim>,
): BoardModel {
  const isFirstLayout = prevPositions.size === 0;

  // Neighbour lookup built from the raw edge list, before Sim objects exist -- only needed to
  // seed a brand-new node near what it connects to.
  const neighborsOf = new Map<string, string[]>();
  for (const e of graph.edges) {
    (neighborsOf.get(e.from) ?? neighborsOf.set(e.from, []).get(e.from)!).push(e.to);
    (neighborsOf.get(e.to) ?? neighborsOf.set(e.to, []).get(e.to)!).push(e.from);
  }

  const nodes: Sim[] = graph.nodes.map((n, i) => {
    const prev = prevPositions.get(n.id);
    if (prev) return { ...n, x: prev.x, y: prev.y, vx: prev.vx, vy: prev.vy, deg: 0 };
    const seed = seedPosition(neighborsOf.get(n.id) ?? [], prevPositions, {
      x: Math.cos(i) * 260 + jitterFromId(n.id) * 30,
      y: Math.sin(i) * 260 + jitterFromId(n.id, "y") * 30,
    });
    return { ...n, x: seed.x, y: seed.y, vx: 0, vy: 0, deg: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  // `{ source, target }` is what forceLink requires, so it is what the whole effect uses; the
  // wire says `from`/`to`. An edge naming a card the graph does not hold is dropped rather than
  // crashing the layout -- the fixtures assert offDeckReasons is 0, this is the runtime half.
  const toLink = (e: { from: string; to: string; weight: number; enabledBy?: readonly string[] }) =>
    ({ source: byId.get(e.from), target: byId.get(e.to), weight: e.weight, ...(e.enabledBy ? { enabledBy: e.enabledBy } : {}) });
  const isLink = (l: ReturnType<typeof toLink>): l is SimLink => Boolean(l.source && l.target);
  // THE ONE-CARD VIEW DRAWS EVERY EDGE IT HAS. The top-k budget exists to thin a 90-card mesh; on
  // a focus and its handful of partners it only cut the links that hold some partners in place,
  // so repulsion flung them far off the canvas and the fit (connected cards only) framed the rest.
  // Harmonic Prodigy's view said "9 of 70 partners" and showed six (2026-09-25 live review).
  const links: SimLink[] = (bare ? graph.edges : drawnEdges(graph.edges)).map(toLink).filter(isLink);
  // What the budget did NOT draw, kept aside for the paint loop only: a hovered or selected card
  // paints these too (see `litUndrawn`). Never a simulation link -- the layout is the budget's.
  const undrawnLinks: SimLink[] = bare ? [] : graph.edges.filter((e) => e.drawn === false).map(toLink).filter(isLink);
  // WHICH TAGS EACH DRAWN EDGE CARRIES, keyed the way `flowEdgeByPair` already keys. `SimLink`
  // deliberately does not carry them: it is the SIMULATION's type and the force layout has no
  // business knowing what a mechanism is. Graph-scoped, so it is rebuilt when the board's edges
  // change and never per frame.
  const tagsByPair = new Map<string, string[]>();
  for (const e of graph.edges) tagsByPair.set(`${e.from}>${e.to}`, e.tags);
  // Sum of weight over every link touching a node -- NOT `deg` (a partner COUNT) a few lines
  // below. An edge is binary but synergy has magnitude (CLAUDE.md): a card with six weak partners
  // must not outrank one with two strong ones for a label. Built once here, read every frame by
  // the label pass through the draw() closure below, never recomputed per frame.
  const weightedDegree = new Map<string, number>();
  for (const l of links) {
    l.source.deg++; l.target.deg++;
    weightedDegree.set(l.source.id, (weightedDegree.get(l.source.id) ?? 0) + l.weight);
    weightedDegree.set(l.target.id, (weightedDegree.get(l.target.id) ?? 0) + l.weight);
  }
  const maxWeight = links.reduce((m, l) => Math.max(m, l.weight), 0);

  // THE TWO FACES OF ONE CARD SIT TOGETHER — a FORCE-ONLY link, never a drawn edge.
  //
  // "Shared rim, no link" (owner's ruling, 2026-08-27) is a statement about the DATA: a permanent
  // is one face at a time (CR 712.8d-f), so an edge between the faces would claim a relation that
  // does not exist. But the layout positions purely by links, so with none the two faces landed
  // wherever their own partners pulled them, and a rim that says "these are one card" cannot say
  // it from across the board. Owner, testing a Jodah deck: "I can see just some random faces
  // right now, not next to each other ... if I have 10 cards which have flip side, I can not
  // distinguish if card is the same thing."
  //
  // So the pair is joined in the SIMULATION only. `links` — what the draw loop iterates, what the
  // legend counts, what `__graphProbe` reports — is untouched, so no edge is drawn, no arrow, no
  // hue, nothing for a count to see. Weight is the board's own maximum, which is the SHORTEST rest
  // length `linkDistanceFor` can return and the strongest spring `linkStrengthFor` can give,
  // without changing `maxWeight` itself and rescaling every real edge's distance.
  //
  // Ceiling: on a board whose every edge weighs 0 (or which has no edges at all) `maxWeight` is 0
  // and the spring is inert, so the faces scatter as before. That deck has no layout to speak of
  // anyway.
  const facesOfCard = new Map<string, Sim[]>();
  for (const n of nodes) {
    if (n.cardName === undefined || n.isToken) continue;
    const group = facesOfCard.get(n.cardName);
    if (group) group.push(n);
    else facesOfCard.set(n.cardName, [n]);
  }
  const facePairLinks: SimLink[] = [];
  for (const group of facesOfCard.values()) {
    // Consecutive pairs, not every combination: three faces chained 0-1-2 seat as a run, and a
    // clique would fight the collide force on a card nothing else in the deck touches.
    for (let i = 1; i < group.length; i++) {
      facePairLinks.push({ source: group[i - 1], target: group[i], weight: maxWeight });
    }
  }

  const simulation = createBoardSimulation({ nodes, links: [...links, ...facePairLinks], params });
  // A from-scratch graph gets full energy to organize; a graph that already has settled
  // positions only needs enough to let what changed find its place -- and how much that is, is
  // measured rather than guessed now. See EDIT_REHEAT_ALPHA (board-force.ts) for the table.
  //
  // It equals FIT_SETTLE_ALPHA, so a graph change now re-frames the camera on its FIRST tick
  // instead of ~6 s later. That is the better of the two behaviours (a fit that arrives seconds
  // after the change reads as the board moving on its own) and it is a coincidence of two
  // separately-chosen numbers, so do not couple them: the fit's threshold answers "settled
  // enough to frame", this answers "energy enough to admit a change".
  simulation.alpha(isFirstLayout ? 1 : EDIT_REHEAT_ALPHA);
  return { isFirstLayout, neighborsOf, nodes, byId, links, undrawnLinks, tagsByPair, weightedDegree, maxWeight, facePairLinks, simulation };
}
