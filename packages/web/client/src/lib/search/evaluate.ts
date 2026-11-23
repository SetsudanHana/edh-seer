import type { Column, SetColumn } from "./walk.js";

export type Node =
  | { and: Node[] }
  | { or: Node[] }
  | { not: Node }
  | { field: string; op: "has"; value: string }
  | { field: string; op: "count"; min?: number; max?: number }
  | { field: string; op: "countIn"; list: string; min?: number; max?: number };

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
  const col = setColumn(ctx, node.field);
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
