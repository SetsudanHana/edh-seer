import type { AbilityRows } from "./ability-rows.js";
import type { Column, NumberColumn, SetColumn } from "./walk.js";

export type Node =
  | { and: Node[] }
  | { or: Node[] }
  | { not: Node }
  | { field: string; op: "has"; value: string }
  | { field: string; op: "count"; min?: number; max?: number }
  | { field: string; op: "countIn"; list: string; min?: number; max?: number }
  /** Inclusive bounds over a number column. A card with [min,max] matches when the two overlap the bounds. */
  | { field: string; op: "cmp"; min?: number; max?: number }
  /** Colour identity as a set column of W/U/B/R/G: `within` = subset (fits in), `exactly` = equal. */
  | { field: string; op: "within"; value: string[] }
  | { field: string; op: "exactly"; value: string[] }
  /** All inner terms hold on the SAME ability (#1786): judged over the ability rows, then mapped back to the cards that own one. The inner terms must be ability fields. */
  | { ability: Node }
  /** Rows a caller already computed elsewhere (event membership, the commander toggle), so they combine in this evaluator. */
  | { op: "rows"; rows: ReadonlySet<number> | readonly number[] };

export interface EvalContext {
  rowCount: number;
  columns: ReadonlyMap<string, Column>;
  namedLists: Readonly<Record<string, { values: readonly string[] }>>;
  /** The ability rows, once loaded; absent = a question with `ability( … )` cannot be answered. */
  abilities?: AbilityRows;
}

/** The build cannot answer: an unknown field or list, or a field of the wrong kind. Never read as empty or all. */
export type EvalResult = { ok: true; rows: number[] } | { ok: false; cannotAnswer: string[] };

class CannotAnswer extends Error {
  constructor(readonly reasons: string[]) {
    super(`cannot answer: ${reasons.join("; ")}`);
  }
}

function setColumn(ctx: EvalContext, id: string): SetColumn {
  const col = ctx.columns.get(id);
  if (!col) throw new CannotAnswer([`unknown field ${id}`]);
  if (col.kind !== "set") throw new CannotAnswer([`field ${id} is numeric, not a set`]);
  return col.fallback ? materialise(ctx, col) : col;
}

/** A sparse column's effective values: the fallback's rows minus the overrides, plus the column's own rows. */
function materialise(ctx: EvalContext, col: SetColumn): SetColumn {
  const base = setColumn(ctx, col.fallback!);
  const skip = new Set(col.overrides);
  const values = new Map<string, number[]>();
  for (const [v, rows] of base.values) values.set(v, rows.filter((r) => !skip.has(r)));
  for (const [v, rows] of col.values) values.set(v, [...(values.get(v) ?? []), ...rows].sort((a, b) => a - b));
  return { kind: "set", path: col.path, group: col.group, values };
}

function numberColumn(ctx: EvalContext, id: string): NumberColumn {
  const col = ctx.columns.get(id);
  if (!col) throw new CannotAnswer([`unknown field ${id}`]);
  if (col.kind !== "number") throw new CannotAnswer([`field ${id} is a set, not numeric`]);
  return col;
}

function listValues(ctx: EvalContext, name: string): Set<string> {
  const list = ctx.namedLists[name];
  if (!list) throw new CannotAnswer([`unknown list ${name}`]);
  return new Set(list.values);
}

function countsOver(col: SetColumn, only: Set<string> | undefined, n: number): Uint32Array {
  const counts = new Uint32Array(n);
  for (const [v, rows] of col.values) {
    if (only && !only.has(v)) continue;
    for (const r of rows) counts[r]!++;
  }
  return counts;
}

/** How many values of a set field each row holds (optionally only those in a named list), for ordering by a count.
 *  null when the field or list is unknown: the same cannot-answer `evaluate` reports, never zeros. */
export function rowCounts(ctx: EvalContext, field: string, list?: string): Uint32Array | null {
  try {
    return countsOver(setColumn(ctx, field), list === undefined ? undefined : listValues(ctx, list), ctx.rowCount);
  } catch (e) {
    if (e instanceof CannotAnswer) return null;
    throw e;
  }
}

function unjudgedIn(node: Node, ctx: EvalContext, out: Set<number> = new Set()): Set<number> {
  if ("and" in node) node.and.forEach((c) => unjudgedIn(c, ctx, out));
  else if ("or" in node) node.or.forEach((c) => unjudgedIn(c, ctx, out));
  else if ("not" in node) unjudgedIn(node.not, ctx, out);
  else if ("ability" in node) { for (const r of ctx.abilities?.unjudged ?? []) out.add(r); }
  else if ("field" in node) {
    const col = ctx.columns.get(node.field);
    if (col?.kind === "set") for (const r of col.unjudged ?? []) out.add(r);
  }
  return out;
}

