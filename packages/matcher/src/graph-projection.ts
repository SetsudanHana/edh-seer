import { impactEdgeWeight, type ImpactWeights, type Reason } from "@mtg/engine";
import { parseTypeLineAllFaces } from "./typeline.js";
import type { DeckCard } from "./types.js";

/** One deck card. Every facet that used to be its own graph node -- `color:B`, `type:creature`,
 *  `cmc:3` -- is a FIELD here. A facet value as a node is a hub: `color:B` reached degree 83 in an
 *  84-card deck, which flattens shortest paths and merges unrelated structure under clustering. */
export interface ProjectedNode {
  /** Card name. The projection keys on name because `SynergyEdge` and `Reason` do. */
  id: string;
  label: string;
  copies: number;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  colors: string[];
  cmc: number;
  /** Attached by the server from the deck report; absent here. */
  roles?: string[];
  artCrop?: string;
}

/** A directed card->card edge: every reason from `producer` to `consumer`, collapsed. */
export interface ProjectedEdge {
  from: string;
  to: string;
  /** `impactEdgeWeight` over this pair's reasons: max per distinct tag, summed. */
  weight: number;
  /** Distinct reason tags contributing, for the inspector and for edge channel filters. */
  tags: string[];
  reasons: Reason[];
}

export interface ProjectedGraph {
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
  /** Reasons carrying no producer/consumer. The flat engine leaves those unset; the structured
   *  matcher sets them. Counted rather than assigned a direction -- a silent wrong answer is
   *  worse than a missing one, and a wrong arrow is a wrong sentence about the deck. */
  undirectedReasons: number;
  /** Reasons naming a card the deck does not hold. Should be 0; a nonzero value means the reason
   *  set and the card list disagree, which is a wiring bug worth seeing rather than swallowing. */
  offDeckReasons: number;
}

export interface ProjectOptions {
  /** Edges kept per node, by weight. Unioned across nodes so a mutual pick survives. */
  topK?: number;
  /** Absolute weight floor, applied after top-k. */
  floor?: number;
}

const DEFAULT_TOP_K = 4;
const DEFAULT_FLOOR = 0;

export function projectDeckGraph(
  deck: DeckCard[],
  reasons: Reason[],
  weights: ImpactWeights,
  opts: ProjectOptions = {},
): ProjectedGraph {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const floor = opts.floor ?? DEFAULT_FLOOR;

  const copies = new Map<string, number>();
  for (const d of deck) copies.set(d.card.name, (copies.get(d.card.name) ?? 0) + 1);

  const nodes: ProjectedNode[] = [];
  const seen = new Set<string>();
  for (const d of deck) {
    if (seen.has(d.card.name)) continue;
    seen.add(d.card.name);
    // EVERY face, because a node is the whole card. `parseTypeLine` takes one face and leaves "//"
    // visible; passing the combined line here painted a literal "//" swatch in the Type legend and,
    // worse, dropped the back face's type on any card whose front face has subtypes.
    const { types, subtypes, supertypes } = parseTypeLineAllFaces(
      d.card.typeLine, d.card.faces?.map((f) => f.typeLine));
    nodes.push({
      id: d.card.name,
      label: d.card.name,
      copies: copies.get(d.card.name) ?? 1,
      types, subtypes, supertypes,
      colors: d.card.colors,
      cmc: d.card.manaValue,
    });
  }

  let undirectedReasons = 0;
  let offDeckReasons = 0;
  const grouped = new Map<string, { from: string; to: string; reasons: Reason[] }>();
  for (const r of reasons) {
    if (!r.producer || !r.consumer) { undirectedReasons++; continue; }
    if (!seen.has(r.producer) || !seen.has(r.consumer)) { offDeckReasons++; continue; }
    const key = `${r.producer}->${r.consumer}`;
    const g = grouped.get(key) ?? { from: r.producer, to: r.consumer, reasons: [] };
    g.reasons.push(r);
    grouped.set(key, g);
  }

  const all: ProjectedEdge[] = [];
  for (const g of grouped.values()) {
    all.push({
      from: g.from,
      to: g.to,
      weight: impactEdgeWeight(g.reasons, weights),
      tags: [...new Set(g.reasons.map((r) => r.tag))],
      reasons: g.reasons,
    });
  }

  // Top-k per node, UNIONED. Taking each node's own k independently and unioning is what lets a
  // weak edge survive when it is the only one its other endpoint has -- an intersection would cut
  // exactly the peripheral cards whose single connection is the interesting fact about them.
  const incident = new Map<string, ProjectedEdge[]>();
  for (const e of all) {
    for (const id of [e.from, e.to]) {
      const list = incident.get(id) ?? [];
      list.push(e);
      incident.set(id, list);
    }
  }
  const kept = new Set<ProjectedEdge>();
  for (const list of incident.values()) {
    for (const e of [...list].sort((x, y) => y.weight - x.weight).slice(0, topK)) kept.add(e);
  }

  const edges = [...kept].filter((e) => e.weight >= floor).sort((a, b) => b.weight - a.weight);
  return { nodes, edges, undirectedReasons, offDeckReasons };
}
