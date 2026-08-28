import { impactEdgeWeight, type ImpactWeights, type Reason } from "@edh-seer/engine";
import { parseTypeLineAllFaces } from "./typeline.js";
import type { DeckCard } from "./types.js";

/** One deck card. Every facet that used to be its own graph node -- `color:B`, `type:creature`,
 *  `cmc:3` -- is a FIELD here. A facet value as a node is a hub: `color:B` reached degree 83 in an
 *  84-card deck, which flattens shortest paths and merges unrelated structure under clustering. */
export interface ProjectedNode {
  /** Node identity. The card's name for a real card; `token:<name>` for a token node, because a
   *  NAME IS NOT AN IDENTITY -- 92 of the corpus's 661 distinct token names are also a real card,
   *  and a card making a token copy of itself puts both in one deck. Keyed on the name alone, the
   *  two collapsed into one node and the token's relations were read as the card's. */
  id: string;
  /** What the node is CALLED -- the plain name, token or not. */
  label: string;
  /** True on a token node. Present so the view can mark it as one rather than inferring it from
   *  the id's shape. */
  isToken?: boolean;
  copies: number;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  /** The card's PRINTED type line, faces and all -- "Legendary Creature — Human Citizen //
   *  Legendary Artifact".
   *
   *  Carried BESIDE the three lists above rather than instead of them, because they answer
   *  different questions and both answers are needed. The lists are the UNION over every face,
   *  which is right for painting (a node shows a hue per type it can be) and is deliberately not
   *  the printed line -- see `parseTypeLineAllFaces`'s call site. But recomposing a type line FROM
   *  that union invents an object no face is: a skeptic review, 2026-08-27, read
   *  "legendary artifact creature — robot vehicle" under a card image printing
   *  "Legendary Artifact Creature — Robot" and said "merging them describes an object that neither
   *  face is". A surface that shows the card should show what the card says.
   *
   *  OPTIONAL, because a graph built before this field existed has none and a surface must not
   *  break on one -- the inspector falls back to the recomposed line, which is worse and is still
   *  better than nothing. Every graph this function builds carries it. */
  typeLine?: string;
  /** The card's own oracle text, so a surface that makes a CLAIM about this card can show the
   *  evidence beside it. A skeptic review (2026-08-27) could audit only the two pairs it believed
   *  it already knew, and misremembered BOTH cards' printed text -- concluding "a right answer and
   *  a wrong answer are the same pixels". The engine was right both times and could not prove it. */
  oracleText?: string;
  colors: string[];
  cmc: number;
  /** Which printed face this node is, 1 or more for a back face. Absent on a front face and on a
   *  single-face card. The view marks the faces of one card with a matching rim; nothing is drawn
   *  between them (owner's ruling -- no new edge kind in the legend or in any count). */
  face?: number;
  /** The PHYSICAL card this node is a face of, present only when it is one. The rim pairs on this,
   *  and the cut list names it, because you cannot cut half a card. */
  cardName?: string;
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

/** The prefix that separates a token node from a card of the same name. Exported because the view
 *  reads node ids and a caller comparing an id against a card name has to know the shape. */
export const TOKEN_ID_PREFIX = "token:";

/** The prefix that separates a BACK face from the card it is a face of. Exported for the same reason
 *  `TOKEN_ID_PREFIX` is: the view reads node ids. */
export const FACE_ID_PREFIX = "face:";

/** A node's identity. Tokens are prefixed; a BACK face is prefixed with its index; the FRONT face and
 *  every single-face card keep the bare card name, so every id that existed before faces were nodes
 *  still reads exactly as it did -- `pairs.json`'s 895 panel keys and every fixture included. */
export function nodeId(name: string, isToken?: boolean, face?: number): string {
  if (isToken) return `${TOKEN_ID_PREFIX}${name}`;
  return face ? `${FACE_ID_PREFIX}${face}:${name}` : name;
}

export function projectDeckGraph(
  deck: DeckCard[],
  reasons: Reason[],
  weights: ImpactWeights,
  opts: ProjectOptions = {},
): ProjectedGraph {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const floor = opts.floor ?? DEFAULT_FLOOR;

  const copies = new Map<string, number>();
  for (const d of deck) {
    const id = nodeId(d.parentName ?? d.card.name, d.isToken, d.face);
    copies.set(id, (copies.get(id) ?? 0) + 1);
  }

  const nodes: ProjectedNode[] = [];
  const seen = new Set<string>();
  for (const d of deck) {
    const id = nodeId(d.parentName ?? d.card.name, d.isToken, d.face);
    if (seen.has(id)) continue;
    seen.add(id);
    // Stale note, corrected 2026-08-27: this predates Task 7 (faces-as-nodes), when `deck` held one
    // entry per PHYSICAL card and `d.card.typeLine` was the combined "A // B" line -- `parseTypeLine`
    // takes one face and leaves "//" visible, painting a literal "//" swatch in the Type legend and
    // dropping the back face's type on any card whose front face has subtypes, which is why
    // `parseTypeLineAllFaces` was built to split it. Both callers now hand this function one FACE
    // per `d` (`faceDeckCards`), so `d.card.typeLine` is already that face's own line and this call
    // is a no-op split -- kept rather than swapped for the plain parser because it stays correct for
    // a caller that has not split, and a node is still one CARD's identity even though it is now
    // built one face at a time.
    const { types, subtypes, supertypes } = parseTypeLineAllFaces(d.card.typeLine);
    nodes.push({
      id,
      label: d.card.name,
      ...(d.isToken ? { isToken: true } : {}),
      copies: copies.get(id) ?? 1,
      types, subtypes, supertypes,
      typeLine: d.card.typeLine,
      oracleText: d.card.oracleText,
      colors: d.card.colors,
      cmc: d.card.manaValue,
      ...(d.face ? { face: d.face } : {}),
      ...(d.parentName ? { cardName: d.parentName } : {}),
    });
  }

  let undirectedReasons = 0;
  let offDeckReasons = 0;
  const grouped = new Map<string, { from: string; to: string; reasons: Reason[] }>();
  for (const r of reasons) {
    if (!r.producer || !r.consumer) { undirectedReasons++; continue; }
    // `producerIsToken`/`consumerIsToken` are what make a token and a same-named card two nodes
    // here instead of one -- see `nodeId`. A reason from the flat engine carries neither, which
    // reads as "both sides are cards", the only thing that engine can produce. `producerFace`/
    // `consumerFace` do the same for a face: `stampSides` already rewrote `producer`/`consumer` to
    // the PHYSICAL card's name, so the face index is what routes the reason to its own node.
    const from = nodeId(r.producer, r.producerIsToken, r.producerFace);
    const to = nodeId(r.consumer, r.consumerIsToken, r.consumerFace);
    if (!seen.has(from) || !seen.has(to)) { offDeckReasons++; continue; }
    const key = `${from}->${to}`;
    const g = grouped.get(key) ?? { from, to, reasons: [] };
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
