import type { CardGraph, GraphNode } from "../types.js";

/** What a room's `test` is allowed to look at. Deliberately flat and small: a predicate that can
 *  reach the whole graph is a predicate nobody can reason about, and every fact here is already
 *  reified as an edge the graph carries. */
export interface CardFacts {
  id: string;
  name: string;
  roles: readonly string[];
  /** FRONT face only. A modal DFC is what you cast, not what its back face happens to be. */
  types: readonly string[];
  subtypes: readonly string[];
  /** Colour IDENTITY, which is card-level -- the FACE-level COLOR edges are a different question. */
  colors: readonly string[];
  manaValue: number;
  copies: number;
}

/** One pass over the graph. Cheap enough to run per render, but callers should memoise on `graph`
 *  identity because the paint loop must not allocate. */
export function cardFacts(graph: CardGraph): CardFacts[] {
  const byId = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
  const out: CardFacts[] = [];

  // from -> edges, so each card is one lookup rather than a scan of every edge.
  const from = new Map<string, { to: string; kind: string; index?: number }[]>();
  for (const e of graph.edges) {
    const list = from.get(e.from);
    if (list) list.push(e);
    else from.set(e.from, [e]);
  }
  const labelsOf = (id: string, kind: string): string[] =>
    (from.get(id) ?? []).filter((e) => e.kind === kind).map((e) => byId.get(e.to)?.label ?? "");

  for (const n of graph.nodes) {
    if (n.kind !== "card") continue;
    // index === 0 is the front face. A single-faced card still gets one FACE edge, and its index
    // is 0, so there is no special case for the common shape.
    const front = (from.get(n.id) ?? []).find((e) => e.kind === "FACE" && (e.index ?? 0) === 0);
    const cmc = labelsOf(n.id, "CMC")[0];
    out.push({
      id: n.id,
      name: n.label,
      roles: n.roles ?? [],
      types: front ? labelsOf(front.to, "TYPE") : [],
      subtypes: front ? labelsOf(front.to, "SUBTYPE") : [],
      colors: labelsOf(n.id, "IDENTITY"),
      manaValue: cmc === undefined ? 0 : Number(cmc),
      copies: n.copies ?? 1,
    });
  }
  return out;
}
