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
  | { field: string; op: "exactly"; value: string[] };

export interface EvalContext {
  rowCount: number;
  columns: ReadonlyMap<string, Column>;
  namedLists: Readonly<Record<string, { values: readonly string[] }>>;
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
  return col;
}

function numberColumn(ctx: EvalContext, id: string): NumberColumn {
  const col = ctx.columns.get(id);
  if (!col) throw new CannotAnswer([`unknown field ${id}`]);
  if (col.kind !== "number") throw new CannotAnswer([`field ${id} is a set, not numeric`]);
  return col;
}

function run(node: Node, ctx: EvalContext): Uint8Array {
  const n = ctx.rowCount;
  const out = new Uint8Array(n);
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
    return out;
  }
  if (node.op === "cmp") {
    const col = numberColumn(ctx, node.field);
    const lo = node.min ?? -Infinity;
    const hi = node.max ?? Infinity;
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
  let only: Set<string> | undefined;
  if (node.op === "countIn") {
    const list = ctx.namedLists[node.list];
    if (!list) throw new CannotAnswer([`unknown list ${node.list}`]);
    only = new Set(list.values);
  }
  const counts = new Uint32Array(n);
  for (const [v, rows] of col.values) {
    if (only && !only.has(v)) continue;
    for (const r of rows) counts[r]!++;
  }
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
