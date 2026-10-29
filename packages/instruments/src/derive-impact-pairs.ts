/** The pair-reason half of `derive-impact.ts`, shared by the main thread and its worker threads (`derive-impact-worker.ts`).
 *  Everything here takes the matcher module of ONE side as an argument: BASE's lives in the archived tree, HEAD's in the working tree. */
import type { ReasonLike } from "./derive-impact-core.js";

export interface MatcherModule {
  pairReasonsAcrossFaces: (a: any, b: any, h: any) => any[];
  createsReasons: (p: any, c: any, h: any) => any[];
  collectTokenNodes: (deck: any[], tokenTags: (ref: any) => any) => { nodes: any[]; producerTokenOracles: Map<string, Set<string>>; tokenCreators: Map<string, Set<string>> };
  loadHierarchy: () => any;
}

/** One side's world for pairing: its matcher, its cards (a DeckCard per derived non-token row), and the token nodes `collectTokenNodes` builds from those cards.
 *  `tagsOf` is every derived row's tags of that side (tokens too); `cardOf` the card document's `Card` for each non-token id. */
export function pairContext(m: MatcherModule, tagsOf: Map<string, any>, cardOf: Map<string, any>, tokenIds: Set<string>, printingToToken: Map<string, string>) {
  const cards = new Map<string, any>();
  for (const id of [...tagsOf.keys()].sort()) {
    const card = cardOf.get(id);
    if (card && !tokenIds.has(id)) cards.set(id, { card, tags: tagsOf.get(id) });
  }
  const tokenTags = (ref: { printingId?: string }) => { const id = ref.printingId ? printingToToken.get(ref.printingId) : undefined; return id ? tagsOf.get(id) ?? null : null; };
  const { nodes, producerTokenOracles } = m.collectTokenNodes([...cards.values()], tokenTags);
  return { m, hier: m.loadHierarchy(), cards, nodes, nodeByOracle: new Map<string, any>(nodes.map((n) => [n.tags.oracleId as string, n])), producerTokenOracles };
}
export type PairContext = ReturnType<typeof pairContext>;

/** Does the subject exist in this world? A card needs a derived row and a document, a token a node some card makes. */
export const hasSubject = (ctx: PairContext, id: string, isToken: boolean): boolean => (isToken ? ctx.nodeByOracle.has(id) : ctx.cards.has(id));

/** Every reason between the subject and the rest, the way `analyzeDeckStructured` forms them: card-vs-card, card-vs-token node, and the maker's `creates` reasons.
 *  CEILING: a token node against another token node is not paired (a changed token's own edges to other tokens are not seen). */
export function reasonsOf(ctx: PairContext, id: string, isToken: boolean): ReasonLike[] {
  const out: ReasonLike[] = [];
  const subject = isToken ? ctx.nodeByOracle.get(id) : ctx.cards.get(id);
  if (!subject) return out;
  const hier = ctx.hier;
  if (isToken) {
    for (const o of ctx.cards.values()) {
      out.push(...ctx.m.pairReasonsAcrossFaces(o, subject, hier));
      if (ctx.producerTokenOracles.get(o.card.name)?.has(id)) out.push(...ctx.m.createsReasons(o, subject, hier));
    }
    return out;
  }
  for (const [oid, o] of ctx.cards) if (oid !== id) out.push(...ctx.m.pairReasonsAcrossFaces(subject, o, hier));
  for (const node of ctx.nodes) {
    out.push(...ctx.m.pairReasonsAcrossFaces(subject, node, hier));
    if (ctx.producerTokenOracles.get(subject.card.name)?.has(node.tags.oracleId)) out.push(...ctx.m.createsReasons(subject, node, hier));
  }
  return out;
}
