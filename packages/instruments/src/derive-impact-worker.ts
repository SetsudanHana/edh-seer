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
  tagsB: Map<string, any>; tagsH: Map<string, any>; cards: Map<string, any>; tokenIds: Set<string>; printingToToken: Map<string, string>;
}
export interface PairItem { id: string; name: string; isToken: boolean }
export interface PairResult { detail: CardPairs; present: boolean }

let ctxB: PairContext, ctxH: PairContext;
const matcherAt = async (root: string): Promise<MatcherModule> => import(pathToFileURL(join(root, "packages/matcher/src/index.ts")).href);

export async function setup(s: Setup): Promise<void> {
  const head = await matcherAt(s.repo);
  const base = s.ownMatcher ? await matcherAt(s.baseRoot) : head;
  ctxB = pairContext(base, s.tagsB, s.cards, s.tokenIds, s.printingToToken);
  ctxH = pairContext(head, s.tagsH, s.cards, s.tokenIds, s.printingToToken);
}
export function pairOne(item: PairItem): PairResult {
  return {
    present: hasSubject(ctxB, item.id, item.isToken) || hasSubject(ctxH, item.id, item.isToken),
    detail: { id: item.id, name: item.name, ...diffReasons(reasonsOf(ctxB, item.id, item.isToken), reasonsOf(ctxH, item.id, item.isToken)) },
  };
}
export const sizes = (): string => `BASE ${ctxB.cards.size} cards + ${ctxB.nodes.length} token nodes, HEAD ${ctxH.cards.size} cards + ${ctxH.nodes.length} token nodes`;

if (!isMainThread) serveWorker<PairItem, PairResult>(pairOne, (msg: Setup) => setup(msg));
