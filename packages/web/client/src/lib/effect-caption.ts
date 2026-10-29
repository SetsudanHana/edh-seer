import { factPasses, isEmptyFilter, isUnjudgedFact, memberUndecided, unpackFact, type FactFilter, type MemberFact } from "@edh-seer/matcher/member-facts";
import type { EventMembers } from "./partners.js";

/** WHY A TILE PASSED THE EFFECT ROWS, IN THE CARD'S OWN ABILITY (#1405 C). The short form of the
 *  how-often ladder; the kind words are the Ability type chips lower-cased. */
const KIND_WORD: Record<MemberFact["kind"], string> = {
  spell: "spell", triggered: "triggered", activated: "activated", static: "static", replacement: "replacement",
};
/** "AS OFTEN AS YOU LIKE" IS AN ACTIVATED ABILITY'S WORD: on a trigger `repeatable` means it fires
 *  every time the watched event happens (derive/repeats.ts rule 9), and the player does not choose. */
function repeatsWord(f: MemberFact): string | undefined {
  switch (f.repeats) {
    case undefined: return undefined;
    case "once": return "once";
    case "per-cycle": return "once a round";
    case "per-turn": return "every turn";
    case "continuous": return "always on";
    default: return f.kind === "activated" ? "as often as you like" : f.kind === "triggered" ? "every time it happens" : "every time";
  }
}

export const BY_WHAT_IT_IS = "by what it is, not an ability";
/** AN ABILITY WHOSE REPEATS DERIVE COULD NOT LABEL, against a minimum above "once" (`memberUndecided`). */
export const TIMING_UNKNOWN = "how often isn't known";

/** Which parts of a fact the reader filtered ON THIS SIDE: the kind whenever any row is set, the rest
 *  only if the side's own filter uses them (an asker's amount counts only with a change op). The
 *  discriminating parts come first, because a small tile clips the end. */
function factWords(f: MemberFact, filter: FactFilter): string {
  const parts: string[] = [];
  const asked = filter.amountMin !== undefined || filter.amountMax !== undefined || filter.includeVariable === true
    || filter.changeOp !== undefined;
  if (asked) {
    const a = f.amount;
    if (a.kind === "fixed") parts.push(`${a.value} each time`);
    else if (a.kind === "variable") parts.push("varies");
    // "Include variable amounts" also keeps an ability whose amount the card does not print as a number we read
    // (factPasses: anything not fixed passes with includeVariable), so the tile says so rather than nothing.
    else if (a.kind === "unstated" && filter.includeVariable === true) parts.push("amount not stated");
    else if (a.kind === "plus") parts.push(`adds ${a.value}`);
    else if (a.kind === "times") parts.push(a.value === 2 ? "doubles" : a.value === 3 ? "triples" : `×${a.value}`);
  }
  if (filter.minRepeats !== undefined) { const r = repeatsWord(f); if (r) parts.push(r); }
  parts.push(KIND_WORD[f.kind]);
  return parts.join(" · ");
}

/** THE FACTS OF THE ABILITY (at most two distinct) THAT PASSED THIS SIDE'S FILTER FOR ONE CARD, or
 *  the reason it is listed without one: a member on the key by what it is. Empty when nothing needs
 *  saying. `id` is the card's index position. */
export function effectCaption(
  m: EventMembers | null | undefined, side: "makes" | "pays", id: number, filter: FactFilter,
): string {
  if (!m || isEmptyFilter(filter)) return "";
  const ids = side === "makes" ? m.p : m.c;
  const facts = side === "makes" ? m.pf : m.cf;
  const own = facts?.[ids.indexOf(id)];
  if (!own) return "";
  if (own.length === 0) return BY_WHAT_IT_IS;
  const passing = own.filter((n) => !isUnjudgedFact(n)).map(unpackFact).filter((f) => factPasses(f, filter));
  if (passing.length === 0) {
    if (own.some(isUnjudgedFact)) return BY_WHAT_IT_IS;
    return memberUndecided(own, filter) ? TIMING_UNKNOWN : "";
  }
  return [...new Set(passing.map((f) => factWords(f, filter)))].slice(0, 2).join(" / ");
}
