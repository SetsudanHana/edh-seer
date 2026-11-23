// Type fields as views over name-index rows: no new row bytes. `t` and `st` are read from the row
// codes; `tFront` needs the derived per-face data, supplied by the caller.
import type { SetColumn } from "./walk.js";

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
    { kind: "set", path: "t", group: "core", values: sortedMap(t) },
    { kind: "set", path: "st", group: "core", values: sortedMap(st) },
    { kind: "set", path: "tFront", group: "core", values: sortedMap(tFront) },
    { kind: "set", path: "everyCreatureType", group: "core", values: sortedMap(every) },
  ];
}
