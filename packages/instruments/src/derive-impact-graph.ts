/** THE IMPORT GRAPH of the pair / role code, so `derive-impact` can say which changed files that code actually runs (#1410). Pure over a reader: the bin supplies the file system.
 *  Only VALUE imports are followed (`import type` is erased). An import of NAMES from a barrel (a file that re-exports) follows only the re-exports of those names,
 *  so a matcher module that takes `extractCharacteristics` from `@edh-seer/tagger` pulls in `characteristics.ts`, not the whole tagger.
 *  CEILING: a name the barrel defines itself (not re-exports) is followed through the barrel's own imports only; a namespace, default or dynamic import follows everything. */
export interface ImportRef { spec: string; names: string[] | "all" }
export interface Reexports { named: Map<string, { spec: string }>; stars: string[] }

const nameList = (body: string): { local: string; exported: string }[] =>
  body.split(",").map((x) => x.trim()).filter((x) => x && !/^type\s/.test(x)).map((x) => {
    const [local, exported] = x.split(/\s+as\s+/);
    return { local: local!.trim(), exported: (exported ?? local)!.trim() };
  });

export function parseImports(src: string): ImportRef[] {
  const out: ImportRef[] = [];
  for (const m of src.matchAll(/^\s*import\s+(type\s+)?([^'";]*?)\s*from\s*["']([^"']+)["']/gm)) {
    if (m[1]) continue;
    const clause = m[2]!.trim();
    const brace = /^\{([^}]*)\}$/.exec(clause);
    out.push({ spec: m[3]!, names: brace ? nameList(brace[1]!).map((n) => n.local) : "all" });
  }
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push({ spec: m[1]!, names: "all" });
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) out.push({ spec: m[1]!, names: "all" });
  return out;
}

export function parseReexports(src: string): Reexports {
  const named = new Map<string, { spec: string }>(), stars: string[] = [];
  for (const m of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    if (m[1]) continue;
    for (const n of nameList(m[2]!)) named.set(n.exported, { spec: m[3]! });
  }
  for (const m of src.matchAll(/export\s+\*\s+(?:as\s+\w+\s+)?from\s*["']([^"']+)["']/g)) stars.push(m[1]!);
  return { named, stars };
}

/** Every file reachable from `entries`. `read` returns a file's source (undefined: not a source file); `resolve` maps (importing file, specifier) to a file, or undefined for a package outside the repo. */
export function reach(entries: string[], read: (file: string) => string | undefined, resolve: (from: string, spec: string) => string | undefined): Set<string> {
  const seen = new Map<string, "all" | Set<string>>();
  const visit = (file: string, names: string[] | "all"): void => {
    const have = seen.get(file);
    if (have === "all") return;
    let fresh: string[] | "all";
    if (names === "all") { seen.set(file, "all"); fresh = "all"; }
    else {
      const set = have ?? new Set<string>();
      fresh = names.filter((n) => !set.has(n));
      if (have && fresh.length === 0) return;
      fresh.forEach((n) => set.add(n));
      seen.set(file, set);
    }
    const src = read(file);
    if (src === undefined) return;
    if (!have) for (const imp of parseImports(src)) { const t = resolve(file, imp.spec); if (t) visit(t, imp.names); }
    const re = parseReexports(src);
    if (fresh === "all") { for (const { spec } of re.named.values()) { const t = resolve(file, spec); if (t) visit(t, "all"); } }
    else for (const n of fresh) { const r = re.named.get(n); const t = r && resolve(file, r.spec); if (t) visit(t, "all"); }
    for (const spec of re.stars) { const t = resolve(file, spec); if (t) visit(t, fresh); }
  };
  for (const e of entries) visit(e, "all");
  return new Set(seen.keys());
}
