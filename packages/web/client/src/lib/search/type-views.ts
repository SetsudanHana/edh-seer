// Type fields as views over name-index rows: no new row bytes. `t` and `st` are read from the row
// codes; `tFront` needs the derived per-face data, supplied by the caller.
import type { NumberColumn, SetColumn } from "./walk.js";

export interface IndexRow {
  t?: number[];
  s?: number[];
}

export interface TypeIndex {
  types: string[];
  subtypes: string[];
  cards: IndexRow[];
}

export interface TypeViewOptions {
  /** CREATURE_SUBTYPES, supplied by the caller (the client lib does not import tagger). */
  creatureList: readonly string[];
  /** row -> front-face card types, from tags.characteristics.faces[0].types. Rows absent fall back to `t`. */
  frontTypes?: ReadonlyMap<number, readonly string[]>;
}

function add(map: Map<string, number[]>, v: string, row: number): void {
  const rows = map.get(v);
  if (rows) rows.push(row);
  else map.set(v, [row]);
}

const sortedMap = (m: Map<string, number[]>): Map<string, number[]> => new Map([...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)));

export function buildTypeViews(index: TypeIndex, opts: TypeViewOptions): SetColumn[] {
  const t = new Map<string, number[]>();
  const st = new Map<string, number[]>();
  const tFront = new Map<string, number[]>();
  const every = new Map<string, number[]>();
  const inIndex = new Set(index.subtypes);
  const required = opts.creatureList.filter((c) => inIndex.has(c));
  const codeOf = new Map(index.subtypes.map((s, i) => [s, i]));
  const requiredCodes = required.map((c) => codeOf.get(c)!);

  index.cards.forEach((row, i) => {
    for (const c of row.t ?? []) add(t, index.types[c]!, i);
    for (const c of row.s ?? []) add(st, index.subtypes[c]!, i);
    const front = opts.frontTypes?.get(i) ?? (row.t ?? []).map((c) => index.types[c]!);
    for (const v of new Set(front)) add(tFront, v, i);
    // Changelings hold every creature type in `s` (CR 702.73a); a row holding the whole list is flagged.
    if (requiredCodes.length > 0 && requiredCodes.length <= (row.s?.length ?? 0)) {
      const have = new Set(row.s);
      if (requiredCodes.every((c) => have.has(c))) add(every, "true", i);
    }
  });
  return [
    { kind: "set", path: "t", group: "types", values: sortedMap(t) },
    { kind: "set", path: "st", group: "types", values: sortedMap(st) },
    { kind: "set", path: "tFront", group: "types", values: sortedMap(tFront) },
    { kind: "set", path: "everyCreatureType", group: "types", values: sortedMap(every) },
  ];
}

export interface NumericRow {
  identity?: readonly string[];
  mv?: number;
  pow?: number;
  tou?: number;
}

function numberView(path: string, rows: readonly NumericRow[], pick: (r: NumericRow) => number | undefined): NumberColumn {
  const out: NumberColumn = { kind: "number", path, group: "types", rows: [], min: [], max: [] };
  rows.forEach((r, i) => {
    const v = pick(r);
    if (v === undefined) return;
    out.rows.push(i);
    out.min.push(v);
    out.max.push(v);
  });
  return out;
}

/** mv, pow, tou from name-index rows. An absent `mv` is 0 (what the artifact means by omitting it);
 *  an absent pow/tou stays absent: 242 cards print `*`/`X` and the engine says nothing (facets.ts). */
export function buildNumberViews(rows: readonly NumericRow[]): NumberColumn[] {
  return [
    numberView("mv", rows, (r) => r.mv ?? 0),
    numberView("pow", rows, (r) => r.pow),
    numberView("tou", rows, (r) => r.tou),
  ];
}

/** Colour identity as a set of W/U/B/R/G; a colourless card is in no list. */
export function buildIdentityView(rows: readonly NumericRow[]): SetColumn {
  const m = new Map<string, number[]>();
  rows.forEach((r, i) => {
    for (const c of r.identity ?? []) add(m, c, i);
  });
  return { kind: "set", path: "id", group: "types", values: sortedMap(m) };
}