/** `ability( … )`: the inner tree over the ability rows, then the cards owning a matching ability. A term that is no ability field, a nested `ability(` or rows a caller supplied is a visible error, never a quiet empty answer. */
function runAbility(inner: Node, ctx: EvalContext, out: Uint8Array): Uint8Array {
  const ab = ctx.abilities;
  if (!ab) throw new CannotAnswer(["the ability rows are not loaded"]);
  const bad: string[] = [];
  const check = (n: Node): void => {
    if ("and" in n) n.and.forEach(check);
    else if ("or" in n) n.or.forEach(check);
    else if ("not" in n) check(n.not);
    else if ("ability" in n) bad.push("ability( ) inside ability( )");
    else if ("field" in n) { if (!ab.columns.has(n.field)) bad.push(`${n.field} is not an ability field`); }
    else bad.push("rows that are not an ability's");
  };
  check(inner);
  if (bad.length > 0) throw new CannotAnswer([...new Set(bad)].map((b) => `${b}, so it cannot be inside ability( )`));
  const mask = run(inner, { rowCount: ab.count, columns: ab.columns, namedLists: ctx.namedLists });
  for (let i = 0; i < ab.count; i++) if (mask[i]) out[ab.owner[i]!] = 1;
  return out;
}

function run(node: Node, ctx: EvalContext): Uint8Array {
  const n = ctx.rowCount;
  const out = new Uint8Array(n);
  if ("ability" in node) return runAbility(node.ability, ctx, out);
  if ("and" in node) {
    out.fill(1);
    for (const c of node.and) {
      const m = run(c, ctx);
      for (let i = 0; i < n; i++) out[i] = out[i]! & m[i]!;
    }
    return out;
  }
  if ("or" in node) {
    for (const c of node.or) {
      const m = run(c, ctx);
      for (let i = 0; i < n; i++) out[i] = out[i]! | m[i]!;
    }
    return out;
  }
  if ("not" in node) {
    const m = run(node.not, ctx);
    for (let i = 0; i < n; i++) out[i] = m[i] ? 0 : 1;
    // A COLUMN THAT CANNOT SPEAK FOR A ROW does not say "no" for it: the complement leaves those rows out.
    for (const r of unjudgedIn(node.not, ctx)) if (r >= 0 && r < n) out[r] = 0;
    return out;
  }
  if (node.op === "rows") {
    for (const r of node.rows) if (r >= 0 && r < n) out[r] = 1;
    return out;
  }
  if (node.op === "cmp") {
    const col = numberColumn(ctx, node.field);
    const lo = node.min ?? -Infinity;
    const hi = node.max ?? Infinity;
    // CEILING: a card holding several values on one numeric path matches when its [min,max] range overlaps the
    // bounds, not when every value does. Exact for the single-valued core views (mv/pow/tou); the build prints
    // any walked numeric path where a card holds more than one value, so this announces itself when it matters.
    col.rows.forEach((r, i) => {
      if (col.max[i]! >= lo && col.min[i]! <= hi) out[r] = 1;
    });
    return out;
  }
  const col = setColumn(ctx, node.field);
  if (node.op === "within" || node.op === "exactly") {
    const want = new Set(node.value);
    out.fill(1);
    for (const [v, rows] of col.values) {
      if (!want.has(v)) for (const r of rows) out[r] = 0;
    }
    if (node.op === "exactly") {
      for (const v of want) {
        const have = new Set(col.values.get(v));
        for (let i = 0; i < n; i++) if (!have.has(i)) out[i] = 0;
      }
    }
    return out;
  }
  if (node.op === "has") {
    for (const r of col.values.get(node.value) ?? []) out[r] = 1;
    return out;
  }
  const counts = countsOver(col, node.op === "countIn" ? listValues(ctx, node.list) : undefined, n);
  const lo = node.min ?? 0;
  const hi = node.max ?? Infinity;
  for (let i = 0; i < n; i++) out[i] = counts[i]! >= lo && counts[i]! <= hi ? 1 : 0;
  return out;
}

export function evaluate(node: Node, ctx: EvalContext): EvalResult {
  try {
    const mask = run(node, ctx);
    const rows: number[] = [];
    for (let i = 0; i < mask.length; i++) if (mask[i]) rows.push(i);
    return { ok: true, rows };
  } catch (e) {
    if (e instanceof CannotAnswer) return { ok: false, cannotAnswer: e.reasons };
    throw e;
  }
}
