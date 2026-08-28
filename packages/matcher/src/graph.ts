import type { CardDoc, CardFace } from "@edh-seer/data";
import { parseTypeLine } from "./typeline.js";

export type NodeKind =
  | "card" | "face" | "color" | "supertype" | "type" | "subtype"
  | "keyword" | "mana" | "layout" | "token" | "related" | "power" | "toughness" | "cmc"
  /** Stage 2: a reified event key (`enters:creature`, `dies:creature`, `static:pump`). Cards attach
   *  to it by role, so card-to-card synergy is a two-hop walk rather than a stored n*m mesh. */
  | "event";

export type EdgeKind =
  | "FACE" | "TYPE" | "SUPERTYPE" | "SUBTYPE" | "COLOR" | "IDENTITY" | "KEYWORD"
  | "MANA_SYMBOL" | "PRODUCES" | "LAYOUT" | "POWER" | "TOUGHNESS" | "CMC"
  | "CREATES" | "COMBO_PIECE" | "MELD_PART" | "MELD_RESULT"
  /** Stage 2 roles on an `event` node: the producer supplies it, the consumer triggers on it. */
  | "EMITS" | "TRIGGERS";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  props?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Face ordinal on FACE edges; absent elsewhere. */
  index?: number;
}

export interface CardGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** `all_parts` component -> the edge it becomes and the node kind of its target. Only `token`
 *  entries are real game tokens; combo_piece/meld_part/meld_result point at other real cards,
 *  which stage 2 resolves by name (the printing-level id Scryfall gives is not joinable here). */
const PART_EDGE: Record<string, { edge: EdgeKind; kind: NodeKind }> = {
  token: { edge: "CREATES", kind: "token" },
  combo_piece: { edge: "COMBO_PIECE", kind: "related" },
  meld_part: { edge: "MELD_PART", kind: "related" },
  meld_result: { edge: "MELD_RESULT", kind: "related" },
};

/** `[^a-z0-9]+` has already COLLAPSED every run to a single "-", so at most one hyphen can sit at
 *  each end: `-+$` was scanning for a run that cannot exist, and paying quadratically to do it. */
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Printed power/toughness that is a plain integer. `*`, `X` and `1+*` have no fixed value and
 *  get no node at all -- `parseStat` flattens them to 0 elsewhere, which is a wrong answer we do
 *  not want to bake into the graph. */
function numericStat(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return /^-?\d+$/.test(v) ? Number(v) : null;
}

/** Mana symbols in a cost string: "{2}{R}{R}" -> ["2","R"] (deduped, order preserved). */
function manaSymbols(cost: string | undefined): string[] {
  if (!cost) return [];
  return [...new Set([...cost.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]))];
}

/** Project cards and their printed characteristics into nodes and edges.
 *
 *  Characteristics that cards can SHARE become shared nodes, so two Goblins reach the same
 *  `subtype:goblin`; facts nothing shares (legalities, layout metadata, release date) stay
 *  properties on the card node.
 *
 *  Every card gets at least one face node, including single-faced cards. The alternative -- face
 *  nodes only for multi-faced cards -- puts a "does this card have faces" branch in every
 *  traversal that touches a type or a colour, to save ~35k nodes that cost nothing.
 *
 *  Stage 1 only: no otags, no abilities, no effects, no stat-shifting, and no card-to-card edges
 *  beyond `all_parts`. See docs/superpowers/specs/2026-08-03-card-graph-design.md. */
