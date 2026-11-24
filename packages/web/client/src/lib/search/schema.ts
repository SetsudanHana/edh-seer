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
  for (const g of Object.values(src.catalogue?.groups ?? {})) {
    for (const cf of g.fields) {
      const had = fields.get(cf.id);
      // The page's own tables win for the core fields; the catalogue fills in what they lack.
      const values = cf.kind === "set"
        ? known([...(cf.values ?? []).map((v) => v.v), ...Object.keys(cf.valueLabels ?? {})].filter((v, i, a) => a.indexOf(v) === i))
        : undefined;
      fields.set(cf.id, {
        id: cf.id, kind: cf.kind,
        ...(cf.alias ? { alias: cf.alias } : {}),
        ...(had ? (had.values ? { values: had.values } : values ? { values } : {}) : values ? { values } : {}),
        ...(had?.noValues ? { noValues: had.noValues } : {}),
      });
    }
  }
  const positive = (m: Readonly<Record<string, number>>): Set<string> => new Set(Object.keys(m).filter((k) => (m[k] ?? 0) > 0));
  return {
    fields: [...fields.values()],
    lists: Object.keys(src.catalogue?.namedLists ?? {}),
    events: src.events ? { makes: positive(src.events.supply), asks: positive(src.events.consume) } : null,
  };
}
