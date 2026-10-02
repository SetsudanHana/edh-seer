/** G3 FOR #896 TASK 7 (moved from instruments: `derive-corpus` reads it for the per-card switch): does a card derive the same abilities from its grammar-only clause records as from
 *  the stored model answer? A difference is grouped by WHICH ability fields differ -- the H3 grouping
 *  of task 2 -- so a group is labelled once and its members spot-checked, not judged one by one. */
import type { Ability } from "../schema.js";

/** Key order is not a difference: two derives that build the same subject in a different order agree. */
// ...nor an amount's comma before its "where X is" ("+X/+X, where X is ..." reads as "+X/+X where X is ...").
const canonical = (v: unknown): unknown => typeof v === "string" ? v.replace(/, where x is /i, " where X is ") : Array.isArray(v) ? v.map(canonical)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])])) : v;
const json = (v: unknown): string => JSON.stringify(canonical(v ?? null));

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

/** How a SUBJECT moved, which is what a label needs: "+type" the grammar added a field (usually a
 *  narrower, truer reading), "-self" it lost one, "~control" it changed one. */
function subjectMove(x: unknown, y: unknown): string {
  const a = (x ?? {}) as Record<string, unknown>, b = (y ?? {}) as Record<string, unknown>;
  const out: string[] = [];
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
    if (json(a[k]) === json(b[k])) continue;
    out.push(`${!(k in a) ? "+" : !(k in b) ? "-" : "~"}${k}`);
  }
  return out.join(" ");
}

/** The fields two abilities differ in, one level into `effect` and `trigger`; a subject (the effect's,
 *  the trigger's, an emit's) says how it moved. */
function fieldsOf(a: Ability, b: Ability): string[] {
  const out = new Set<string>();
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = (a as unknown as Record<string, unknown>)[k], y = (b as unknown as Record<string, unknown>)[k];
    if (json(x) === json(y)) continue;
    if ((k === "effect" || k === "trigger") && x && y && typeof x === "object" && typeof y === "object") {
      for (const kk of new Set([...Object.keys(x), ...Object.keys(y)])) {
        const xx = (x as Record<string, unknown>)[kk], yy = (y as Record<string, unknown>)[kk];
        if (json(xx) === json(yy)) continue;
        out.add(kk === "subject" ? `${k}.subject(${subjectMove(xx, yy)})` : `${k}.${kk}`);
      }
    } else if (k === "emits" && Array.isArray(x) && Array.isArray(y) && x.length === y.length) {
      x.forEach((e, i) => {
        const f = y[i] as { verb?: string; subject?: unknown };
        const ee = e as { verb?: string; subject?: unknown };
        if (json(e) === json(f)) return;
        out.add(ee.verb !== f.verb ? "emits.verb" : `emits.subject(${subjectMove(ee.subject, f.subject)})`);
      });
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

/** What the stored derive CLAIMS -- each effect kind and each emitted event verb -- that the grammar-only
 *  derive does not. A labelled group is labelled on three cards; this guards the rest of it: a card the
 *  grammar would make claim LESS than its stored answer keeps the stored answer (G4: Perpetual
 *  Timepiece's recursion, Szarekh's milled-card return and Glint Raker's dig were lost inside groups
 *  labelled "grammar right" on other cards). */
export function lostClaims(stored: readonly Ability[], grammar: readonly Ability[]): string[] {
  const claims = (abs: readonly Ability[]) => new Set(abs.flatMap((a) => [
    ...(a.effect?.kind ? [`kind:${a.effect.kind}`] : []),
    ...(a.emits ?? []).map((e) => `emit:${e.verb}`),
  ]));
  const g = claims(grammar);
  return [...claims(stored)].filter((c) => !g.has(c)).sort();
}
