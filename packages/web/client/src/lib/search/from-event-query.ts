// The /cards and /commanders characteristic filter, as an AST over views of the name-index rows.
// One evaluator for the page and for every later search surface (#1782). The event terms are still
// computed by the existing code and join as `rows` leaves.
import { TYPE_COUNTS, type EventQuery, type FieldFilter, type TypeCountSort } from "../facets.js";
import { evaluate, rowCounts, type EvalContext, type EvalResult, type Node } from "./evaluate.js";
import { buildCodeView, buildColourView, buildEveryCreatureTypeView, buildIdentityView, buildNumberViews } from "./type-views.js";
import type { Column } from "./walk.js";

export type PageMode = "cards" | "commanders";

/** The name-index row fields the core views read. A structural subset of `NameIndexEntry`. */
export interface CoreRow {
  identity: readonly string[];
  commander?: boolean;
  t?: number[];
  s?: number[];
  k?: number[];
  mv?: number;
  pow?: number;
  tou?: number;
  c?: number;
}

export interface CoreVocab { types: readonly string[]; subtypes: readonly string[]; keywords: readonly string[] }

/** Views over the rows already in the browser: t, st, k, mv, pow, tou, id, and `c` when the rows carry it.
 *  Nothing here needs the search catalogue. `c` is left OUT of an artifact whose rows never carry it: a
 *  missing `c` means colourless on a fresh artifact and means nothing on an old one, so the field
 *  is unknown there and a colour question cannot be answered (silent wrong answer: "Colourless" = whole corpus). */
export function coreColumns(rows: readonly CoreRow[], vocab: CoreVocab): Map<string, Column> {
  const cols: Column[] = [
    buildCodeView("t", vocab.types, rows.map((r) => r.t)),
    buildCodeView("st", vocab.subtypes, rows.map((r) => r.s)),
    buildCodeView("k", vocab.keywords, rows.map((r) => r.k)),
    ...buildNumberViews(rows),
    buildIdentityView(rows),
  ];
  if (rows.some((r) => r.c !== undefined)) cols.push(buildColourView(rows.map((r) => r.c)));
  return new Map(cols.map((c) => [c.path, c]));
}

/** The core views as an evaluation context. Named lists and catalogue-only fields are absent until the
 *  caller adds them, so a question about them answers cannot-answer rather than empty. */
export function coreContext(
  rows: readonly CoreRow[], vocab: CoreVocab,
  extra?: { columns?: Iterable<Column>; namedLists?: EvalContext["namedLists"] },
): EvalContext {
  const columns = coreColumns(rows, vocab);
  for (const c of extra?.columns ?? []) if (!columns.has(c.path)) columns.set(c.path, c);
  return { rowCount: rows.length, columns, namedLists: extra?.namedLists ?? {} };
}

const WUBRG = ["W", "U", "B", "R", "G"];

/** What each count reads: a set field, and the named list that says which of its values count. */
export const typeCountSpec: Record<TypeCountSort, { field: string; list?: string }> = {
  cardtypes: { field: "t", list: "card" },
  fronttypes: { field: "tFront", list: "card" },
  supertypes: { field: "t", list: "super" },
  subtypes: { field: "st" },
  creaturetypes: { field: "st", list: "creature" },
};

/** Per-row counts for ordering. null when the context cannot answer (no catalogue yet). */
export function rowCountsOf(ctx: EvalContext, which: TypeCountSort): Uint32Array | null {
  const spec = typeCountSpec[which];
  return rowCounts(ctx, spec.field, spec.list);
}

/** The context plus the every-creature-type flag, once the creature list is known. A context with no creature list is
 *  returned as it is: `everyCreatureType` then stays unknown and a question about it is cannot-answer. */
export function withEveryCreatureType(ctx: EvalContext, rows: readonly CoreRow[], vocab: CoreVocab): EvalContext {
  const list = ctx.namedLists["creature"]?.values;
  if (!list || list.length === 0) return ctx;
  const columns = new Map(ctx.columns);
  columns.set("everyCreatureType", buildEveryCreatureTypeView(vocab.subtypes, list, rows.map((r) => r.s)));
  return { ...ctx, columns };
}

type CharQuery = Pick<EventQuery, "colours" | "types" | "subtypes" | "keywords" | "cardColours"
  | "mvMin" | "mvMax" | "powMin" | "powMax" | "touMin" | "touMax"
  | "notTypes" | "notSubtypes" | "notKeywords" | "keepChangelings" | "orTypes" | "orSubtypes" | "orKeywords" | "fieldFilters"
  | "cardTypesMin" | "cardTypesMax" | "frontTypesMin" | "frontTypesMax" | "supertypesMin" | "supertypesMax"
  | "subtypeCountMin" | "subtypeCountMax" | "creatureTypesMin" | "creatureTypesMax">;

export interface CompileOptions {
  /** The tables the row codes name. With them, a NOT term naming a word the table does not know matches NOTHING,
   *  because a not-yet-loaded table would otherwise let every card through. */
  vocab?: CoreVocab;
  /** The creature types (the catalogue's `creature` list): the subtypes `keepChangelings` is about. */
  creatureTypes?: ReadonlySet<string>;
}

