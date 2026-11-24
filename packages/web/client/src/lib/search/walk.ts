import { DEFAULT_THRESHOLD, groupOf, isDenied, termOf, type DerivedSet, type SearchRegistry } from "./registry.js";

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
  /** A sparse column: `values` hold only the `overrides` rows; every other row answers as `fallback` does. */
  fallback?: string;
  overrides?: number[];
  /** Rows this column cannot speak for (a card with no record, or one with no tags): a NOT over it leaves them out, because "none of its triggers is unread" is no answer about a card nobody read. Absent = it speaks for every row. */
  unjudged?: number[];
  /** Effective per-value counts of a sparse column (what the catalogue reports). */
  totals?: Map<string, number>;
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
  /** Paths holding both string and number leaves: numbers are kept as set members (stringified). */
  mixed: string[];
  /** Numeric paths where some card holds more than one distinct value (`cmp` reads the [min,max] range). */
  multiValued: string[];
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
  numStrings: Map<string, Set<number>>;
  nums: Map<number, { min: number; max: number }>;
  hasNumber: boolean;
  multi: boolean;
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
    const perCard = new Map<string, { s?: Set<string>; n?: Set<string>; lo?: number; hi?: number }>();
    const visit = (path: string, v: string | boolean | number) => {
      if (wanted(path) === null) return;
      let c = perCard.get(path);
      if (!c) perCard.set(path, (c = {}));
      if (typeof v === "number") {
        c.lo = c.lo === undefined ? v : Math.min(c.lo, v);
        c.hi = c.hi === undefined ? v : Math.max(c.hi, v);
        (c.n ??= new Set()).add(String(v)); // stringified, used if the path turns out mixed
      } else (c.s ??= new Set()).add(String(v));
    };
    leaves(rec.card, "card", visit);
    leaves(rec.tags, "tags", visit);
    for (const [path, c] of perCard) {
      let acc = accs.get(path);
      if (!acc) accs.set(path, (acc = { strings: new Map(), hasString: false, nums: new Map(), numStrings: new Map(), hasNumber: false, multi: false }));
      if (c.lo !== undefined) {
        acc.hasNumber = true;
        if (c.lo !== c.hi) acc.multi = true;
        acc.nums.set(rec.row, { min: c.lo, max: c.hi! });
        for (const s of c.n!) {
          let rows = acc.numStrings.get(s);
          if (!rows) acc.numStrings.set(s, (rows = new Set()));
          rows.add(rec.row);
        }
      }
      if (c.s) {
        acc.hasString = true;
        for (const s of c.s) {
          let rows = acc.strings.get(s);
          if (!rows) acc.strings.set(s, (rows = new Set()));
          rows.add(rec.row);
        }
      }
    }
  }

  const columns = new Map<string, Column>();
  const dropped: { path: string; distinct: number }[] = [];
  const mixed: string[] = [];
  const multiValued: string[] = [];
  for (const [path, acc] of [...accs].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const group = wanted(path)!;
    if (acc.hasString) {
      if (acc.hasNumber) {
        mixed.push(path);
        for (const [v, rows] of acc.numStrings) {
          const have = acc.strings.get(v);
          if (have) for (const r of rows) have.add(r);
          else acc.strings.set(v, rows);
        }
      }
      if (acc.strings.size > threshold) {
        dropped.push({ path, distinct: acc.strings.size });
        continue;
      }
      const values = new Map<string, number[]>();
      for (const v of [...acc.strings.keys()].sort()) values.set(v, [...acc.strings.get(v)!].sort((a, b) => a - b));
      columns.set(path, { kind: "set", path, group, values });
    } else if (acc.hasNumber) {
      if (acc.multi) multiValued.push(path);
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
  return { columns, dropped, mixed, multiValued };
}

/** A registry `derivedSets` entry as a column over the walked ones (#1785). A value is built only when EVERY source path of it is a column (and every named list it reads is held): a union over a path the shards never carried is an empty answer standing in for "cannot
 *  answer" (shards derived before the grammar that writes the path). A value that cannot be built is left out and named in `unbuilt` with the paths it lacked (`list <name>` for a missing named list), so the caller can also stop SAYING it as a known value; when no value can be built there is no column and `missing` says why.
 *  A path that exists but holds none of a value's pairs contributes nothing, as it should; a value no row holds is left out of `values`, as in every set column. */
export function derivedSetColumn(path: string, def: DerivedSet, columns: ReadonlyMap<string, Column>, namedLists: Readonly<Record<string, { values: readonly string[] }>> = {}): { column?: SetColumn; missing: string[]; unbuilt?: Record<string, string[]> } {
  const values = new Map<string, number[]>();
  const unbuilt: Record<string, string[]> = {};
  for (const [value, pairs] of Object.entries(def.values)) {
    const terms = pairs.map(termOf);
    const lacks = [
      ...new Set(terms.map((t) => t.path)),
    ].filter((p) => columns.get(p)?.kind !== "set").sort();
    lacks.push(...[...new Set(terms.flatMap((t) => ("list" in t ? [t.list] : [])))].filter((l) => !(l in namedLists)).sort().map((l) => `list ${l}`));
    if (lacks.length > 0) { unbuilt[value] = lacks; continue; }
    const rows = new Set<number>();
    for (const t of terms) {
      const col = columns.get(t.path) as SetColumn;
      const held = "list" in t ? namedLists[t.list]!.values : t.value === "*" ? [...col.values.keys()] : [t.value];
      for (const v of held) for (const r of col.values.get(v) ?? []) rows.add(r);
    }
    if (rows.size > 0) values.set(value, [...rows].sort((a, b) => a - b));
  }
  const missing = [...new Set(Object.values(unbuilt).flat())].sort();
  if (Object.keys(unbuilt).length === Object.keys(def.values).length) return { missing };
  return { column: { kind: "set", path, group: def.group, values }, missing, ...(missing.length > 0 ? { unbuilt } : {}) };
}