export function buildGraph(cards: Iterable<CardDoc>): CardGraph {
  const nodes = new Map<string, GraphNode>();
  // Keyed, not a list: a shared target can be reached from several cards and re-emit the same edge.
  // Seven Wizard-token makers each re-emitted `token:wizard -SUBTYPE-> subtype:wizard`, which double
  // counts degree in any viewer and inflates every edge total computed off this graph.
  const edges = new Map<string, GraphEdge>();

  const node = (id: string, kind: NodeKind, label: string, props?: Record<string, unknown>): string => {
    if (!nodes.has(id)) nodes.set(id, props ? { id, kind, label, props } : { id, kind, label });
    return id;
  };
  const edge = (from: string, to: string, kind: EdgeKind, index?: number): void => {
    const k = `${from}|${to}|${kind}`;
    if (!edges.has(k)) edges.set(k, index === undefined ? { from, to, kind } : { from, to, kind, index });
  };

  for (const c of cards) {
    const cardId = node("card:" + c._id, "card", c.name, {
      cmc: c.manaValue,
      ...(c.layout !== undefined ? { layout: c.layout } : {}),
      ...(c.legalities !== undefined ? { legalities: c.legalities } : {}),
      ...(c.releasedAt !== undefined ? { releasedAt: c.releasedAt } : {}),
      ...(c.gameChanger !== undefined ? { gameChanger: c.gameChanger } : {}),
      ...(c.reserved !== undefined ? { reserved: c.reserved } : {}),
      ...(c.edhrecRank !== undefined ? { edhrecRank: c.edhrecRank } : {}),
      // Scryfall never puts image_uris at the top level for a transform/modal_dfc card -- only
      // per-face. Falling back to the front face's artCrop is still printed card data (stage-1
      // legal); without it every DFC (a Commander staple appearing several times in a typical
      // deck) silently renders as a dot instead of its art.
      ...((c.artCrop ?? c.faces?.[0]?.artCrop) !== undefined
        ? { artCrop: (c.artCrop ?? c.faces![0].artCrop)! }
        : {}),
    });

    // --- card-level edges ---
    for (const ci of c.colorIdentity) edge(cardId, node("color:" + ci, "color", ci), "IDENTITY");
    edge(cardId, node("cmc:" + c.manaValue, "cmc", String(c.manaValue)), "CMC");
    // Card-level manaCost fallback: only meaningful for cards whose faces carry no cost of their
    // own (or that have no faces at all). Faces with a cost emit MANA_SYMBOL from the face loop
    // below instead -- see the spec's face-level mana cost.
    const anyFaceHasCost = (c.faces ?? []).some((f) => f.manaCost);
    if (!anyFaceHasCost) {
      for (const sym of manaSymbols(c.manaCost)) edge(cardId, node("mana:" + sym, "mana", sym), "MANA_SYMBOL");
    }
    if (c.layout) edge(cardId, node("layout:" + c.layout, "layout", c.layout), "LAYOUT");
    for (const m of c.producedMana ?? []) edge(cardId, node("mana:" + m, "mana", m), "PRODUCES");
    for (const kw of c.keywords) edge(cardId, node("keyword:" + slug(kw), "keyword", kw), "KEYWORD");

    for (const p of c.allParts ?? []) {
      const mapping = PART_EDGE[p.component];
      if (!mapping) continue;
      const partId = node(mapping.kind + ":" + slug(p.name), mapping.kind, p.name, { typeLine: p.typeLine });
      edge(cardId, partId, mapping.edge);
      // A part carries its own printed types, so it feeds the same typal nodes real cards do.
      const pt = parseTypeLine(p.typeLine);
      for (const st of pt.subtypes) edge(partId, node("subtype:" + st, "subtype", st), "SUBTYPE");
      for (const t of pt.types) edge(partId, node("type:" + t, "type", t), "TYPE");
    }

    // --- face-level edges ---
    // A single-faced card is one face built from the card's own printed fields. When `faces` is
    // absent we don't know whether the card is single-faced; `typeLine` may be a COMBINED line
    // ("A — B // C — D") for a multi-faced card that was never refreshed. Splitting on " // "
    // first (a no-op for a genuinely single-faced line) keeps a combined line from ever reaching
    // `parseTypeLine` whole, which would otherwise parse it as one face with "//" and "—" tokens
    // baked into its subtypes.
    const faces: CardFace[] = c.faces?.length
      ? c.faces
      : c.typeLine.split(" // ").map((typeLine, i) => ({
          name: c.name.split(" // ")[i] ?? c.name,
          typeLine,
          oracleText: c.oracleText,
          colors: c.colors,
          power: c.power ?? undefined,
          toughness: c.toughness ?? undefined,
        }));

    faces.forEach((f, i) => {
      // The face's own art, not the card's. Without it a modal DFC's back face exists as a node with no
      // picture, and the board can render a flip that shows the front face twice. `data.module.ts`
      // forwards `props.artCrop` for a node of any kind, so this is the whole cost of putting the back
      // face on the wire.
      const faceId = node(`face:${c._id}:${i}`, "face", f.name || c.name, {
        oracleText: f.oracleText,
        ...(f.artCrop !== undefined ? { artCrop: f.artCrop } : {}),
      });
      edge(cardId, faceId, "FACE", i);

      const pt = parseTypeLine(f.typeLine);
      for (const s of pt.supertypes) edge(faceId, node("supertype:" + s, "supertype", s), "SUPERTYPE");
      for (const t of pt.types) edge(faceId, node("type:" + t, "type", t), "TYPE");
      for (const st of pt.subtypes) edge(faceId, node("subtype:" + st, "subtype", st), "SUBTYPE");
      // A face with no mana cost carries its colour in `colorIndicator` instead of `colors` -- the
      // printed indicator dot. Falling back only when `colors` is empty keeps the normal path
      // untouched; without it such a face silently gets no COLOR edges at all.
      const faceColors = f.colors.length > 0 ? f.colors : f.colorIndicator ?? [];
      for (const col of faceColors) edge(faceId, node("color:" + col, "color", col), "COLOR");
      for (const sym of manaSymbols(f.manaCost)) edge(faceId, node("mana:" + sym, "mana", sym), "MANA_SYMBOL");

      const p = numericStat(f.power);
      if (p !== null) edge(faceId, node("power:" + p, "power", String(p)), "POWER");
      const t = numericStat(f.toughness);
      if (t !== null) edge(faceId, node("toughness:" + t, "toughness", String(t)), "TOUGHNESS");
    });
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
