// The ability-scope note (#1784). The engine's facts about a card belong to ONE ABILITY each (this ability triggers on X, THAT ability
// sacrifices Y), but a result here is judged by CARD: a card matches `ab.kind:static` and `ab.emits.verb:draw` when SOME ability is static
// and SOME ability draws, not necessarily the same one.
// CEILING: results are judged by card, not by ability, so the page says so under any result set with two ability terms. The upgrade is the ability-scope slice (#1786), which keeps a row per ability and judges every term of a group on the same one.
import type { FieldFilter } from "../facets.js";
import type { Query } from "./query.js";

/** The sentence under a result set that holds two or more ability terms. */
export const ACROSS_ABILITIES_NOTE = "Matched across the card's abilities: each condition holds for some ability on the card, not always the same one.";

/** How many ability terms a query needs to hold TOGETHER: an `and` adds, an `or` needs only its widest branch, a `not` is its inner term. */
export function abilityTermsOf(q: Query, isAbility: (field: string) => boolean): number {
  if ("and" in q) return q.and.reduce((n, k) => n + abilityTermsOf(k, isAbility), 0);
  if ("or" in q) return q.or.reduce((n, k) => Math.max(n, abilityTermsOf(k, isAbility)), 0);
  if ("not" in q) return abilityTermsOf(q.not, isAbility);
  return q.op !== "event" && isAbility(q.field) ? 1 : 0;
}

/** The builder's rows the same way: each must / not / range is a term, and all the any-of values of one field are ONE term (they are alternatives). */
export function abilityTermsOfFilters(filters: readonly FieldFilter[], isAbility: (field: string) => boolean): number {
  const anyFields = new Set<string>();
  let n = 0;
  for (const f of filters) {
    if (!isAbility(f.field)) continue;
    if (f.op === "any") anyFields.add(f.field);
    else n++;
  }
  return n + anyFields.size;
}

/** Two terms are where "across" starts to matter. */
export const needsAcrossNote = (terms: number): boolean => terms >= 2;
