/** HOW FAR DOES THE BOARD MOVE WHEN ONE CARD CHANGES? (roadmap H9)
 *
 *  The board is becoming a deckbuilding surface, where add / remove / swap are the verbs. Force
 *  layout re-settles GLOBALLY, so every other card moves when one arrives — the question is whether
 *  that reads as "the deck adjusted to admit this card" or as a scramble, and the answer is a
 *  distance, not an opinion.
 *
 *    npx tsx board-edit.harness.ts               every checked-in fixture
 *    npx tsx board-edit.harness.ts sorin inalla  named fixtures
 *
 *  THE CRITERION, registered before the numbers existed: p95 displacement of PRE-EXISTING nodes
 *  above one card diagonal (SETTLED_SPACING, 48.2 world units) means an edit throws the board
 *  around and local freezing (`fx`/`fy` beyond 2 hops of the change) has to be built. Below it,
 *  the shipped warm-start behaviour is enough and that work is not worth doing.
 *
 *  It reproduces GraphView's own edit path rather than inventing one: positions carry over
 *  (`prevPositions`), a brand-new node seeds at the centroid of whichever neighbours already have a
 *  position, and the simulation is reheated to REHEAT_ALPHA — the same 0.3 the layout effect uses
 *  for a graph change. The centroid seeding is three lines here rather than an import because
 *  `seedPosition` lives in a .tsx that pulls React and a canvas in with it. */
import { readFileSync, readdirSync } from "node:fs";
import { drawnEdges } from "./board-edges.js";
import { createBoardSimulation, SETTLED_SPACING, type Sim, type SimLink } from "./board-force.js";
import type { CardGraph } from "../types.js";

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url).pathname;
/** What the layout effect reheats to when the deck changes (GraphView.tsx). */
const REHEAT_ALPHA = 0.3;
/** Enough for alpha to decay from REHEAT_ALPHA to rest at ALPHA_DECAY 0.005. */
const RESETTLE_TICKS = 2000;
const SETTLE_TICKS = 4000;

interface Positioned { id: string; x: number; y: number }

/** A seeded LCG, so a run is reproducible — the same one board-trial.ts uses and for the same
 *  reason: d3-force is deterministic, so all variance lives in the initial seeding. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}

function settle(
  graph: CardGraph,
  opts: { prev?: Map<string, Positioned>; alpha: number; ticks: number; random: () => number },
): Map<string, Positioned> {
  const neighborsOf = new Map<string, string[]>();
  for (const e of graph.edges) {
    (neighborsOf.get(e.from) ?? neighborsOf.set(e.from, []).get(e.from)!).push(e.to);
    (neighborsOf.get(e.to) ?? neighborsOf.set(e.to, []).get(e.to)!).push(e.from);
  }
  const nodes: Sim[] = graph.nodes.map((n, i) => {
    const prev = opts.prev?.get(n.id);
    if (prev) return { ...n, x: prev.x, y: prev.y, vx: 0, vy: 0, deg: 0 };
    // seedPosition's rule: the centroid of whichever neighbours already have a position.
    let sx = 0, sy = 0, count = 0;
    for (const id of neighborsOf.get(n.id) ?? []) {
      const p = opts.prev?.get(id);
      if (!p) continue;
      sx += p.x; sy += p.y; count++;
    }
    return count > 0
      ? { ...n, x: sx / count, y: sy / count, vx: 0, vy: 0, deg: 0 }
      : { ...n, x: Math.cos(i) * 260 + opts.random() * 30, y: Math.sin(i) * 260 + opts.random() * 30, vx: 0, vy: 0, deg: 0 };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: SimLink[] = drawnEdges(graph.edges)
    .map((e) => ({ source: byId.get(e.from), target: byId.get(e.to), weight: e.weight }))
    .filter((l): l is SimLink => Boolean(l.source && l.target));
  for (const l of links) { l.source.deg++; l.target.deg++; }
  const sim = createBoardSimulation({ nodes, links });
  sim.alpha(opts.alpha);
  for (let i = 0; i < opts.ticks; i++) sim.tick();
  return new Map(nodes.map((n) => [n.id, { id: n.id, x: n.x, y: n.y }]));
}

const without = (g: CardGraph, id: string): CardGraph => ({
  ...g,
  nodes: g.nodes.filter((n) => n.id !== id),
  edges: g.edges.filter((e) => e.from !== id && e.to !== id),
});

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!;
}

/** Displacement of every node the two states share. The changed card itself is excluded by
 *  construction — it is not in both.
 *
 *  TWO NUMBERS, AND THE SECOND ONE IS THE ONE THAT MATTERS. A raw displacement counts a board that
 *  slid sideways as though every card had been rearranged: `forceX`/`forceY` pull toward a FIXED
 *  origin, so removing a node moves the cloud's centre of mass and every card with it. That is
 *  DRIFT — the shape is intact and only the camera is stale. Subtracting the common-mode
 *  translation leaves the part a player would read as their deck being rearranged. */
