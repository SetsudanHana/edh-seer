// Ability-row postings (#1786). `ability( a and b )` needs "the SAME ability holds both", which a card-level posting cannot say: it
// records that SOME ability on the card has the value. Here every `tags.abilities[i]` is a row of its own. Its id is the card's
// offset plus i, ids run in card-row order, and a per-card ability count (`n`, for the cards that have any) is all it takes to map an
// id back to its card. Postings are the same delta + varint ones the card-level groups use, now over ability ids.
// CEILING: a row is one ability, not one effect or one emit inside it: `ab.emits.verb:draw` and `ab.emits.subject.control:opponent`
// holding on two different emits of ONE ability still count as the same ability. The grammar nests those arrays under an ability and
// the walker collapses array indices, exactly as it does for the card-level fields.
import { decodePostings, encodePostings } from "./postings.js";
import { decodeFieldPayload, encodeColumn, type FieldPayload } from "./catalogue.js";
import { isAbilityField, type SearchRegistry } from "./registry.js";
import { derivedSetColumn, walkRecords, type Column, type WalkRecord } from "./walk.js";

/** The file's payload: which cards have abilities and how many, then each ability field's postings over ability ids. */
export interface AbilityRowsPayload {
  /** Card rows holding at least one ability, ascending (postings). */
  rows: string;
  /** How many abilities each of those rows holds, in the same order. */
  n: number[];
  fields: Record<string, FieldPayload>;
  /** Cards with no record or no tags: they cannot say "no ability of mine is X", so a NOT over an `ability( … )` leaves them out. Absent in a file written before this. */
  unjudged?: string;
}

/** The ability rows once decoded: columns over ability ids, and the card each id belongs to. */
export interface AbilityRows {
  /** Number of ability ids. */
  count: number;
  /** ability id -> card row */
  owner: Uint32Array;
  columns: ReadonlyMap<string, Column>;
  unjudged?: number[];
}

/** The pseudo-records of a build: one per ability, numbered in card-row order. */
export function abilityRecords(records: readonly WalkRecord[]): { records: WalkRecord[]; rows: number[]; n: number[] } {
  const out: WalkRecord[] = [];
  const rows: number[] = [];
  const n: number[] = [];
  for (const rec of [...records].sort((a, b) => a.row - b.row)) {
    const abs = (rec.tags as { abilities?: unknown } | null)?.abilities;
    if (!Array.isArray(abs) || abs.length === 0) continue;
    rows.push(rec.row);
    n.push(abs.length);
    for (const ab of abs) out.push({ row: out.length, card: null, tags: { abilities: [ab] } });
  }
  return { records: out, rows, n };
}

/** The ability-level columns of every ability field the card-level walk kept (a path the card walk dropped for being free text is dropped here too), plus the computed fields over them. */
export function buildAbilityRows(records: readonly WalkRecord[], registry: SearchRegistry, kept: ReadonlyMap<string, Column>, unjudged: readonly number[] = []): { payload: AbilityRowsPayload; columns: Map<string, Column> } {
  const ar = abilityRecords(records);
  const prefixes = registry.abilityPrefixes ?? [];
  const own: SearchRegistry = {
    ...registry,
    groups: { abilityRows: prefixes },
    fields: Object.fromEntries(Object.entries(registry.fields).map(([k, v]) => [k, { ...v, group: undefined }])),
  };
  const walked = walkRecords(ar.records, own);
  const columns = new Map<string, Column>();
  for (const [path, col] of walked.columns) {
    const card = kept.get(path);
    if (card && card.kind === col.kind && isAbilityField(path, registry)) columns.set(path, col);
  }
  for (const [path, def] of Object.entries(registry.derivedSets ?? {})) {
    if (!isAbilityField(path, registry)) continue;
    const { column } = derivedSetColumn(path, def, columns, registry.namedLists);
    // only a value the card-level build also made: a field is as complete here as it is there
    if (column && kept.has(path)) columns.set(path, { ...column, group: "abilityRows" });
  }
  const fields: Record<string, FieldPayload> = {};
  for (const [path, col] of columns) fields[path] = encodeColumn(col);
  return { payload: { rows: encodePostings(ar.rows), n: ar.n, fields, ...(unjudged.length > 0 ? { unjudged: encodePostings(unjudged) } : {}) }, columns };
}

/** Rebuild from the fetched file. Throws on a count column that does not fit its rows: a torn file is never half read. */
export function decodeAbilityRows(payload: AbilityRowsPayload): AbilityRows {
  const rows = decodePostings(payload.rows);
  if (rows.length !== payload.n.length) throw new Error("ability rows: the count column does not match its rows");
  const total = payload.n.reduce((a, b) => a + b, 0);
  const owner = new Uint32Array(total);
  let at = 0;
  rows.forEach((row, i) => { for (let k = 0; k < payload.n[i]!; k++) owner[at++] = row; });
  const columns = new Map<string, Column>();
  for (const [path, p] of Object.entries(payload.fields)) columns.set(path, decodeFieldPayload(path, p));
  return { count: total, owner, columns, ...(payload.unjudged ? { unjudged: decodePostings(payload.unjudged) } : {}) };
}
