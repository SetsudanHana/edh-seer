// Loads the search catalogue and its group files on demand (#1782). The core fields come from rows the
// page already holds; everything here is for the fields they cannot answer.
import { decodeGroup, type Catalogue, type GroupPayload } from "./catalogue.js";
import type { EvalContext, Node } from "./evaluate.js";
import type { Column } from "./walk.js";

export interface SearchLoader {
  /** null when the manifest has no `search` pointer or anything failed: the catalogue-only fields stay unanswerable. */
  catalogue(): Promise<Catalogue | null>;
  /** Fetches only the group files holding these fields (each once) and decodes them. */
  columnsFor(fields: readonly string[]): Promise<Column[]>;
}

/** Fields the page answers from name-index rows alone. */
export const CORE_FIELDS: ReadonlySet<string> = new Set(["t", "st", "k", "mv", "pow", "tou", "id", "c"]);

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
  const getJson = async <T,>(url: string): Promise<T | null> => {
    const res = await fetchImpl(url);
    return res.ok ? await res.json() as T : null;
  };
  let pinned: string | null = null;
  const resolve = async (): Promise<{ dir: string; catalogue: Catalogue } | null> => {
    try {
      // THE FIRST SUCCESSFUL MANIFEST READ PINS THE ARTIFACT for this loader: the rows the page holds belong to it.
      if (pinned !== null && bases.has(pinned)) return bases.get(pinned)!;
      const m = await getJson<{ version?: string; search?: string }>(`${baseUrl}/manifest.json`);
      if (!m?.version || !m.search) return null;
      const dir = `${baseUrl}/${m.version}/search/${m.search}`;
      const hit = bases.get(dir);
      if (hit) { pinned = dir; return hit; }
      const catalogue = await getJson<Catalogue>(`${dir}/catalogue.json`);
      if (!catalogue) return null;
      const made = { dir, catalogue };
      bases.set(dir, made);
      pinned = dir;
      return made;
    } catch {
      return null;
    }
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
          const made: Promise<Column[]> = (async () => {
            try {
              const payload = await getJson<GroupPayload>(key);
              if (!payload) { groups.delete(key); return []; }
              return decodeGroup(g, payload);
            } catch {
              groups.delete(key);
              return [];
            }
          })();
          groups.set(key, made);
          p = made;
        }
        out.push(...await p);
      }
      return out;
    },
  };
}

/** The context to evaluate `node` in: the core one, plus whatever the catalogue supplies for fields the core
 *  lacks. Never fetches for a query that names core fields only. When the catalogue is missing the context is
 *  returned unchanged, so those fields answer cannot-answer. */
export async function withCatalogue(core: EvalContext, loader: SearchLoader, node: Node): Promise<EvalContext> {
  if (!needsCatalogue(node)) return core;
  const need = fieldsOf(node).filter((f) => !CORE_FIELDS.has(f));
  const cat = await loader.catalogue();
  if (!cat) return core;
  const columns = new Map(core.columns);
  for (const c of await loader.columnsFor(need)) if (!columns.has(c.path)) columns.set(c.path, c);
  return { rowCount: core.rowCount, columns, namedLists: { ...cat.namedLists, ...core.namedLists } };
}
