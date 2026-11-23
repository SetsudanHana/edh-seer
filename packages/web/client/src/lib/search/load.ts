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

export function createSearchLoader(baseUrl: string, fetchImpl: typeof fetch = fetch): SearchLoader {
  let base: Promise<{ dir: string; catalogue: Catalogue } | null> | null = null;
  const groups = new Map<string, Promise<Column[]>>();
  const getJson = async <T,>(url: string): Promise<T | null> => {
    const res = await fetchImpl(url);
    return res.ok ? await res.json() as T : null;
  };
  const resolve = () => (base ??= (async () => {
    try {
      const m = await getJson<{ version?: string; search?: string }>(`${baseUrl}/manifest.json`);
      if (!m?.version || !m.search) return null;
      const dir = `${baseUrl}/${m.version}/search/${m.search}`;
      const catalogue = await getJson<Catalogue>(`${dir}/catalogue.json`);
      return catalogue ? { dir, catalogue } : null;
    } catch {
      return null;
    }
  })());
  return {
    catalogue: async () => (await resolve())?.catalogue ?? null,
    async columnsFor(fields) {
      const b = await resolve();
      if (!b) return [];
      const out: Column[] = [];
      for (const [name, g] of Object.entries(b.catalogue.groups)) {
        if (!g.file || !g.fields.some((f) => fields.includes(f.id))) continue;
        const file = g.file;
        let p = groups.get(name);
        if (!p) {
          p = (async () => {
            try {
              const payload = await getJson<GroupPayload>(`${b.dir}/${file}`);
              return payload ? decodeGroup(g, payload) : [];
            } catch {
              return [];
            }
          })();
          groups.set(name, p);
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
  const need = fieldsOf(node).filter((f) => !CORE_FIELDS.has(f));
  const listed = JSON.stringify(node).includes('"countIn"');
  if (need.length === 0 && !listed) return core;
  const cat = await loader.catalogue();
  if (!cat) return core;
  const columns = new Map(core.columns);
  for (const c of await loader.columnsFor(need)) if (!columns.has(c.path)) columns.set(c.path, c);
  return { rowCount: core.rowCount, columns, namedLists: { ...cat.namedLists, ...core.namedLists } };
}
