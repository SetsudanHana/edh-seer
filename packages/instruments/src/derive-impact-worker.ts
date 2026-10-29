/** Worker thread of `derive-impact.ts`: pairs one subject against the whole corpus, both sides. A broadcast hands it the rows once; an item is a subject.
 *  Results come back in input order (`@edh-seer/data/parallel`), so the report is byte-identical to a one-worker run. */
import { isMainThread } from "node:worker_threads";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { serveWorker } from "@edh-seer/data/parallel";
import { diffReasons, type CardPairs } from "./derive-impact-core.js";
import { hasSubject, pairContext, reasonsOf, type MatcherModule, type PairContext } from "./derive-impact-pairs.js";

export interface Setup {
  baseRoot: string; repo: string; ownMatcher: boolean;
  tagsB: Map<string, any>; tagsH: Map<string, any>; /** raw card documents: each side builds its Cards with ITS OWN docs.ts */ docs: Map<string, any>; tokenDocs: { _id: string; printingIds?: string[] }[];
}
export interface PairItem { id: string; name: string; isToken: boolean; /** ask for the size of the worlds instead of pairing */ info?: true }
export interface PairResult { detail: CardPairs; present: boolean; info?: { nodesBase: number; nodesHead: number } }

let ctxB: PairContext, ctxH: PairContext;
/** The matcher's public index plus the two modules the pair loop needs that it does not re-export (`disambiguateFaceNames`, `synthesizeTokenTags`, `createsForYou`), all from `root`. */
const matcherAt = async (root: string): Promise<MatcherModule> => {
  const at = (rel: string): Promise<Record<string, unknown>> => import(pathToFileURL(join(root, rel)).href);
  const [index, analyze, tokenTags, edges] = await Promise.all([at("packages/matcher/src/index.ts"), at("packages/matcher/src/analyze.ts"), at("packages/matcher/src/token-tags.ts"), at("packages/matcher/src/edges.ts")]);
  return { ...index, disambiguateFaceNames: analyze.disambiguateFaceNames, synthesizeTokenTags: tokenTags.synthesizeTokenTags, createsForYou: edges.createsForYou } as unknown as MatcherModule;
};

export async function setup(s: Setup): Promise<void> {
  const head = await matcherAt(s.repo);
  const base = s.ownMatcher ? await matcherAt(s.baseRoot) : head;
  const docToCardAt = async (root: string): Promise<(d: unknown) => unknown> => (await import(pathToFileURL(join(root, "packages/data/src/docs.ts")).href)).docToCard;
  const cardsOf = (docToCard: (d: unknown) => unknown, tags: Map<string, unknown>): Map<string, unknown> => new Map([...tags.keys()].flatMap((id) => (s.docs.has(id) ? [[id, docToCard(s.docs.get(id))] as const] : [])));
  ctxB = pairContext(base, s.tagsB, cardsOf(await docToCardAt(s.ownMatcher ? s.baseRoot : s.repo), s.tagsB), s.tokenDocs);
  ctxH = pairContext(head, s.tagsH, cardsOf(await docToCardAt(s.repo), s.tagsH), s.tokenDocs);
}
export function pairOne(item: PairItem): PairResult {
  if (item.info) return { present: true, detail: { id: "", name: "", gained: [], lost: [], magnitude: [], attrs: [] }, info: { nodesBase: ctxB.nodes.length, nodesHead: ctxH.nodes.length } };
  return {
    present: hasSubject(ctxB, item.id, item.isToken) || hasSubject(ctxH, item.id, item.isToken),
    detail: { id: item.id, name: item.name, ...diffReasons(reasonsOf(ctxB, item.id, item.isToken), reasonsOf(ctxH, item.id, item.isToken)) },
  };
}

if (!isMainThread) serveWorker<PairItem, PairResult>(pairOne, (msg: Setup) => setup(msg));