function shift(before: Map<string, Positioned>, after: Map<string, Positioned>) {
  const pairs: { dx: number; dy: number }[] = [];
  for (const [id, b] of before) {
    const a = after.get(id);
    if (a) pairs.push({ dx: a.x - b.x, dy: a.y - b.y });
  }
  const mdx = pairs.reduce((t, p) => t + p.dx, 0) / (pairs.length || 1);
  const mdy = pairs.reduce((t, p) => t + p.dy, 0) / (pairs.length || 1);
  const raw = pairs.map((p) => Math.hypot(p.dx, p.dy)).sort((x, y) => x - y);
  const rel = pairs.map((p) => Math.hypot(p.dx - mdx, p.dy - mdy)).sort((x, y) => x - y);
  return {
    p50: quantile(raw, 0.5),
    p95: quantile(raw, 0.95),
    max: raw.at(-1) ?? 0,
    drift: Math.hypot(mdx, mdy),
    relP50: quantile(rel, 0.5),
    relP95: quantile(rel, 0.95),
    n: raw.length,
  };
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith("-graph.json"))
  .filter((f) => args.length === 0 || args.some((a) => f.startsWith(a)))
  .sort();

console.log(`one card changes · reheat alpha ${REHEAT_ALPHA} · displacement of PRE-EXISTING nodes, world units`);
console.log(`card diagonal (the criterion) = ${SETTLED_SPACING.toFixed(1)}`);
console.log("fixture | reheat | edit | card (deg) | p50 | rel p95 | max");

