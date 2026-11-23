// Loads the search catalogue and its group files on demand (#1782). The core fields come from rows the
// page already holds; everything here is for the fields they cannot answer.
import { decodeGroup, type Catalogue, type GroupPayload } from "./catalogue.js";
import type { EvalContext, Node } from "./evaluate.js";
import type { Column } from "./walk.js";

export interface SearchLoader {
  /** null = the manifest has no `search` pointer (this build has no catalogue). REJECTS when a read failed, which is
   *  a different thing and may be retried. */
  catalogue(): Promise<Catalogue | null>;
  /** Fetches only the group files holding these fields (each once) and decodes them. Rejects when one failed. */
  columnsFor(fields: readonly string[]): Promise<Column[]>;
}

/** Fields the page answers from name-index rows alone. */
export const CORE_FIELDS: ReadonlySet<string> = new Set(["t", "st", "k", "mv", "pow", "tou", "id", "c"]);

/** Fields a bespoke row already covers (the core views, the front-face types and the changeling flag): the generic menu
 *  does not offer them a second time. */
export const BESPOKE_FIELDS: ReadonlySet<string> = new Set([...CORE_FIELDS, "tFront", "stBest", "everyCreatureType"]);

export function fieldsOf(node: Node, out: Set<string> = new Set()): string[] {
  if ("and" in node) node.and.forEach((n) => fieldsOf(n, out));
  else if ("or" in node) node.or.forEach((n) => fieldsOf(n, out));
  else if ("not" in node) fieldsOf(node.not, out);
  else if ("field" in node) out.add(node.field);
  return [...out];
}

/** Does this tree need anything the page's own rows cannot give: a catalogue field, or a named list? An op walk,
 *  never a search of the serialised tree (a value spelling "countIn" is not a list question). */
export function needsCatalogue(node: Node): boolean {
  if ("and" in node) return node.and.some(needsCatalogue);
  if ("or" in node) return node.or.some(needsCatalogue);
  if ("not" in node) return needsCatalogue(node.not);
  if (!("field" in node)) return false;
  return node.op === "countIn" || !CORE_FIELDS.has(node.field);
}

/** A FAILURE IS NEVER CACHED: only a successful read is remembered, so a dropped connection costs one query and the
 *  next one retries. What is remembered is keyed by the manifest's `search` directory (the artifact's own name), so
 *  the groups of one artifact are never read as another's. */
export function createSearchLoader(baseUrl: string, fetchImpl: typeof fetch = fetch): SearchLoader {
  const bases = new Map<string, { dir: string; catalogue: Catalogue }>();
  const groups = new Map<string, Promise<Column[]>>();
  /** A body, or a THROW: a read that failed is never mistaken for a build that has nothing to read. */
  const getJson = async <T,>(url: string): Promise<T> => {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`${url}: ${res.status ?? "failed"}`);
    return await res.json() as T;
  };
  let pinned: string | null = null;
  const resolve = async (): Promise<{ dir: string; catalogue: Catalogue } | null> => {
    // THE FIRST SUCCESSFUL MANIFEST READ PINS THE ARTIFACT for this loader: the rows the page holds belong to it.
    if (pinned !== null && bases.has(pinned)) return bases.get(pinned)!;
    const m = await getJson<{ version?: string; search?: string }>(`${baseUrl}/manifest.json`);
    if (!m.version || !m.search) return null;
    const dir = `${baseUrl}/${m.version}/search/${m.search}`;
    const hit = bases.get(dir);
    if (hit) { pinned = dir; return hit; }
    const catalogue = await getJson<Catalogue>(`${dir}/catalogue.json`);
    const made = { dir, catalogue };
    bases.set(dir, made);
    pinned = dir;
    return made;
  };
  return {
    catalogue: async () => (await resolve())?.catalogue ?? null,
    async columnsFor(fields) {
      const b = await resolve();
      if (!b) return [];
      const out: Column[] = [];
      for (const g of Object.values(b.catalogue.groups)) {
        if (!g.file || !g.fields.some((f) => fields.includes(f.id))) continue;
        const key = `${b.dir}/${g.file}`;
        let p = groups.get(key);
        if (!p) {
          const made: Promise<Column[]> = getJson<GroupPayload>(key).then((payload) => decodeGroup(g, payload));
          // A FAILED READ LEAVES NOTHING BEHIND: the next question asks again.
          made.catch(() => { if (groups.get(key) === made) groups.delete(key); });
          groups.set(key, made);
          p = made;
        }
        out.push(...await p);
      }
      return out;
    },
  };
}

function listsOf(node: Node, out: Set<string> = new Set()): string[] {
  if ("and" in node) node.and.forEach((n) => listsOf(n, out));
  else if ("or" in node) node.or.forEach((n) => listsOf(n, out));
  else if ("not" in node) listsOf(node.not, out);
  else if ("field" in node && node.op === "countIn") out.add(node.list);
  return [...out];
}

export type CatalogueResolution = {
  /** ready: everything the question needs is in `ctx`. no-pointer: this build has no catalogue. failed: a read failed
   *  (retry). incomplete: the catalogue loaded but does not supply a field or list the question names. */
  state: "ready" | "no-pointer" | "failed" | "incomplete";
  ctx: EvalContext;
};

/** The context to evaluate `node` in: the core one, plus whatever the catalogue supplies for fields the core lacks.
 *  Never fetches for a query that names core fields only. `ready` ONLY when every field the question names is a
 *  column and every named list is present: "the catalogue loaded" is not "what I need loaded". */
export async function resolveCatalogue(core: EvalContext, loader: SearchLoader, node: Node): Promise<CatalogueResolution> {
  if (!needsCatalogue(node)) return { state: "ready", ctx: core };
  const need = fieldsOf(node).filter((f) => !CORE_FIELDS.has(f));
  const lists = listsOf(node);
  let cat: Catalogue | null;
  try {
    cat = await loader.catalogue();
  } catch {
    return { state: "failed", ctx: core };
  }
  if (!cat) return { state: "no-pointer", ctx: core };
  const columns = new Map(core.columns);
  let failed = false;
  try {
    for (const c of await loader.columnsFor(need)) if (!columns.has(c.path)) columns.set(c.path, c);
  } catch {
    failed = true;
  }
  const ctx: EvalContext = { rowCount: core.rowCount, columns, namedLists: { ...cat.namedLists, ...core.namedLists } };
  if (failed) return { state: "failed", ctx };
  const complete = need.every((f) => columns.has(f)) && lists.every((l) => l in ctx.namedLists);
  return { state: complete ? "ready" : "incomplete", ctx };
}

/** `resolveCatalogue`'s context alone: what cannot be supplied stays unknown, so it answers cannot-answer. */
export async function withCatalogue(core: EvalContext, loader: SearchLoader, node: Node): Promise<EvalContext> {
  return (await resolveCatalogue(core, loader, node)).ctx;
}
