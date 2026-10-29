/** The pair-reason half of `derive-impact.ts`, shared by the main thread and its worker threads (`derive-impact-worker.ts`).
 *  Everything here takes the matcher module of ONE side as an argument: BASE's lives in the archived tree, HEAD's in the working tree. */
import type { ReasonLike } from "./derive-impact-core.js";

export interface MatcherModule {
  pairReasonsAcrossFaces: (a: any, b: any, h: any) => any[];
  pairReasons: (a: any, b: any, h: any) => any[];
  createsReasons: (p: any, c: any, h: any) => any[];
  collectTokenNodes: (deck: any[], tokenTags: (ref: any) => any) => { nodes: any[]; producerTokenOracles: Map<string, Set<string>>; tokenCreators: Map<string, Set<string>> };
  faceDeckCards: (dc: any) => any[];
  disambiguateFaceNames: (cards: any[]) => any[];
  /** token-tags.ts: the engine's own tags for a token with no derived row (a vanilla token). */
  synthesizeTokenTags: (doc: any) => any;
  loadHierarchy: () => any;
}

/** One side's world for pairing, built the way `analyzeDeckStructured` builds a deck's: its matcher; a DeckCard per derived non-token row, split into FACES
 *  (`faceDeckCards`, names disambiguated), which are what `collectTokenNodes` and `createsReasons` read; and the token nodes made from those faces.
 *  `tagsOf` is every derived row's tags of that side (tokens too). A token with no derived row gets `synthesizeTokenTags` of THAT side's matcher, as `loadTokenTags` does.
 *  `cardOf` is the `Card` of each non-token id; `tokenDocs` the whole `tokens` collection (printingIds resolve a created token to its oracle id).
 *
 *  CEILING: the deck-specific `ReasonOptions` (`landTypes`, `enterWatchers`, `revenantToughness`) are left unset: each is computed from ONE deck's cards, and a corpus-wide value
 *  would turn on `landPutFor`, `reuseEdges` and the revenant gate between every pair. Pair reasons here are the card-page / compass reading, so a change that only matters through
 *  those three options (and `disambiguateFaceNames`, applied corpus-wide instead of per deck) is not seen. */
export function pairContext(m: MatcherModule, tagsOf: Map<string, any>, cardOf: Map<string, any>, tokenDocs: readonly { _id: string; printingIds?: string[] }[]) {
  const tokenIds = new Set(tokenDocs.map((t) => t._id));
  const tokenTagsById = new Map<string, any>();
  for (const t of tokenDocs) tokenTagsById.set(t._id, tagsOf.get(t._id) ?? m.synthesizeTokenTags(t));
  const printingToToken = new Map<string, string>();
  for (const t of tokenDocs) for (const pid of t.printingIds ?? []) printingToToken.set(pid, t._id);
  const cards = new Map<string, any>();
  const split: [string, any][] = [];
  for (const id of [...tagsOf.keys()].sort()) {
    const card = cardOf.get(id);
    if (!card || tokenIds.has(id)) continue;
    const dc = { card, tags: tagsOf.get(id) };
    cards.set(id, dc);
    for (const f of m.faceDeckCards(dc)) split.push([id, f]);
  }
  const named = m.disambiguateFaceNames(split.map(([, f]) => f));
  const facesOf = new Map<string, any[]>();
  split.forEach(([id], i) => { const l = facesOf.get(id) ?? []; l.push(named[i]); facesOf.set(id, l); });
  const tokenTags = (ref: { printingId?: string }) => { const id = ref.printingId ? printingToToken.get(ref.printingId) : undefined; return id ? tokenTagsById.get(id) ?? null : null; };
  const { nodes, producerTokenOracles } = m.collectTokenNodes(named, tokenTags);
  return { m, hier: m.loadHierarchy(), cards, facesOf, nodes, nodeByOracle: new Map<string, any>(nodes.map((n) => [n.tags.oracleId as string, n])), producerTokenOracles };
}
export type PairContext = ReturnType<typeof pairContext>;

/** Does the subject exist in this world? A card needs a derived row and a document, a token a node some card makes. */
export const hasSubject = (ctx: PairContext, id: string, isToken: boolean): boolean => (isToken ? ctx.nodeByOracle.has(id) : ctx.cards.has(id));

/** Every reason between the subject and the rest, the way `analyzeDeckStructured` forms them: card-vs-card, then a FACE against a token node (`pairReasons`) and the maker face's
 *  `creates` reasons (`producerTokenOracles` is keyed by face name).
 *  CEILING: a token node against another token node is not paired (a changed token's own edges to other tokens are not seen). */
export function reasonsOf(ctx: PairContext, id: string, isToken: boolean): ReasonLike[] {
  const out: ReasonLike[] = [];
  const hier = ctx.hier;
  const withToken = (face: any, node: any): void => {
    out.push(...ctx.m.pairReasons(face, node, hier));
    if (ctx.producerTokenOracles.get(face.card.name)?.has(node.tags.oracleId)) out.push(...ctx.m.createsReasons(face, node, hier));
  };
  if (isToken) {
    const node = ctx.nodeByOracle.get(id);
    if (!node) return out;
    for (const faces of ctx.facesOf.values()) for (const f of faces) withToken(f, node);
    return out;
  }
  const subject = ctx.cards.get(id);
  if (!subject) return out;
  for (const [oid, o] of ctx.cards) if (oid !== id) out.push(...ctx.m.pairReasonsAcrossFaces(subject, o, hier));
  for (const node of ctx.nodes) for (const f of ctx.facesOf.get(id) ?? []) withToken(f, node);
  return out;
}
