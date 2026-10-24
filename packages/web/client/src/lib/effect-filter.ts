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

/** THE MEMBERS NO ABILITY FACT DESCRIBES -- on the event by what they are (cast, entering, a printed
 *  keyword such as lifelink) rather than by an ability. A filter cannot judge them and leaves them
 *  out; the page says how many, so "no card matches" is never read as "none of them do". */
export function unjudgedMembers(m: EventMembers, side: "makes" | "pays"): number[] {
  const ids = side === "makes" ? m.p : m.c;
  const facts = side === "makes" ? m.pf : m.cf;
  if (!facts) return [];
  return ids.filter((_, i) => (facts[i]?.length ?? 0) === 0);
}