/** The catalogue rows as nodes: must and never per value, one OR group per field for its any-of values, a range per
 *  number filter. Whether a field exists is the evaluator's to say (cannot-answer), never this function's. */
export function fieldNodes(filters: readonly FieldFilter[]): Node[] {
  const out: Node[] = [];
  const any = new Map<string, Node[]>();
  for (const f of filters) {
    if (f.op === "range") out.push({ field: f.field, op: "cmp", ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) });
    else if (f.op === "must") out.push({ field: f.field, op: "has", value: f.value });
    else if (f.op === "not") out.push({ not: { field: f.field, op: "has", value: f.value } });
    else (any.get(f.field) ?? any.set(f.field, []).get(f.field)!).push({ field: f.field, op: "has", value: f.value });
  }
  for (const group of any.values()) out.push({ or: group });
  return out;
}

/** The characteristic half of an EventQuery as an AST, matching `compileCharacteristics` + `coloursFit`:
 *  identity `within` (cards) or `exactly` (commanders), `C` = colourless only on both; card colours "at
 *  least these", `C` exclusive. Event and effect terms are not here: they join as `rows` leaves. */
export function fromEventQuery(q: CharQuery, mode: PageMode, opts: CompileOptions = {}): Node {
  const and: Node[] = [];
  if (q.colours.length > 0) {
    if (q.colours.includes("C")) and.push({ field: "id", op: "exactly", value: [] });
    else and.push({ field: "id", op: mode === "commanders" ? "exactly" : "within", value: q.colours });
  }
  for (const v of q.types) and.push({ field: "t", op: "has", value: v });
  for (const v of q.subtypes) and.push({ field: "st", op: "has", value: v });
  for (const v of q.keywords) and.push({ field: "k", op: "has", value: v });
  const never: Node = { op: "rows", rows: [] };
  const negate = (field: string, table: readonly string[] | undefined, v: string, keepEvery: boolean): Node => {
    if (table && !table.includes(v)) return never;
    const has: Node = { field, op: "has", value: v };
    return keepEvery
      ? { or: [{ not: has }, { field: "everyCreatureType", op: "has", value: "true" }] }
      : { not: has };
  };
  for (const v of q.notTypes ?? []) and.push(negate("t", opts.vocab?.types, v, false));
  for (const v of q.notSubtypes ?? []) {
    and.push(negate("st", opts.vocab?.subtypes, v, q.keepChangelings === true && opts.creatureTypes?.has(v) === true));
  }
  for (const v of q.notKeywords ?? []) and.push(negate("k", opts.vocab?.keywords, v, false));
  // ANY OF, ONE GROUP PER ROW: at least one of the row's any-of words, ANDed with everything else.
  for (const [field, words] of [["t", q.orTypes], ["st", q.orSubtypes], ["k", q.orKeywords]] as const) {
    if (words && words.length > 0) and.push({ or: words.map((value): Node => ({ field, op: "has", value })) });
  }
  and.push(...fieldNodes(q.fieldFilters ?? []));
  if (q.cardColours.length > 0) {
    if (q.cardColours.includes("C")) and.push({ field: "c", op: "count", max: 0 });
    else for (const v of q.cardColours) if (WUBRG.includes(v)) and.push({ field: "c", op: "has", value: v });
    // An unknown letter alone asks nothing, as before; but an artifact without `c` still cannot answer.
    if (!and.some((n) => "field" in n && n.field === "c")) and.push({ field: "c", op: "count", min: 0 });
  }
  for (const [field, min, max] of [["mv", q.mvMin, q.mvMax], ["pow", q.powMin, q.powMax], ["tou", q.touMin, q.touMax]] as const) {
    if (min === undefined && max === undefined) continue;
    and.push({ field, op: "cmp", ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
  }
  for (const c of TYPE_COUNTS) {
    const min = q[c.min]; const max = q[c.max];
    if (min === undefined && max === undefined) continue;
    const spec = typeCountSpec[c.sort];
    const bounds = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    and.push(spec.list === undefined ? { field: spec.field, op: "count", ...bounds } : { field: spec.field, op: "countIn", list: spec.list, ...bounds });
  }
  return { and };
}

/** Evaluate the characteristics (and, on the commanders page, the commander toggle) over the rows. */
export function evaluateEventQuery(
  rows: readonly CoreRow[], vocab: CoreVocab, q: CharQuery, mode: PageMode,
  opts: { commandersOnly?: boolean; context?: EvalContext } = {},
): EvalResult {
  const ctx = opts.context ?? coreContext(rows, vocab);
  const creature = ctx.namedLists["creature"]?.values;
  const node = fromEventQuery(q, mode, { vocab, ...(creature ? { creatureTypes: new Set(creature) } : {}) });
  if (!opts.commandersOnly) return evaluate(node, ctx);
  const commanders = rows.flatMap((r, i) => (r.commander ? [i] : []));
  return evaluate({ and: [{ op: "rows", rows: commanders }, node] }, ctx);
}
