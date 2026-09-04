import type { ProjectedGraph } from "./graph-projection.js";

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
  /** `ProjectedEdge.drawn`: the board draws only these; every other reader takes them all. Absent
   *  on a graph written before the flag existed, and absent reads as drawn -- those graphs were
   *  already thinned to the drawn set. */
  drawn?: boolean;
}

export interface WireGraph {
  nodes: WireGraphNode[];
  edges: WireGraphEdge[];
  undirectedReasons: number;
  offDeckReasons: number;
}

/** The projection keys a node by the card NAME it belongs to -- `ProjectedNode.id` for a front face
 *  or a single-faced card, `face:<n>:<name>` for a BACK face, whose physical name is carried
 *  separately as `cardName` (Task 7, faces-as-nodes). So the roles join is on `cardName ?? id`, and
 *  `rolesByName` has to arrive keyed on the PHYSICAL card to match -- see `analyze.service.ts`,
 *  which is where that key is built. Stale note corrected 2026-08-27: this said node ids ARE card
 *  names and that `rolesByName` already arrives under the same key, and both halves went false with
 *  faces-as-nodes -- it is the sentence that made the join below look safe while every multi-face
 *  card's roles were being dropped. `docs` still earns its keep for two facts the projection
 *  doesn't carry: `typeLine` (for the lands room) and the art crop.
 *
 *  `normalize` is injected rather than imported so this stays a plain, deterministic function of
 *  its arguments, testable without touching `@edh-seer/data` -- it does `console.warn` on an unjoined
 *  roles count, so not literally pure. A miss there is a data gap (stale report, name drift), not
 *  a caller bug worth failing the whole request over.
 *
 *  `copies` needs no join at all: `projectDeckGraph` already counts it off the deck array, so it
 *  rides straight through on the node. */
