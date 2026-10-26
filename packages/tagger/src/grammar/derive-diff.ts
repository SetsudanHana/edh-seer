/** G3 FOR #896 TASK 7 (moved from instruments: `derive-corpus` reads it for the per-card switch): does a card derive the same abilities from its grammar-only clause records as from
 *  the stored model answer? A difference is grouped by WHICH ability fields differ -- the H3 grouping
 *  of task 2 -- so a group is labelled once and its members spot-checked, not judged one by one. */
import type { Ability, CardTags } from "../schema.js";

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

/** THE SUBJECT FIELDS THE GRAMMAR DROPS (#1349 animate, generalised by #1352). `lostClaims` compares effect kinds and emit verbs only, so a labelled group could switch a card whose grammar
 *  effect lost a `type`, `subtype`, `stats` or `keyword` the stored effect's subject carries: Jade Statue's "becomes a 3/6 Golem artifact creature" (the grammar's animate had only the
 *  target's type), Goddric's "is a Dragon with base 4/4" (the stored keyword-grant has subtype dragon). Per clause and EFFECT KIND, not per position: each field value of a stored effect's
 *  subject must be carried by some grammar effect of that same kind in that same clause. A clause where the grammar has NO effect of that kind is not compared here (the grammar split
 *  it into other kinds: Simic Keyrune's animate, read as a pump and a keyword-grant, is `lostClaims`'s kind loss, not a lost field); comparing against an empty set flagged it twice.
 *  One-directional: a field only the grammar carries is a gain, never a loss. Returns "kind:field" for each loss, sorted. */
const SUBJECT_FIELDS = ["type", "subtype", "stats", "keyword"] as const;
export function lostSubjectFields(stored: readonly Ability[], grammar: readonly Ability[]): string[] {
  const values = (abs: readonly Ability[], clause: number | undefined, kind: string, f: (typeof SUBJECT_FIELDS)[number]): Set<string> => {
    const out = new Set<string>();
    for (const a of abs) {
      if (a.clause !== clause || a.effect?.kind !== kind) continue;
      const v = (a.effect.subject as unknown as Record<string, unknown> | undefined)?.[f];
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) out.add(JSON.stringify(canonical(x)));
    }
    return out;
  };
  const lost = new Set<string>();
  for (const a of stored) {
    const kind = a.effect?.kind;
    if (!kind || !grammar.some((g) => g.clause === a.clause && g.effect?.kind === kind)) continue;
    for (const f of SUBJECT_FIELDS) {
      const have = values(grammar, a.clause, kind, f);
      // CEILING: two stored animate types that are not part of the result are met by ANY type the grammar's animate carries. The umbrella "permanent" (Opal Guardian's "this permanent as a 3/4
      // Gargoyle creature": the store's own parse stopped at the noun) names no type of its own; and the card's own printed noun on a SELF animate (Halcyon Glaze's "this enchantment becomes
      // a 4/4 Illusion creature": stored {type: enchantment, self}) is what the card was, while the grammar's `this` carries what it becomes (a set card type replaces the old one). Only for an animate; elsewhere a bare "permanent" is a real, wider class.
      // ...and only a lone non-creature noun: a stored type that names "creature" is a result type and is never excused.
      const stored1 = [...values([a], a.clause, kind, f)];
      const selfNoun = kind === "animate" && f === "type" && (a.effect.subject as { self?: boolean } | undefined)?.self === true && stored1.length === 1 && stored1[0] !== '"creature"'
        && grammar.some((g) => g.clause === a.clause && g.effect?.kind === "animate" && (g.effect.subject as { self?: boolean } | undefined)?.self === true);
      const umbrella = kind === "animate" && f === "type" && have.size > 0;
      if (stored1.some((v) => !have.has(v) && !(umbrella && (v === '"permanent"' || selfNoun)))) lost.add(`${kind}:${f}`);
    }
  }
  return [...lost].sort();
}

/** THE SCALED AMOUNT THE GRAMMAR DROPS (#1352 review). A stored effect whose `amount` is defined by a count of the deck's own cards ("becomes an X/X Treefolk, where X is the number of Elves you
 *  control": Elvish Branchbender's `amount` and `count.scalesWith`) is a claim `lostClaims` and `lostSubjectFields` cannot see: the grammar's effect of the same kind is there, with the same subject, and
 *  no amount. True per clause and effect kind when the stored ability carries an `amount` with a `count.scalesWith` and no grammar effect of that kind in that clause carries the same
 *  `scalesWith`. Narrow and one-directional: a scaling only the grammar carries is a gain, and a clause where the grammar has no effect of that kind is `lostClaims`'s. */
export function lostScaledAmount(stored: readonly Ability[], grammar: readonly Ability[]): string[] {
  const lost = new Set<string>();
  for (const a of stored) {
    const kind = a.effect?.kind;
    const scales = a.count?.scalesWith;
    if (!kind || a.amount === undefined || scales === undefined) continue;
    const there = grammar.filter((g) => g.clause === a.clause && g.effect?.kind === kind);
    if (there.length > 0 && !there.some((g) => g.count?.scalesWith !== undefined && json(g.count.scalesWith) === json(scales))) lost.add(kind);
  }
  return [...lost].sort();
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

/** THE MANA FIELDS NO OTHER GATE COMPARES (#1349 review). `manaLines`, `staticFixer`, `landFetch`, `isOneShot` and `suspendOnly` are derived from the clause text AND the abilities,
 *  and `deriveDiff` reads abilities only, so a card could switch to the grammar with a different mana reading: Gauntlet of Power's land trigger lost "of the chosen color" and
 *  claimed an extra mana from every basic land; Caged Sun's chosen colour went unread. True when any of the five differs. ANY difference, not only a loss: wrong ramp
 *  changes land advice, and a gain here is as unjudged as a loss. */
export function manaDiffers(stored: Pick<CardTags, "manaLines" | "staticFixer" | "landFetch" | "isOneShot" | "suspendOnly">, grammar: Pick<CardTags, "manaLines" | "staticFixer" | "landFetch" | "isOneShot" | "suspendOnly">): boolean {
  return (["manaLines", "staticFixer", "landFetch", "isOneShot", "suspendOnly"] as const).some((k) => json(stored[k]) !== json(grammar[k]));
}
