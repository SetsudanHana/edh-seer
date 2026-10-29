import { describe, expect, it } from "vitest";
import { parseImports, parseReexports, reach } from "./derive-impact-graph.js";

describe("parseImports / parseReexports", () => {
  it("reads value imports with their names and skips type imports", () => {
    const src = `import type { A } from "./a.js";\nimport { b, type C, d as e } from "./b.js";\nimport * as ns from "./ns.js";\nimport "./side.js";\nconst x = await import("./dyn.js");\nimport rules from "./rules.json" with { type: "json" };`;
    expect(parseImports(src)).toEqual([
      { spec: "./b.js", names: ["b", "d"] }, { spec: "./ns.js", names: "all" }, { spec: "./rules.json", names: "all" }, { spec: "./side.js", names: "all" }, { spec: "./dyn.js", names: "all" },
    ]);
  });
  it("reads named and star re-exports", () => {
    const r = parseReexports(`export { x, y as z, type T } from "./m.js";\nexport * from "./star.js";\nexport type { U } from "./u.js";`);
    expect([...r.named]).toEqual([["x", { spec: "./m.js" }], ["z", { spec: "./m.js" }]]);
    expect(r.stars).toEqual(["./star.js"]);
  });
});

describe("reach", () => {
  const files: Record<string, string> = {
    "edges.ts": `import { f } from "pkg";\nimport { g } from "./util.ts";`,
    "util.ts": `import type { T } from "./types.ts";\nexport const g = 1;`,
    "pkg/index.ts": `export { f } from "./f.ts";\nexport { h } from "./h.ts";`,
    "pkg/f.ts": `import { deep } from "./deep.ts";`,
    "pkg/h.ts": `export const h = 1;`,
    "pkg/deep.ts": ``,
    "types.ts": ``,
  };
  const resolve = (from: string, spec: string): string | undefined => {
    if (spec === "pkg") return "pkg/index.ts";
    if (!spec.startsWith(".")) return undefined;
    const dir = from.includes("/") ? from.slice(0, from.lastIndexOf("/") + 1) : "";
    const t = dir + spec.replace(/^\.\//, "");
    return t in files ? t : undefined;
  };
  it("follows value imports, only the named re-exports of a barrel, and not type imports", () => {
    const r = reach(["edges.ts"], (f) => files[f], resolve);
    expect([...r].sort()).toEqual(["edges.ts", "pkg/deep.ts", "pkg/f.ts", "pkg/index.ts", "util.ts"]);
    expect(r.has("pkg/h.ts")).toBe(false);
    expect(r.has("types.ts")).toBe(false);
  });
  it("follows a whole barrel for a namespace import", () => {
    const r = reach(["a.ts"], (f) => (f === "a.ts" ? `import * as p from "pkg";` : files[f]), resolve);
    expect(r.has("pkg/h.ts")).toBe(true);
  });
});