// THE CONTROL, and it has to come first. If reheating a settled board to REHEAT_ALPHA moves it this
// far with NO edit at all, then "an edit rearranges the board" is the wrong sentence: the REHEAT
// rearranges it, and freezing nodes around the change would fix nothing.
console.log("\n-- control: reheat a settled board, change NOTHING --");
console.log("fixture | reheat alpha | p50 | p95 | max");
for (const file of files) {
  const name = file.replace("-graph.json", "");
  const graph = (JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")) as { graph: CardGraph }).graph;
  const settled = settle(graph, { alpha: 1, ticks: SETTLE_TICKS, random: lcg(1) });
  for (const alpha of [REHEAT_ALPHA, 0.1, 0.05, 0.02]) {
    const again = settle(graph, { prev: settled, alpha, ticks: RESETTLE_TICKS, random: lcg(1) });
    const m = shift(settled, again);
    console.log(`${name} | ${alpha} | ${m.p50.toFixed(1)} | ${m.p95.toFixed(1)} | ${m.max.toFixed(1)}`);
  }
}

console.log("\n-- one card changes --");
const rows: { p95: number; label: string }[] = [];
for (const file of files) {
  const name = file.replace("-graph.json", "");
  const graph = (JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")) as { graph: CardGraph }).graph;
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  const ranked = [...graph.nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0));
  // A HUB, A MEDIAN CARD AND A LEAF. One sample would say nothing: removing the commander and
  // removing a card with two edges are different edits and the board should be judged on both.
  const picks = [
    { role: "hub", node: ranked[0]! },
    { role: "median", node: ranked[Math.floor(ranked.length / 2)]! },
    { role: "leaf", node: ranked.at(-1)! },
  ];

  for (const { role, node } of picks) {
   for (const reheat of [REHEAT_ALPHA, 0.05]) {
    const deg = degree.get(node.id) ?? 0;
    const random = lcg(1);
    const full = settle(graph, { alpha: 1, ticks: SETTLE_TICKS, random });
    const reduced = without(graph, node.id);

    // REMOVE: settled full board, drop the card, reheat.
    const afterRemove = settle(reduced, { prev: full, alpha: reheat, ticks: RESETTLE_TICKS, random });
    const rm = shift(new Map([...full].filter(([id]) => id !== node.id)), afterRemove);

    // ADD: settle WITHOUT the card first, then bring it back — the editor's actual verb.
    const partial = settle(reduced, { alpha: 1, ticks: SETTLE_TICKS, random: lcg(1) });
    const afterAdd = settle(graph, { prev: partial, alpha: reheat, ticks: RESETTLE_TICKS, random });
    const add = shift(partial, afterAdd);

    // DID THE NEW CARD LAND SOMEWHERE SENSIBLE? A gentler reheat buys stability, and what it could
    // cost is the added card itself: too little energy and it stays at the seed point its
    // neighbours' centroid put it at, possibly inside another card. Two checks — how far it moved
    // from that seed, and how many cards it ends up sitting on top of.
    const placed = afterAdd.get(node.id)!;
    const seeded = (() => {
      let sx = 0, sy = 0, c = 0;
      for (const e of graph.edges) {
        const other = e.from === node.id ? e.to : e.to === node.id ? e.from : null;
        const p = other ? partial.get(other) : null;
        if (p) { sx += p.x; sy += p.y; c++; }
      }
      return c > 0 ? { x: sx / c, y: sy / c } : { x: 0, y: 0 };
    })();
    const travelled = Math.hypot(placed.x - seeded.x, placed.y - seeded.y);
    let onTopOf = 0;
    for (const [id, o] of afterAdd) {
      if (id === node.id) continue;
      if (Math.hypot(placed.x - o.x, placed.y - o.y) < SETTLED_SPACING * 0.6) onTopOf++;
    }
    const row = (edit: string, m: ReturnType<typeof shift>, extra = "") =>
      `${name} | a${reheat} | ${edit} | ${role} (${deg}) | ${m.p50.toFixed(1)} | ${m.relP95.toFixed(1)} | ${m.max.toFixed(1)}${extra}`;
    console.log(row("remove", rm));
    console.log(row("add   ", add, ` | new card moved ${travelled.toFixed(0)} from seed, overlapping ${onTopOf}`));
    rows.push(
      { p95: rm.relP95, label: `${name}/a${reheat}/remove/${role}` },
      { p95: add.relP95, label: `${name}/a${reheat}/add/${role}` },
    );
   }
  }
}

// THE BULK ARM, and it is the edit the product ACTUALLY performs today: the LANDS chip reveals ~31
// hidden nodes at once. A reheat tuned on one card has to survive a third of the board arriving, or
// the lands land in a heap on top of the deck.
console.log("\n-- bulk: reveal every hidden land (the LANDS chip) --");
console.log("fixture | reheat | lands | board p50 | board p95 | lands overlapping something | lands still at seed");
for (const file of files) {
  const name = file.replace("-graph.json", "");
  const graph = (JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")) as { graph: CardGraph }).graph;
  const landIds = new Set(graph.nodes.filter((n) => (n.types ?? []).includes("land")).map((n) => n.id));
  if (landIds.size === 0) { console.log(`${name} | (no land nodes in this fixture)`); continue; }
  const withoutLands: CardGraph = {
    ...graph,
    nodes: graph.nodes.filter((n) => !landIds.has(n.id)),
    edges: graph.edges.filter((e) => !landIds.has(e.from) && !landIds.has(e.to)),
  };
  const base = settle(withoutLands, { alpha: 1, ticks: SETTLE_TICKS, random: lcg(1) });
  for (const alpha of [REHEAT_ALPHA, 0.1, 0.05]) {
    const after = settle(graph, { prev: base, alpha, ticks: RESETTLE_TICKS, random: lcg(1) });
    const m = shift(base, after);
    let stacked = 0, atSeed = 0;
    for (const id of landIds) {
      const p = after.get(id);
      if (!p) continue;
      let near = 0;
      for (const [other, o] of after) {
        if (other === id) continue;
        if (Math.hypot(p.x - o.x, p.y - o.y) < SETTLED_SPACING * 0.6) near++;
      }
      if (near > 0) stacked++;
      // A land with no in-deck synergy edge has no neighbours to seed from, so it starts on the
      // fallback ring; one that never moved is one the reheat could not place.
      const seededAt = after.get(id)!;
      const before = base.get(id);
      if (before && Math.hypot(seededAt.x - before.x, seededAt.y - before.y) < 1) atSeed++;
    }
    console.log(`${name} | a${alpha} | ${landIds.size} | ${m.p50.toFixed(1)} | ${m.p95.toFixed(1)} | ${stacked} | ${atSeed}`);
  }
}

const over = rows.filter((r) => r.p95 > SETTLED_SPACING);
console.log(`\n${rows.length} edits measured · ${over.length} with DRIFT-CORRECTED p95 over one card diagonal (${SETTLED_SPACING.toFixed(1)})`);
for (const r of over) console.log(`  OVER: ${r.label} p95 ${r.p95.toFixed(1)}`);
if (over.length === 0) console.log("  Every edit settles within a card diagonal: local freezing is not needed.");
