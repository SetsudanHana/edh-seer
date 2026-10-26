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
  for (const a0 of abilities) {
    // `claimsNothing` (#1253, #1264) is a consequence of the `ref: "trigger"` reading it sits beside, not a
    // second difference: counted, it moved every group key that has a `ref` change in it (the
    // 'grammar right' label of "this creature becomes the target ... sacrifice it") to an unlabelled
    // one and silently un-switched 13 cards. The comparison reads the abilities without it.
    // `toZone` (#1301) is the same: the grammar reads it off the put that follows a search, the stored model answer often folds that put into the
    // search action and leaves the ability without it. Counted, 49 cards read from their printed text would have un-switched.
    const { claimsNothing: _claims, toZone: _to, ...a } = a0;
    const k = a.clause ?? -1;
    (out.get(k) ?? out.set(k, []).get(k)!).push(a);
  }
  // THE SORT IGNORES THE #1295 MARKERS: `edict` and `victimMay` are set the same way on both sides, but they are in the serialised
  // key, so an edict's emits sorted ahead of or behind the abilities beside it differently on the two sides and paired the wrong
  // abilities (Archon of Cruelty's `discard` against its `sacrifice`: a labelled "emits.subject(~control +scope)" group became an
  // unlabelled "emits", and the card un-switched from the grammar's reading to the model's, which says `discard: any`).
  const order = (a: Ability): string => json(a).replace(/"edict":true,?|"victimMay":true,?|"redirect":true,?/g, "");
  for (const list of out.values()) list.sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0));
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

/** THE ANIMATE TYPE THE GRAMMAR DROPS. The grammar's `animate` action carries only its target, while the stored model answer often writes the
 *  "becomes a 3/6 Golem artifact creature" phrase into the object, which derive reads `type`, `subtype` and `stats` from (Jade Statue, Haunted
 *  Screen, Sage of the Maze). A labelled count-changing group ("abilities:1->2") lets that loss through `lostClaims`, which compares kinds
 *  and verbs only. True when, in some clause, a stored `animate` effect's subject carries a type, subtype or stat that no `animate` effect of
 *  the grammar's reading of that clause carries. Narrow on purpose: the animate subject's three fields, nothing else (#1349). */
export function lostAnimateFields(stored: readonly Ability[], grammar: readonly Ability[]): boolean {
  const fields = ["type", "subtype", "stats"] as const;
  const values = (abs: readonly Ability[], clause: number | undefined, f: (typeof fields)[number]): Set<string> => {
    const out = new Set<string>();
    for (const a of abs) {
      if (a.clause !== clause || a.effect?.kind !== "animate") continue;
      const v = (a.effect.subject as unknown as Record<string, unknown> | undefined)?.[f];
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) out.add(JSON.stringify(canonical(x)));
    }
    return out;
  };
  return stored.some((a) => a.effect?.kind === "animate"
    && fields.some((f) => [...values([a], a.clause, f)].some((v) => !values(grammar, a.clause, f).has(v))));
}

/** THE TRIGGER FLAGS THE GRAMMAR DROPS (#1349 review). `lostClaims` compares effect kinds and emit verbs, so a labelled "grammar right" group can switch a card whose grammar
 *  trigger lost a flag the stored one carries: Kate Stewart's "one or more time counters" is `batched` in the stored derive, and the grammar's bare counter-added trigger is not,
 *  which `edge-magnitude` and `wincon` read as one firing per batch. True when, per trigger event (the verbs), the stored abilities carry more `batched` triggers, or more
 *  event-size bounds (`amount`), than the grammar's. One-directional and narrow on purpose: a flag only the grammar carries is never a loss. */
export function lostTriggerFlags(stored: readonly Ability[], grammar: readonly Ability[]): boolean {
  const count = (abs: readonly Ability[], flag: "batched" | "amount"): Map<string, number> => {
    const out = new Map<string, number>();
    for (const a of abs) {
      const t = a.trigger;
      if (!t || t[flag] === undefined) continue;
      const k = `${[...t.verbs].sort().join("+")}|${flag === "amount" ? json(t.amount) : ""}`;
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  };
  return (["batched", "amount"] as const).some((flag) => {
    const g = count(grammar, flag);
    return [...count(stored, flag)].some(([k, n]) => n > (g.get(k) ?? 0));
  });
}
