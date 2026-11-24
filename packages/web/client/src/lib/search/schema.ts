// What the typed query may name, read off what the page already holds: the core views, the vocabulary tables, the
// catalogue (fields, aliases, values, lists) and the event frequency file. Nothing here is a second list of fields.
import type { Catalogue } from "./catalogue.js";
import type { QuerySchema, SchemaField } from "./query.js";

const COLOURS = ["W", "U", "B", "R", "G"];

export interface SchemaSources {
  vocabulary: { types: readonly string[]; subtypes: readonly string[]; keywords: readonly string[] };
  /** null = this build has none; its fields are the core views alone. */
  catalogue: Catalogue | null;
  /** Whether the rows carry card colours (`c`); a build whose rows never do has no such field. */
  hasCardColours: boolean;
  /** null = not read yet. */
  events: { supply: Readonly<Record<string, number>>; consume: Readonly<Record<string, number>> } | null;
}

/** A table that has not loaded is no values at all, which reads as "not judged", never "no value is valid". */
const known = (v: readonly string[]): readonly string[] | undefined => (v.length > 0 ? v : undefined);

export function buildSchema(src: SchemaSources): QuerySchema {
  const fields = new Map<string, SchemaField>();
  const core: SchemaField[] = [
    { id: "t", kind: "set", values: known(src.vocabulary.types), noValues: "this build has no type vocabulary" },
    { id: "st", kind: "set", values: known(src.vocabulary.subtypes), noValues: "this build has no type vocabulary" },
    { id: "k", kind: "set", values: known(src.vocabulary.keywords), noValues: "this build has no keyword vocabulary" },
    { id: "id", kind: "set", values: COLOURS },
    ...(src.hasCardColours ? [{ id: "c", kind: "set", values: COLOURS } as SchemaField] : []),
    { id: "mv", kind: "number" },
    { id: "pow", kind: "number" },
    { id: "tou", kind: "number" },
  ];
  for (const f of core) fields.set(f.id, f);
  const sparse = new Map<string, string>();
  for (const g of Object.values(src.catalogue?.groups ?? {})) {
    for (const cf of g.fields) {
      const had = fields.get(cf.id);
      // t, st and k are answered from the page's own vocabulary tables, so their values come from those and from nothing
      // else: a catalogue's list for them must not make a value "known" that the core view cannot answer.
      const own = had?.noValues !== undefined;
      const values = cf.kind === "set" && !own
        ? known([...(cf.values ?? []).map((v) => v.v), ...Object.keys(cf.valueLabels ?? {})].filter((v, i, a) => a.indexOf(v) === i))
        : undefined;
      if (cf.fallback) sparse.set(cf.id, cf.fallback);
      fields.set(cf.id, {
        id: cf.id, kind: cf.kind,
        ...(cf.alias ? { alias: cf.alias } : {}),
        ...(cf.ability ? { ability: true as const } : {}),
        ...(had ? (had.values ? { values: had.values } : values ? { values } : {}) : values ? { values } : {}),
        ...(had?.noValues ? { noValues: had.noValues } : {}),
      });
    }
  }
  // A SPARSE COLUMN (stBest) lists only the rows it overrides; every other row answers as its fallback field does. Its
  // values are the union, and unknown when the fallback's are.
  for (const [id, base] of sparse) {
    const f = fields.get(id)!;
    const b = fields.get(base);
    const union = b?.values ? [...new Set([...b.values, ...(f.values ?? [])])] : undefined;
    fields.set(id, { ...f, ...(union ? { values: union } : { values: undefined, ...(b?.noValues ? { noValues: b.noValues } : {}) }) });
  }
  const positive = (m: Readonly<Record<string, number>>): Set<string> => new Set(Object.keys(m).filter((k) => (m[k] ?? 0) > 0));
  return {
    fields: [...fields.values()],
    lists: Object.keys(src.catalogue?.namedLists ?? {}),
    events: src.events ? { makes: positive(src.events.supply), asks: positive(src.events.consume) } : null,
  };
}
