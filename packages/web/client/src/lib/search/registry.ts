// The search registry is DATA: every entry is optional. A path under an owned prefix with no entry
// still becomes a field (label = path). Nothing here is per-field code.

export interface FieldEntry {
  label?: string;
  alias?: string;
  /** One plain-language line under the row's label: what the field says. */
  description?: string;
  /** Player words for a set field's values (`read`: "grammar" -> "read by our rules"). A value without one shows as it is. */
  valueLabels?: Record<string, string>;
  /** Overrides the group the owning prefix would give. */
  group?: string;
  sortable?: boolean;
  deny?: boolean;
  /** Earlier path ids this field answers to. */
  renamedFrom?: string[];
}

export interface NamedList {
  label: string;
  /** The set field the list is meant for (informational; the evaluator takes the list by name). */
  field?: string;
  values: string[];
}

/** A SET FIELD THE BUILD COMPUTES FROM OTHER WALKED FIELDS (#1785): one value per question a player asks, each the union of the rows holding any of its source `path=value` pairs.
 *  `cares` has `card-types` = distinctCount.counts "type" OR thresholdDistinct.counts "type": a payoff that counts distinct card types, on the board, in a graveyard or as delirium.
 *  A source path no card holds means the shards predate the grammar that writes it, so the field is NOT built (the catalogue lacks it and a question about it is cannot-answer), never built empty. */
export interface DerivedSet {
  /** The payload group the column ships in; its file needs a budget like any other. */
  group: string;
  /** value -> source pairs: `path=value`, `path=*` (any value the path holds) or `path@list` (any value in that named list). Each is one path, so a value is a union of facts about single abilities. */
  values: Record<string, string[]>;
}

export interface SearchRegistry {
  /** Prefix -> what a player types in its place (`tags.abilities.` -> `ab.`): `ab.count.floor` is `tags.abilities.count.floor`. A field's own `alias` wins. */
  pathAliases?: Record<string, string>;
  /** Path prefixes of per-ability data (`tags.abilities`). A field under one is judged ONE ABILITY AT A TIME by the engine and, until #1786, by card here: two terms on such fields match across the card's abilities. Such a walked path is also an Advanced field. */
  abilityPrefixes?: string[];
  /** Max distinct values for a string/boolean path to stay a set column. Default 400. */
  threshold?: number;
  fields: Record<string, FieldEntry>;
  /** group name -> path prefixes it owns. */
  groups: Record<string, string[]>;
  namedLists: Record<string, NamedList>;
  /** Computed set fields, keyed by their own path id (give them a `fields` entry for label, description and valueLabels). */
  derivedSets?: Record<string, DerivedSet>;
  /** Gzip byte budgets per group, plus `catalogue`. The build fails on a breach. */
  budgets?: Record<string, number>;
  /** Path ids (exact or prefix) that never become fields. */
  deny: string[];
}

export const DEFAULT_THRESHOLD = 400;

/** Never exposed (owner ruling 2026-11-23). Paths are rooted at `card` / `tags` as shipped in cards/*.json. */
export const DEFAULT_DENY: readonly string[] = [
  "q",
  "card.q",
  "tags.q",
  "card.edhrecRank",
  "card.edhrecSaltiness",
  "tags.deriveVersion",
  "tags.normalizeVersion",
  "edhrecRank",
  "card.tags.produces",
  "card.tags.cares",
  "card._id",
  "tags._id",
  "tags.oracleId",
  "tags.segmentHash",
  "tags.schemaVersion",
  "tags.promptVersion",
  "tags.model",
  "card.oracleId",
  "*._id",
  "*.oracleId",
  "*.printingId",
  "*.artCrop",
  "*.clause",
  "*.grantedBy",
];

/** Path under or equal to a prefix (segment-wise, so "tags.ab" does not own "tags.abilities"). */
export function underPrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + ".");
}

/** A deny entry is an exact path, a path prefix, or `*.leaf` (any path ending in that segment). */
export function isDenied(path: string, registry: SearchRegistry): boolean {
  if (registry.fields[path]?.deny) return true;
  const leaf = path.slice(path.lastIndexOf(".") + 1);
  return registry.deny.some((d) => (d.startsWith("*.") ? d.slice(2) === leaf : underPrefix(path, d)));
}

export function groupOf(path: string, registry: SearchRegistry): string | undefined {
  const forced = registry.fields[path]?.group;
  if (forced) return forced;
  let best: string | undefined;
  let bestLen = -1;
  for (const [name, prefixes] of Object.entries(registry.groups)) {
    for (const p of prefixes) {
      if (underPrefix(path, p) && p.length > bestLen) {
        best = name;
        bestLen = p.length;
      }
    }
  }
  return best;
}

/** One source of a derived set: `path=value`, `path=*` (any value the path holds) or `path@list` (any value in the named list). A pair has no AND and no NOT: a union of single-path facts, so each term is true of ONE ability, never of two abilities at once. */
export function termOf(pair: string): { path: string; value: string } | { path: string; list: string } {
  const at = pair.lastIndexOf("@");
  if (at > 0 && !pair.includes("=")) return { path: pair.slice(0, at), list: pair.slice(at + 1) };
  const eq = pair.lastIndexOf("=");
  return { path: pair.slice(0, eq), value: pair.slice(eq + 1) };
}

/** The path's own per-ability data: under an `abilityPrefixes` entry, or a computed field whose every source is. */
export function isAbilityField(path: string, registry: SearchRegistry): boolean {
  const under = (p: string): boolean => (registry.abilityPrefixes ?? []).some((a) => underPrefix(p, a));
  const derived = registry.derivedSets?.[path];
  if (derived) return Object.values(derived.values).flat().every((pair) => under(termOf(pair).path));
  return under(path);
}
