import { isEmptyFilter, memberPasses, memberUndecided, type FactFilter } from "@edh-seer/matcher/member-facts";
import type { EventMembers } from "./partners.js";
import { answerTerms, type EventTerm } from "./event-terms.js";
import { factFilterOf, type EventQuery } from "./facets.js";

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

/** THE CARDS THE EFFECT FILTERS LEFT OUT WITHOUT JUDGING (review of #1339). Not "unjudged anywhere":
 *  a card counts only when the answer WITHOUT the filters would have kept it, the answer WITH them
 *  dropped it, and no term decided it was short -- one that is a member and either lacks the facts
 *  (`memberUndecided`) or whose ability failed outright is, respectively, counted and not. A term
 *  whose filter is empty (amount "variable" alone) narrows nothing, so it leaves nothing out. The
 *  caller applies the card predicates (colours, types, the name) to what this returns, the same ones
 *  the list applies, so the count says what the list left out. Empty when a shard cannot answer. */
export function unjudgedLeftOut(
  terms: readonly EventTerm[],
  lists: ReadonlyMap<string, EventMembers | null>,
  q: EventQuery,
): number[] {
  type Status = "pass" | "fail" | "undecided";
  const status = new Map<EventTerm, Map<number, Status>>();
  const full = (t: EventTerm): number[] => { const m = lists.get(t.key); return m ? (t.side === "makes" ? m.p : m.c) : []; };
  let narrows = false;
  const filtered = (t: EventTerm): number[] | null => {
    const m = lists.get(t.key);
    if (!m) return null;
    const filter = factFilterOf(q, t.side);
    if (t.op === "not" || isEmptyFilter(filter)) return full(t);
    const passing = membersPassing(m, t.side, filter);
    if (passing === null) return null;
    narrows = true;
    const ids = full(t);
    const facts = t.side === "makes" ? m.pf : m.cf;
    const passed = new Set(passing);
    const s = new Map<number, Status>();
    ids.forEach((id, i) => s.set(id, passed.has(id) ? "pass" : memberUndecided(facts?.[i], filter) ? "undecided" : "fail"));
    status.set(t, s);
    return passing;
  };
  const kept = new Map<EventTerm, number[]>();
  for (const t of terms) {
    const k = filtered(t);
    if (k === null) return [];
    kept.set(t, k);
  }
  if (!narrows) return [];
  const before = answerTerms(terms, full);
  const after = answerTerms(terms, (t) => kept.get(t)!);
  if (before.keep === null) return [];
  const andTerms = terms.filter((t) => t.op === "and" && status.has(t));
  const orTerms = terms.filter((t) => t.op === "or" && status.has(t));
  return [...before.keep].filter((id) => {
    if (before.drop.has(id) || after.keep?.has(id)) return false;
    if (andTerms.some((t) => status.get(t)!.get(id) === "fail")) return false;
    const orSeen = orTerms.map((t) => status.get(t)!.get(id)).filter((x): x is Status => x !== undefined);
    if (orSeen.length > 0 && orSeen.every((x) => x === "fail")) return false;
    return [...andTerms, ...orTerms].some((t) => status.get(t)!.get(id) === "undecided");
  });
}
