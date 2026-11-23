import { DEFAULT_THRESHOLD, groupOf, isDenied, type SearchRegistry } from "./registry.js";

/** One entry of cards/*.json plus the card's row in name-index.json `cards`. `tags` may be null (underived). */
export interface WalkRecord {
  row: number;
  card: unknown;
  tags: unknown;
}

export interface SetColumn {
  kind: "set";
  path: string;
  group: string;
  /** value -> sorted unique rows */
  values: Map<string, number[]>;
}

export interface NumberColumn {
  kind: "number";
  path: string;
  group: string;
  /** Rows that carry a value, ascending; min[i]/max[i] belong to rows[i]. Absent rows are not listed. */
  rows: number[];
  min: number[];
  max: number[];
}

export type Column = SetColumn | NumberColumn;

export interface WalkResult {
  columns: Map<string, Column>;
  /** String paths above the threshold: free text, not searched. */
  dropped: { path: string; distinct: number }[];
}

/** Collapse array indices: leaves are collected under `a.b.c` whatever the nesting. */
function leaves(node: unknown, path: string, out: (path: string, v: string | boolean | number) => void): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const el of node) leaves(el, path, out);
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) leaves(v, path ? `${path}.${k}` : k, out);
    return;
  }
  if (typeof node === "string" || typeof node === "boolean") out(path, node);
  else if (typeof node === "number" && Number.isFinite(node)) out(path, node);
}

interface Acc {
  strings: Map<string, Set<number>>;
  hasString: boolean;
  nums: Map<number, { min: number; max: number }>;
  hasNumber: boolean;
}

export function walkRecords(records: Iterable<WalkRecord>, registry: SearchRegistry): WalkResult {
  const threshold = registry.threshold ?? DEFAULT_THRESHOLD;
  const accs = new Map<string, Acc>();
  // Decide per path once whether it is walked at all.
  const verdict = new Map<string, string | null>();
  const wanted = (path: string): string | null => {
    let v = verdict.get(path);
    if (v === undefined) {
      v = isDenied(path, registry) ? null : (groupOf(path, registry) ?? null);
      verdict.set(path, v);
    }
    return v;
  };

  for (const rec of records) {
    const perCard = new Map<string, { s?: Set<string>; lo?: number; hi?: number }>();
    const visit = (path: string, v: string | boolean | number) => {
      if (wanted(path) === null) return;
      let c = perCard.get(path);
      if (!c) perCard.set(path, (c = {}));
      if (typeof v === "number") {
        c.lo = c.lo === undefined ? v : Math.min(c.lo, v);
        c.hi = c.hi === undefined ? v : Math.max(c.hi, v);
      } else (c.s ??= new Set()).add(String(v));
    };
    leaves(rec.card, "card", visit);
    leaves(rec.tags, "tags", visit);
    for (const [path, c] of perCard) {
      let acc = accs.get(path);
      if (!acc) accs.set(path, (acc = { strings: new Map(), hasString: false, nums: new Map(), hasNumber: false }));
      if (c.s) {
        acc.hasString = true;
        for (const s of c.s) {
          let rows = acc.strings.get(s);
          if (!rows) acc.strings.set(s, (rows = new Set()));
          rows.add(rec.row);
        }
      }
      if (c.lo !== undefined) {
        acc.hasNumber = true;
        acc.nums.set(rec.row, { min: c.lo, max: c.hi! });
      }
    }
  }

  const columns = new Map<string, Column>();
  const dropped: { path: string; distinct: number }[] = [];
  for (const [path, acc] of [...accs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const group = wanted(path)!;
    if (acc.hasString) {
      if (acc.strings.size > threshold) {
        dropped.push({ path, distinct: acc.strings.size });
        continue;
      }
      const values = new Map<string, number[]>();
      for (const v of [...acc.strings.keys()].sort()) values.set(v, [...acc.strings.get(v)!].sort((a, b) => a - b));
      columns.set(path, { kind: "set", path, group, values });
    } else if (acc.hasNumber) {
      const rows = [...acc.nums.keys()].sort((a, b) => a - b);
      columns.set(path, {
        kind: "number",
        path,
        group,
        rows,
        min: rows.map((r) => acc.nums.get(r)!.min),
        max: rows.map((r) => acc.nums.get(r)!.max),
      });
    }
  }
  return { columns, dropped };
}
