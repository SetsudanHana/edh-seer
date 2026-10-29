import { factPasses, isEmptyFilter, isUnjudgedFact, unpackFact, type FactFilter, type MemberFact } from "@edh-seer/matcher/member-facts";
import type { Repeats } from "@edh-seer/tagger";
import type { EventMembers } from "./partners.js";
import type { EventQuery } from "./facets.js";

/** WHY A TILE PASSED THE EFFECT ROWS, IN THE CARD'S OWN ABILITY (#1405 C). The short form of the
 *  how-often ladder; the kind words are the Ability type chips lower-cased. */
const KIND_WORD: Record<MemberFact["kind"], string> = {
  spell: "spell", triggered: "triggered", activated: "activated", static: "static", replacement: "replacement",
};
const REPEATS_WORD: Record<string, string> = {
  once: "once", "per-cycle": "once a round", "per-turn": "every turn", repeatable: "as often as you like", continuous: "always on",
};

export const BY_WHAT_IT_IS = "by what it is, not an ability";

/** Which parts of a fact the reader filtered on: the kind whenever any row is set, the rest only
 *  if their own row is. */
function factWords(f: MemberFact, q: EventQuery): string {
  const parts: string[] = [KIND_WORD[f.kind]];
  if (q.repeatsMin !== undefined && f.repeats !== undefined) parts.push(REPEATS_WORD[f.repeats as Repeats] ?? f.repeats);
  const asked = q.amountMin !== undefined || q.amountMax !== undefined || q.amountVariable === true || q.amountChange !== undefined;
  if (asked) {
    const a = f.amount;
    if (a.kind === "fixed") parts.push(`${a.value} each time`);
    else if (a.kind === "variable") parts.push("X each time");
    else if (a.kind === "plus") parts.push(`+${a.value}`);
    else if (a.kind === "times") parts.push(`×${a.value}`);
  }
  return parts.join(" · ");
}

/** THE FACTS OF THE ABILITY (at most two distinct) THAT PASSED THIS SIDE'S FILTER FOR ONE CARD, or
 *  the reason it is listed without one: a member on the key by what it is. Empty when nothing needs
 *  saying. `id` is the card's index position. */
export function effectCaption(
  m: EventMembers | null | undefined, side: "makes" | "pays", id: number, filter: FactFilter, q: EventQuery,
): string {
  if (!m || isEmptyFilter(filter)) return "";
  const ids = side === "makes" ? m.p : m.c;
  const facts = side === "makes" ? m.pf : m.cf;
  const own = facts?.[ids.indexOf(id)];
  if (!own) return "";
  if (own.length === 0) return BY_WHAT_IT_IS;
  const passing = own.filter((n) => !isUnjudgedFact(n)).map(unpackFact).filter((f) => factPasses(f, filter));
  if (passing.length === 0) return own.some(isUnjudgedFact) ? BY_WHAT_IT_IS : "";
  return [...new Set(passing.map((f) => factWords(f, q)))].slice(0, 2).join(" / ");
}
