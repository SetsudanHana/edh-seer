/** DOES A DECK'S SYNERGY GRAPH HAVE COMMUNITIES AT ALL? (roadmap H10) Free: reads the corpus, spends
 *  nothing, writes nothing.
 *
 *    tsx src/bin/graph-modularity.ts
 *
 *  This gates two proposals at once, and it exists so neither gets designed on a hunch:
 *   - CLUSTER PAINT — a facet that tints a card's rim by which synergy community it belongs to. Only
 *     meaningful if the communities are real.
 *   - SUPER-NODE AGGREGATION — collapsing a community into one expandable node. The single most
 *     expensive-to-reverse idea on the board's list (it changes the data contract, the interaction
 *     model and the flow semantics together), and worthless if a deck is one mesh.
 *
 *  BE SUSPICIOUS IN ADVANCE: the engine's own corpus says these decks are substantially ONE thing on
 *  purpose — `enters:creature` closes a real loop in 61 of the 71 decks (CLAUDE.md, the theme
 *  ranking refusals). A deck is BUILT to have everything work with everything.
 *
 *  Greedy modularity (Clauset-Newman-Moore): start with every node in its own community and merge
 *  the pair that gains the most modularity until nothing gains. ~50 lines, no new dependency, and
 *  the standard first answer to "does this graph split". Q is the usual scale: below ~0.3 the
 *  structure is weak, 0.3-0.7 is a genuinely modular graph. */
import { readFileSync, readdirSync } from "node:fs";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames } from "@edh-seer/data";
import { ComboIndex, loadImpactWeights } from "@edh-seer/engine";
import { createTagsLookup } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, collectTokenNodes, faceDeckCards, loadTokenTags } from "../index.js";
import { projectDeckGraph } from "../graph-projection.js";

interface Edge { from: string; to: string; weight: number }

/** Greedy agglomerative modularity. Undirected, weighted; a pair of nodes with edges both ways is
 *  one relation of summed weight, which is what the board draws. */
function communities(nodeIds: string[], edges: Edge[]): { q: number; sizes: number[] } {
  const idx = new Map(nodeIds.map((id, i) => [id, i]));
  const n = nodeIds.length;
  if (n === 0 || edges.length === 0) return { q: 0, sizes: nodeIds.map(() => 1) };

  const w: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  let m2 = 0; // 2m, the total weight doubled
  const k = new Array<number>(n).fill(0);
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    w[a]!.set(b, (w[a]!.get(b) ?? 0) + e.weight);
    w[b]!.set(a, (w[b]!.get(a) ?? 0) + e.weight);
    k[a]! += e.weight; k[b]! += e.weight;
    m2 += 2 * e.weight;
  }
  if (m2 === 0) return { q: 0, sizes: nodeIds.map(() => 1) };

  const comm = nodeIds.map((_, i) => i);
  const members: Set<number>[] = nodeIds.map((_, i) => new Set([i]));
  const ktot = [...k];
  const live = new Set(nodeIds.map((_, i) => i));

  /** Modularity gain from merging communities a and b: 2 * (e_ab/2m - k_a*k_b/(2m)^2). */
  const gain = (a: number, b: number, eab: number): number =>
    2 * (eab / m2 - (ktot[a]! * ktot[b]!) / (m2 * m2));

  // Community-level weights, rebuilt as merges happen.
  const cw: Map<number, number>[] = w.map((row) => new Map(row));

  for (;;) {
    let best = { a: -1, b: -1, dq: 0 };
    for (const a of live) {
      for (const [b, eab] of cw[a]!) {
        if (b <= a || !live.has(b)) continue;
        const dq = gain(a, b, eab);
        if (dq > best.dq) best = { a, b, dq };
      }
    }
    if (best.a < 0) break;
    const { a, b } = best;
    for (const [other, weight] of cw[b]!) {
      if (other === a) continue;
      cw[a]!.set(other, (cw[a]!.get(other) ?? 0) + weight);
      cw[other]!.set(a, (cw[other]!.get(a) ?? 0) + weight);
      cw[other]!.delete(b);
    }
    cw[a]!.delete(b);
    for (const member of members[b]!) { members[a]!.add(member); comm[member] = a; }
    ktot[a]! += ktot[b]!;
    live.delete(b);
  }

  // Q of the final partition, computed from scratch rather than accumulated, so a bug in the merge
  // bookkeeping cannot inflate the headline number.
  let q = 0;
  const byComm = new Map<number, number[]>();
  for (let i = 0; i < n; i++) (byComm.get(comm[i]!) ?? byComm.set(comm[i]!, []).get(comm[i]!)!).push(i);
  for (const group of byComm.values()) {
    const inGroup = new Set(group);
    let inside = 0, degree = 0;
    for (const i of group) {
      degree += k[i]!;
      for (const [j, weight] of w[i]!) if (inGroup.has(j)) inside += weight;
    }
    q += inside / m2 - (degree / m2) ** 2;
  }
  return { q, sizes: [...byComm.values()].map((g) => g.length).sort((x, y) => y - x) };
}

