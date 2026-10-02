/** G3 FOR #896 TASK 7: does a card derive the same abilities from its grammar-only clause records as from
 *  the stored model answer? A difference is grouped by WHICH ability fields differ -- the H3 grouping
 *  of task 2 -- so a group is labelled once and its members spot-checked, not judged one by one. */
import type { Ability } from "@edh-seer/tagger";

const json = (v: unknown): string => JSON.stringify(v ?? null);

/** The abilities of one clause, as comparable strings, in a stable order. */
function byClause(abilities: readonly Ability[]): Map<number, Ability[]> {
  const out = new Map<number, Ability[]>();
  for (const a of abilities) {
    const k = a.clause ?? -1;
    (out.get(k) ?? out.set(k, []).get(k)!).push(a);
  }
  for (const list of out.values()) list.sort((x, y) => (json(x) < json(y) ? -1 : json(x) > json(y) ? 1 : 0));
  return out;
}

/** The fields two abilities differ in, one level into `effect` and `trigger`. */
function fieldsOf(a: Ability, b: Ability): string[] {
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = (a as unknown as Record<string, unknown>)[k], y = (b as unknown as Record<string, unknown>)[k];
    if (json(x) === json(y)) continue;
    if ((k === "effect" || k === "trigger") && x && y && typeof x === "object" && typeof y === "object") {
      for (const kk of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (json((x as Record<string, unknown>)[kk]) !== json((y as Record<string, unknown>)[kk])) out.add(`${k}.${kk}`);
      }
    } else out.add(k);
  }
  return [...out];
}

/** Null when the two derive the same abilities (as a set); else the group key: the differing fields,
 *  or `abilities:<stored>-><grammar>` for a clause whose ability count differs. */
export function deriveDiff(stored: readonly Ability[], grammar: readonly Ability[]): string | null {
  const a = byClause(stored), b = byClause(grammar);
  const keys = new Set<string>();
  for (const clause of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(clause) ?? [], y = b.get(clause) ?? [];
    if (json(x) === json(y)) continue;
    if (x.length !== y.length) { keys.add(`abilities:${x.length}->${y.length}`); continue; }
    x.forEach((ab, i) => { for (const f of fieldsOf(ab, y[i]!)) keys.add(f); });
  }
  return keys.size ? [...keys].sort().join(",") : null;
}
