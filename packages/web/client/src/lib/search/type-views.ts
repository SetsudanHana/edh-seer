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
  /** Absent on a thin name-index row, which carries no characteristics at all. */
  t?: number[];
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

/** mv, pow, tou from name-index rows. An absent `mv` is 0 (what the artifact means by omitting it) ONLY on a row
 *  that has `t`; a thin row (no `t`, no `mv`) says nothing, so its mv stays absent. An absent pow/tou stays
 *  absent: 242 cards print `*`/`X` and the engine says nothing (facets.ts). */
export function buildNumberViews(rows: readonly NumericRow[]): NumberColumn[] {
  return [
    numberView("mv", rows, (r) => (r.t === undefined ? r.mv : (r.mv ?? 0))),
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

/** The front-face view as a SPARSE column over `t`: only rows whose front types differ from their `t` are stored.
 *  Every other row answers as `t` does (name-index carries no face data, so this is what the client fetches). */
export function sparseFront(full: SetColumn, base: SetColumn): SetColumn {
  const key = (col: SetColumn) => {
    const m = new Map<number, string[]>();
    for (const [v, rows] of col.values) for (const r of rows) (m.get(r) ?? m.set(r, []).get(r)!).push(v);
    return m;
  };
  const f = key(full);
  const b = key(base);
  const rows = new Set([...f.keys(), ...b.keys()]);
  const overrides: number[] = [];
  for (const r of [...rows].sort((x, y) => x - y)) {
    const a = [...(f.get(r) ?? [])].sort().join(",");
    const c = [...(b.get(r) ?? [])].sort().join(",");
    if (a !== c) overrides.push(r);
  }
  const own = new Set(overrides);
  const values = new Map<string, number[]>();
  for (const [v, rs] of full.values) {
    const kept = rs.filter((r) => own.has(r));
    if (kept.length) values.set(v, kept);
  }
  return {
    kind: "set", path: full.path, group: "faces", fallback: base.path, overrides, values,
    totals: new Map([...full.values].map(([v, rs]) => [v, rs.length])),
  };
}

/** THE SUBTYPES OF EACH CARD'S BEST FACE, as a SPARSE column over `st` (owner decision, #1782): a two-faced card counts the
 *  creature types of the one face with the most, not the union of both ("Tiefling Druid // Bird Bear" is 2, not 4: what the
 *  card can be on the battlefield). `faces` is what the shard carries per row (`tags.characteristics.faces[].subtypes`);
 *  a transform card may list only its front. Ties go to the earlier face. A row with no faces data answers as `st` does, and so
 *  does a changeling (it holds every creature type, CR 702.73a, whatever its faces print). Only rows whose best face
 *  differs from their `st` are stored. */
export function sparseBestFace(
  index: TypeIndex, faces: ReadonlyMap<number, readonly (readonly string[])[]>, creatureList: readonly string[],
): SetColumn {
  const creature = new Set(creatureList);
  const codeOf = new Map(index.subtypes.map((s, i) => [s, i]));
  const required = creatureList.filter((c) => codeOf.has(c)).map((c) => codeOf.get(c)!);
  const values = new Map<string, number[]>();
  const overrides: number[] = [];
  index.cards.forEach((row, i) => {
    const fs = faces.get(i);
    if (!fs || fs.length === 0) return;
    const have = new Set(row.s ?? []);
    if (required.length > 0 && required.every((c) => have.has(c))) return;
    let best = fs[0]!;
    for (const f of fs) if (f.filter((v) => creature.has(v)).length > best.filter((v) => creature.has(v)).length) best = f;
    const mine = [...new Set(best)].sort();
    const whole = [...have].map((c) => index.subtypes[c]!).sort();
    if (mine.join(",") === whole.join(",")) return;
    overrides.push(i);
    for (const v of mine) add(values, v, i);
  });
  return { kind: "set", path: "stBest", group: "faces", fallback: "st", overrides, values: sortedMap(values) };
}

/** The subtypes of every face of a printed type line ("A — X Y // B — Z"): the part after the em dash of each `" // "` half,
 *  matched against the known subtype names, longest run of words first so "time lord" stays one type. A word no name covers
 *  stands alone; a half with no em dash has none. Never a plain split on spaces. */
export function faceSubtypesFromTypeLine(typeLine: string, known: ReadonlySet<string>): string[][] {
  return typeLine.split(" // ").map((half) => {
    const at = half.indexOf("\u2014");
    if (at < 0) return [];
    const words = half.slice(at + 1).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < words.length;) {
      let n = words.length - i;
      while (n > 1 && !known.has(words.slice(i, i + n).join(" "))) n--;
      out.push(words.slice(i, i + n).join(" "));
      i += n;
    }
    return out;
  });
}

/** The faces a row's best face is chosen from: the listed ones, unless the shard lists FEWER faces than the printed type line
 *  has halves (a transform card often lists only its front), when every face comes from its half of the type line. */
export function completeFaces(listed: readonly (readonly string[])[] | undefined, typeLine: string | undefined, known: ReadonlySet<string>, hasTypes = true): string[][] | undefined {
  const parts = typeLine ? typeLine.split(" // ").length : 0;
  // A thin row (no `t`) is outside every type count: it is not given creature types its row does not carry.
  if (hasTypes && typeLine && parts > 1 && (listed?.length ?? 0) < parts) return faceSubtypesFromTypeLine(typeLine, known);
  return listed && listed.length > 0 ? listed.map((f) => [...f]) : undefined;
}

/** A column from a row's integer codes into a table (`t`, `s`, `k`): the row carries codes, the view names them.
 *  A code with no name in the table (the tables load apart from the rows) is skipped, never stored as "undefined". */
export function buildCodeView(path: string, table: readonly string[], codes: readonly (readonly number[] | undefined)[]): SetColumn {
  const m = new Map<string, number[]>();
  codes.forEach((cs, i) => {
    for (const c of cs ?? []) {
      const name = table[c];
      if (name !== undefined) add(m, name, i);
    }
  });
  return { kind: "set", path, group: "types", values: sortedMap(m) };
}

const COLOUR_BITS: readonly (readonly [string, number])[] = [["W", 1], ["U", 2], ["B", 4], ["R", 8], ["G", 16]];

/** The card's own colours (`c`, a WUBRG bitmask; absent = colourless) as a set of W/U/B/R/G. A colourless card is in no
 *  list, so "colourless" is `count c max 0`. Callers build it only when the rows carry `c` at all. */
export function buildColourView(masks: readonly (number | undefined)[]): SetColumn {
  const m = new Map<string, number[]>();
  masks.forEach((mask, i) => {
    if (!mask) return;
    for (const [name, bit] of COLOUR_BITS) if (mask & bit) add(m, name, i);
  });
  return { kind: "set", path: "c", group: "types", values: sortedMap(m) };
}

/** Rows holding EVERY creature type (a changeling, CR 702.73a), as the `everyCreatureType` flag. Needs the creature list, which
 *  only the catalogue carries, so it is built once that has loaded. A row counts when its subtypes include every list
 *  member the subtype table knows. */
export function buildEveryCreatureTypeView(
  subtypeTable: readonly string[], creatureList: readonly string[], codes: readonly (readonly number[] | undefined)[],
): SetColumn {
  const inTable = new Set(subtypeTable);
  const required = creatureList.filter((c) => inTable.has(c));
  const need = new Set(required.map((c) => subtypeTable.indexOf(c)));
  const rows: number[] = [];
  if (need.size > 0) {
    codes.forEach((cs, i) => {
      if (!cs || cs.length < need.size) return;
      const have = new Set(cs);
      for (const c of need) if (!have.has(c)) return;
      rows.push(i);
    });
  }
  return { kind: "set", path: "everyCreatureType", group: "types", values: new Map(rows.length ? [["true", rows]] : []) };
}