const DIR = process.argv[2] ?? "packages/cli/decks/calibration";
const store = await connect(loadConfig());
const lookup = mongoLookup(store);
const tags = createTagsLookup(store.db);
const tokenTags = await loadTokenTags(store.db);
const weights = loadImpactWeights();

const rows: { deck: string; nodes: number; edges: number; q: number; sizes: number[] }[] = [];
for (const file of readdirSync(DIR).filter((f) => f.endsWith(".txt")).sort()) {
  const sections = parseDecklistSections(readFileSync(`${DIR}/${file}`, "utf8"));
  const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
  const cmd = new Set(sections.commanders.map(normalizeName));
  const commanderNames = cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name);
  const deckCards = await buildDeckCards(cards, lookup, tags);
  const r = analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
  // The SAME construction the server uses (data.module.ts): reasons off the report's edges, and the
  // deck array split into its printed FACES and extended with token nodes -- either omission drops
  // real reasons into `offDeckReasons`, because `projectDeckGraph` builds its node set off this
  // array and nothing else. Review fix, 2026-08-27: this comment already claimed the SAME
  // construction while missing `faceDeckCards` entirely, so a face-stamped reason (Task 7,
  // faces-as-nodes) named a `face:<n>:<name>` id absent from this deck's nodes and every one of
  // them fell into `offDeckReasons`. `buildDeckCards` already returns one entry per physical copy
  // (unlike the server's deduped-then-re-expanded `deckCards`), so no copy-expansion step is needed
  // here -- only the face split.
  const reasons = r.edges.flatMap((e) => e.reasons);
  const projectionDeck = [...deckCards.flatMap((dc) => faceDeckCards(dc)), ...collectTokenNodes(deckCards, tokenTags).nodes];
  const projected = projectDeckGraph(projectionDeck, reasons, weights);
  const { q, sizes } = communities(projected.nodes.map((n) => n.id), projected.edges);
  rows.push({ deck: file.replace(/\.txt$/, ""), nodes: projected.nodes.length, edges: projected.edges.length, q, sizes });
  console.log(`${rows.length} ${file.replace(/\.txt$/, "")} nodes ${projected.nodes.length} edges ${projected.edges.length} Q ${q.toFixed(3)} biggest ${Math.round((sizes[0] ?? 0) / projected.nodes.length * 100)}% communities ${sizes.filter((s) => s > 1).length}`);
}

const qs = rows.map((r) => r.q).sort((a, b) => a - b);
const share = rows.map((r) => (r.sizes[0] ?? 0) / (r.nodes || 1)).sort((a, b) => a - b);
const at = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * p))]!;
console.log(`\n${rows.length} decks`);
console.log(`modularity Q      p25 ${at(qs, 0.25).toFixed(3)} · median ${at(qs, 0.5).toFixed(3)} · p75 ${at(qs, 0.75).toFixed(3)} · max ${at(qs, 1).toFixed(3)}`);
console.log(`biggest community p25 ${(at(share, 0.25) * 100).toFixed(0)}% · median ${(at(share, 0.5) * 100).toFixed(0)}% · p75 ${(at(share, 0.75) * 100).toFixed(0)}% of the board`);
console.log(`decks with Q >= 0.3 (a genuinely modular graph): ${rows.filter((r) => r.q >= 0.3).length} of ${rows.length}`);
console.log(`decks whose biggest community holds over half the board: ${rows.filter((r) => (r.sizes[0] ?? 0) / (r.nodes || 1) > 0.5).length} of ${rows.length}`);
process.exit(0);
