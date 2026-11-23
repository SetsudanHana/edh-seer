import { encodePostings } from "./postings.js";
import type { NamedList, SearchRegistry } from "./registry.js";
import type { Column, WalkResult } from "./walk.js";

export const FORMAT_VERSION = 1;

export interface CatalogueField {
  id: string;
  kind: "set" | "number";
  label?: string;
  alias?: string;
  values?: { v: string; n: number }[];
  min?: number;
  max?: number;
}

export interface CatalogueGroup {
  /** Payload file inside the search directory; null = served by name-index.json (no new bytes). */
  file: string | null;
  fields: CatalogueField[];
}

export interface Catalogue {
  formatVersion: typeof FORMAT_VERSION;
  version: string;
  deriveVersion: number;
  groups: Record<string, CatalogueGroup>;
  namedLists: Record<string, NamedList>;
}

export type FieldPayload =
  | { kind: "set"; values: Record<string, string> }
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

function describe(col: Column, registry: SearchRegistry): CatalogueField {
  const entry = registry.fields[col.path];
  const f: CatalogueField = { id: col.path, kind: col.kind };
  f.label = entry?.label ?? col.path;
  if (entry?.alias) f.alias = entry.alias;
  if (col.kind === "set") {
    f.values = [...col.values].map(([v, rows]) => ({ v, n: rows.length }));
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
    return { kind: "set", values };
  }
  return { kind: "number", rows: encodePostings(col.rows), min: col.min, max: col.max };
}

export function buildCatalogue(input: BuildInput): { catalogue: Catalogue; payloads: Record<string, GroupPayload> } {
  const { registry } = input;
  const groups: Record<string, CatalogueGroup> = {};
  const payloads: Record<string, GroupPayload> = {};
  if (input.core?.length) {
    groups["core"] = { file: null, fields: input.core.map((c) => describe(c, registry)) };
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
