import { decodePostings, encodePostings } from "./postings.js";
import { isAbilityField, type NamedList, type SearchRegistry } from "./registry.js";
import type { Column, WalkResult } from "./walk.js";

export const FORMAT_VERSION = 1;

export interface CatalogueField {
  id: string;
  kind: "set" | "number";
  label?: string;
  alias?: string;
  /** The field is about the card's ABILITIES, each judged on its own by the engine; here two terms on such fields are matched across the card (#1784, until #1786). */
  ability?: true;
  /** Shown only behind the "Advanced fields" switch, labelled or not: a path of the grammar rather than a question a player asks. */
  advanced?: true;
  /** One plain-language line under the row's label, from the registry. */
  description?: string;
  /** Player words for values, from the registry; a value with none is shown as it is. */
  valueLabels?: Record<string, string>;
  values?: { v: string; n: number }[];
  /** Sparse set field: rows outside the payload's `overrides` answer as this field does. */
  fallback?: string;
  min?: number;
  max?: number;
}

export interface CatalogueGroup {
  /** Payload file inside the search directory; null = served by name-index.json (no new bytes). */
  file: string | null;
  fields: CatalogueField[];
  /** Set by the build once the payload is serialised. */
  bytes?: number;
  gzipBytes?: number;
}

export interface Catalogue {
  formatVersion: typeof FORMAT_VERSION;
  version: string;
  deriveVersion: number;
  groups: Record<string, CatalogueGroup>;
  namedLists: Record<string, NamedList>;
}

export type FieldPayload =
  | { kind: "set"; values: Record<string, string>; fallback?: string; overrides?: string }
  | { kind: "number"; rows: string; min: number[]; max: number[] };

export interface GroupPayload {
  fields: Record<string, FieldPayload>;
}

export interface BuildInput {
  version: string;
  deriveVersion: number;
  registry: SearchRegistry;
  walk: WalkResult;
  /** Columns computed from name-index rows (type views): described in the catalogue, no payload. */
  core?: Column[];
}

/** The short name a prefix gives a path (`tags.abilities.count.floor` -> `ab.count.floor`), the longest prefix first. */
function aliasOf(path: string, registry: SearchRegistry): string | undefined {
  const hit = Object.entries(registry.pathAliases ?? {}).filter(([p]) => path.startsWith(p) && path.length > p.length).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] + path.slice(hit[0].length) : undefined;
}

function describe(col: Column, registry: SearchRegistry): CatalogueField {
  const entry = registry.fields[col.path];
  const f: CatalogueField = { id: col.path, kind: col.kind };
  f.label = entry?.label ?? col.path;
  const alias = entry?.alias ?? aliasOf(col.path, registry);
  if (alias) f.alias = alias;
  if (isAbilityField(col.path, registry)) {
    f.ability = true;
    // a computed field (cares, grants, counts) is a question a player asks; a walked path of the grammar is not
    if (!registry.derivedSets?.[col.path]) f.advanced = true;
  }
  if (entry?.description) f.description = entry.description;
  if (entry?.valueLabels && col.kind === "set") f.valueLabels = entry.valueLabels;
  if (col.kind === "set") {
    f.values = [...(col.totals ?? new Map([...col.values].map(([v, rows]) => [v, rows.length] as const)))].map(([v, n]) => ({ v, n }));
    if (col.fallback) f.fallback = col.fallback;
  } else if (col.rows.length > 0) {
    f.min = Math.min(...col.min);
    f.max = Math.max(...col.max);
  }
  return f;
}

function payloadOf(col: Column): FieldPayload {
  if (col.kind === "set") {
    const values: Record<string, string> = {};
    for (const [v, rows] of col.values) values[v] = encodePostings(rows);
    return col.fallback ? { kind: "set", values, fallback: col.fallback, overrides: encodePostings(col.overrides ?? []) } : { kind: "set", values };
  }
  return { kind: "number", rows: encodePostings(col.rows), min: col.min, max: col.max };
}

export function buildCatalogue(input: BuildInput): { catalogue: Catalogue; payloads: Record<string, GroupPayload> } {
  const { registry } = input;
  const groups: Record<string, CatalogueGroup> = {};
  const payloads: Record<string, GroupPayload> = {};
  if (input.core?.length) {
    groups["types"] = { file: null, fields: input.core.map((c) => describe(c, registry)) };
  }
  for (const col of input.walk.columns.values()) {
    const g = (groups[col.group] ??= { file: `${col.group}.json`, fields: [] });
    g.fields.push(describe(col, registry));
    (payloads[col.group] ??= { fields: {} }).fields[col.path] = payloadOf(col);
  }
  return {
    catalogue: {
      formatVersion: FORMAT_VERSION,
      version: input.version,
      deriveVersion: input.deriveVersion,
      groups,
      namedLists: registry.namedLists,
    },
    payloads,
  };
}

/** Rebuild columns from a group payload: what a client does after fetching the group file. */
export function decodeGroup(group: CatalogueGroup, payload: GroupPayload): Column[] {
  const out: Column[] = [];
  for (const f of group.fields) {
    const p = payload.fields[f.id];
    if (!p) continue;
    if (p.kind === "set") {
      const values = new Map<string, number[]>();
      for (const [v, b64] of Object.entries(p.values)) values.set(v, decodePostings(b64));
      const col: Column = { kind: "set", path: f.id, group: "", values };
      if (p.fallback) {
        col.fallback = p.fallback;
        col.overrides = decodePostings(p.overrides ?? "");
      }
      out.push(col);
    } else {
      out.push({ kind: "number", path: f.id, group: "", rows: decodePostings(p.rows), min: p.min, max: p.max });
    }
  }
  return out;
}
