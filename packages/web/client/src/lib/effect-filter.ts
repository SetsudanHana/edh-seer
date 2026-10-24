import { isEmptyFilter, memberPasses, type FactFilter } from "@edh-seer/matcher/member-facts";
import type { EventMembers } from "./partners.js";

/** ONE SIDE OF ONE EVENT'S LIST, NARROWED BY HOW THE EVENT HAPPENS (owner, 2026-10-24). Positions
 *  stay in the list's own order, so the "how much it does" ranking still reads off them.
 *
 *  `null` WHEN THE SHARD CANNOT ANSWER: a build from before the facts shipped carries no `pf`/`cf`,
 *  and keeping every card would claim they all pass, dropping every card would claim none do. The
 *  page says it cannot answer instead -- the rule `StaticLookup.eventMembers` already keeps. */
export function membersPassing(m: EventMembers, side: "makes" | "pays", filter: FactFilter): number[] | null {
  const ids = side === "makes" ? m.p : m.c;
  if (isEmptyFilter(filter)) return ids;
  const facts = side === "makes" ? m.pf : m.cf;
  if (!facts) return null;
  return ids.filter((_, i) => memberPasses(facts[i], filter));
}
