import type { DeckReport } from "@edh-seer/engine";

/** A deck card. Facet values are FIELDS, never nodes -- see
 *  docs/superpowers/specs/2026-08-13-deck-graph-presentation-design.md §1. */
export interface WireGraphNode {
  /** Node identity: the card's name, or `token:<name>` for a token node. A name is not an identity
   *  -- 92 corpus token names are also a real card -- so the two must not share an id. */
  id: string;
  /** The plain name, token or not. What the board labels the node. */
  label: string;
  /** True on a token node: a permanent the deck MAKES rather than a card it holds. */
  isToken?: boolean;
  /** Which printed face this node is, 1 or more for a back face. Absent on a front face and on a
   *  single-face card -- see `ProjectedNode.face`. The board rims the two faces of one card as a
   *  pair and seeds the inspector's open face from whichever one was clicked. */
  face?: number;
  /** The PHYSICAL card this node is a face of, present on EVERY face of a multi-face card --
   *  `faceDeckCards` stamps it on the front too, so this is what pairs the two faces' rims. `face`
   *  is the field the front lacks: absent there, 1 or more on a back face. A name is not an
   *  identity for a face node -- its own `id`/`label` are the face's, `cardName` is the card's. */
  cardName?: string;
  /** How many copies the deck holds. Every copy collapses into one node, so a deck's 24 basic
   *  Mountains are one disc; this is where the count survives so the node can say so. */
  copies: number;
  types: string[];
  subtypes: string[];
  supertypes: string[];
  /** The card's PRINTED type line, faces and all. The three lists above are the UNION over faces
   *  (right for painting, wrong to recompose a type line from -- it names an object no face is),
   *  so a surface showing the card shows this instead. */
  typeLine?: string;
  /** The card's own oracle text, so the panel can show the evidence for a claim about it. */
  oracleText?: string;
  /** EVERY PRINTED FACE, so a surface showing the card can show the side you are not looking at.
   *  Absent on a single-face card. Owner, 2026-08-27: "for double faced cards we need a way to
   *  present them, cause right now you see only front". */
  faces?: { name: string; typeLine?: string; manaCost?: string; oracleText?: string; artCrop?: string }[];
  colors: string[];
  cmc: number;
  /** Functional BUILD roles the report gave this card. Absent when it had none -- not the same as
   *  an empty array. Kept as plain strings so this file need not depend on @edh-seer/matcher. */
  roles?: string[];
  artCrop?: string;
}

export interface WireGraphEdge {
  from: string;
  to: string;
  weight: number;
  tags: string[];
  /** Reason texts, for the inspector. The full `Reason` objects stay server-side. */
  reasonTexts: string[];
}

export interface WireGraph {
  nodes: WireGraphNode[];
  edges: WireGraphEdge[];
  undirectedReasons: number;
  offDeckReasons: number;
}

export interface AnalyzeResponse {
  report: DeckReport;
  missing: string[];
  resolvedCount: number;
  totalCount: number;
  commanderColorIdentity: string[];
  /** The deck as a card-level graph: one node per distinct card, one edge per producer/consumer
   *  pair carrying at least one synergy reason. Computed alongside the report rather than behind a
   *  second endpoint, because the expensive half -- resolving every card and its tags -- is
   *  already done here. */
  graph: WireGraph;
}