export function attachRolesAndArt(
  graph: ProjectedGraph,
  docs: Array<{
    _id: string; name: string; typeLine?: string; artCrop?: string;
    imageUris?: { art_crop?: string };
    /** Per-face art, which is where a transform or modal_dfc card's images actually live -- and the
     *  rest of each face, so the panel can show the side the board is not drawing. */
    faces?: Array<{ name?: string; typeLine?: string; manaCost?: string; oracleText?: string; artCrop?: string }>;
  }>,
  rolesByName: Map<string, string[]>,
  normalize: (name: string) => string,
  /** Token node id (`token:<name>`) -> art crop, from the `tokens` collection. A token joins no
   *  corpus row, so `docs` can never carry its art; the caller resolves it by the token's ORACLE id
   *  and hands the result in keyed by node id. Defaults to empty so a caller with no token nodes
   *  (and every existing test) is unchanged. */
  tokenArtById: Map<string, string> = new Map(),
): WireGraph {
  const docByName = new Map(docs.map((d) => [normalize(d.name), d] as const));
  const nodeIds = new Set(graph.nodes.map((n) => normalize(n.id)));

  const rolesByNormalizedName = new Map<string, string[]>();
  let unjoined = 0;
  for (const [name, roles] of rolesByName) {
    const key = normalize(name);
    if (nodeIds.has(key)) rolesByNormalizedName.set(key, roles);
    else unjoined++;
  }
  if (unjoined > 0) {
    console.warn(`graph: ${unjoined} card(s) with report roles did not join to a graph node`);
  }

  const nodes = graph.nodes.map((n) => {
    // A FACE IS A NODE (Task 5). A BACK face's id carries the `face:<n>:` prefix so it never
    // collides with the physical card's node, which means it also never matches a doc by NAME --
    // `cardName` is the fallback for that case (it's set on the FRONT face too, but there it equals
    // `n.id` already, so the fallback is a no-op rather than a special case). A token has no
    // `cardName`, so it keeps its own id: `n.id`, never `n.label` -- a token's label is its bare
    // name ("Treasure") with the `token:` prefix stripped, and keying on it would rejoin a token to
    // a same-named real card's doc, the exact collision `TOKEN_ID_PREFIX` exists to prevent (see the
    // artCrop comment below).
    const key = normalize(n.cardName ?? n.id);
    const doc = docByName.get(key);
    // THE DOCUMENT IS THE PHYSICAL CARD; THE PICTURE, TYPE LINE AND TEXT ARE THE FACE'S. Without
    // this a back-face node draws with the front face's art and the flip is invisible -- two circles
    // for one card that look like duplicates. Undefined on every node that is not a face.
    const face = n.face !== undefined ? doc?.faces?.[n.face] : undefined;
    // Lands is a TYPE room, not a role room: a card is in it because it IS a land. The engine's
    // role field deliberately excludes basics (build.ts's !isBasicLand guard) because it answers
    // "does this pull double duty?", where "Island fills the lands role" is noise -- and that same
    // field drives doubleDutyRating's 1.15x synergy multiplier, so it must not be widened there.
    // The board asks a different question, and answers it here, where the full doc is in hand.
    //
    // THE FACE'S OWN TYPE LINE, NOT THE CARD'S. `doc` is the PHYSICAL card, so its line reads
    // "Instant // Land" for BOTH faces of a modal DFC -- which filed the Instant face in the lands
    // room while the node rendered its type line as "Instant", one node contradicting itself.
    // Review fix, 2026-08-27: `face` is already resolved three lines up for exactly this reason.
    // The card-level line stays the fallback for a node with no face row (a token, a single-faced
    // card, or a stale doc carrying no `faces`).
    const isLand = (face?.typeLine ?? n.typeLine ?? doc?.typeLine ?? "").toLowerCase().includes("land");
    const base = rolesByNormalizedName.get(key);
    const roles = isLand && !(base ?? []).includes("lands") ? [...(base ?? []), "lands"] : base;
    // A GENUINELY TWO-FACED CARD HAS NO CARD-LEVEL ART. Scryfall puts `image_uris` on each FACE for
    // transform and modal_dfc layouts and omits the top-level one: 861 corpus cards are double-faced
    // and only 370 (43%) carry a card-level artCrop, so Westvale Abbey, Fell the Profane and 489
    // others drew as a blank disc. The FRONT face is the fallback because it is the side the card is
    // played from and the side the board draws; adventure/split/flip are one physical face and keep
    // their card-level art, which still wins here.
    // A TOKEN'S ART COMES FROM THE `tokens` COLLECTION, NEVER FROM `docs`. Keyed on the node id, not
    // the label: 92 of the corpus's 661 token names are also a real card, and a name key would hand
    // the Treasure token the art of a card called Treasure -- the exact confusion `nodeId` exists to
    // prevent. A token with no row in the map keeps the blank dashed disc, which is honest.
    const artCrop = n.isToken
      ? tokenArtById.get(n.id)
      // The face's own picture wins first. Falls back to the card level, then the front-face
      // finder below, for a face whose doc row has no `faces` entry (a stale or unrefreshed doc) --
      // a fallback beats a blank disc.
      : face?.artCrop ?? doc?.artCrop ?? doc?.imageUris?.art_crop ?? doc?.faces?.find((f) => f.artCrop)?.artCrop;
    return {
      id: n.id,
      label: n.label,
      // A token node joins no card doc by design (its id is `token:<name>`, and there is no corpus
      // row for a token) -- so it carries no roles. Its ART comes from `tokenArtById` above.
      ...(n.isToken ? { isToken: true as const } : {}),
      // FACE AND CARDNAME RIDE THE WIRE TOO (Task 8): the board rims the two faces of one card as a
      // pair and the inspector opens on the face that was clicked, both of which need these on the
      // client, not just here where the doc join uses them.
      ...(n.face !== undefined ? { face: n.face } : {}),
      ...(n.cardName !== undefined ? { cardName: n.cardName } : {}),
      copies: n.copies,
      types: n.types,
      subtypes: n.subtypes,
      supertypes: n.supertypes,
      // THE PRINTED TYPE LINE, AND THE FIFTH FIELD THIS JOIN HAS BEEN CAUGHT DROPPING -- after
      // `producedMana`, `allParts`, `gameChanger` and `faces`. This function rebuilds every wire
      // node from an EXPLICIT field list, so a field added to `ProjectedNode` reaches the client
      // only if it is named here; the projection set it, every unit test passed on a fixture that
      // carried it, and a live run read `typeLine: undefined` on 103 of 103 nodes.
      // ADD A FIELD HERE WHEN YOU ADD ONE TO `ProjectedNode`.
      //
      // The projection's copy wins and the doc is the fallback: a TOKEN node joins no doc at all
      // (see the roles comment above), so reading `doc` alone would leave every token without one.
      ...(face?.typeLine ?? n.typeLine ?? doc?.typeLine
        ? { typeLine: face?.typeLine ?? n.typeLine ?? doc?.typeLine } : {}),
      ...(face?.oracleText ?? n.oracleText ? { oracleText: face?.oracleText ?? n.oracleText } : {}),
      // EVERY FACE, so the panel can show the back. Taken from the DOC rather than the projection:
      // faces are printing data the matcher has no use for, and threading them through
      // `ProjectedNode` would put them in the CLI's graph export too. Only when there is more than
      // one -- a single-face card has nothing to flip to, and an array of one is a control that
      // does nothing.
      ...((doc?.faces?.length ?? 0) > 1
        ? { faces: doc!.faces!.map((f) => ({
            name: f.name ?? "",
            ...(f.typeLine ? { typeLine: f.typeLine } : {}),
            ...(f.manaCost ? { manaCost: f.manaCost } : {}),
            ...(f.oracleText ? { oracleText: f.oracleText } : {}),
            ...(f.artCrop ? { artCrop: f.artCrop } : {}),
          })) }
        : {}),
      colors: n.colors,
      cmc: n.cmc,
      ...(roles && roles.length > 0 ? { roles } : {}),
      ...(artCrop !== undefined ? { artCrop } : {}),
    };
  });

  const edges = graph.edges.map((e) => ({
    from: e.from,
    to: e.to,
    weight: e.weight,
    tags: e.tags,
    // ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER. Archon of Cruelty's entry
    // trigger derives six reasons identical in tag and text, differing only in `effectKind`, and the
    // inspector printed the line six times -- seen live on the Treasure token panel (three identical
    // "Nadier's Nightblade triggers on a permanent leaving the battlefield" lines). Deduped HERE, on
    // the wire, and not in the reason set: `effectKind` is load-bearing for archetype detection, so
    // the objects must survive even when their sentences do not. Same collapse `claimCount` applies
    // to the score.
    reasonTexts: [...new Set(e.reasons.map((r) => r.text))],
    drawn: e.drawn,
  }));

  return { nodes, edges, undirectedReasons: graph.undirectedReasons, offDeckReasons: graph.offDeckReasons };
}
