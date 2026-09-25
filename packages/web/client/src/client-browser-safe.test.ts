import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** THE GUARD THAT REPLACES WHAT THE TSCONFIG GAVE UP.
 *
 *  `client/tsconfig.json` carries `"node"` in its `types` so that the type-only imports of the
 *  `@edh-seer/engine` and `@edh-seer/matcher` barrels — raw TypeScript, not built declarations —
 *  stop reporting 32 errors about `node:fs` that say nothing about this package. The cost is that
 *  `process`, `Buffer` and `node:fs` now typecheck INSIDE client code, where they crash a browser.
 *
 *  This is the narrower, honest check: a grep over the files that actually ship. It does NOT claim
 *  to catch the 2026-08-21 regression (a value import of `GRAVEYARD_HATE_SHARE` from
 *  `@edh-seer/matcher/src/answer-coverage.js`) — that one typechecked perfectly with or without
 *  node types and is a different rule about barrels, not about builtins. */
/** IT LIVED IN THE SERVER SUITE until the server was removed (2026-09-25), on the belief that only a
 *  Node environment could walk the filesystem. `import.meta.dirname` works under the client's jsdom
 *  config too (`csp.test.ts` and `inject.test.ts` read files the same way), so it now sits beside
 *  the code it guards. It is a test file, so it is not in the walk below. */
const CLIENT_SRC = import.meta.dirname;

/** The same two entries `tsconfig.json` excludes, and for the same reason: node scripts that live
 *  under `src/` only so they can reach the modules they measure by relative path. A THIRD entry
 *  means it is time for a suffix convention rather than a list — the exclusion is duplicated here
 *  rather than parsed out of the tsconfig, because a guard that reads its own exemptions from the
 *  file it guards can be switched off by editing that file alone. */
const NOT_SHIPPED = (rel: string): boolean =>
  rel.endsWith(".harness.ts") || rel === "fixtures/capture.ts" || rel.endsWith(".test.ts") || rel.endsWith(".test.tsx");

function sources(dir: string, base = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name), rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) return sources(full, rel);
    return /\.tsx?$/.test(name) && !NOT_SHIPPED(rel) ? [rel] : [];
  });
}

// `process.env` is deliberately NOT here: Vite REPLACES it at build time, so it is one of the few
// Node-shaped names that really does work in the bundle. Bare `process.` is what breaks.
const NODE_ONLY = /\bfrom\s+["']node:|\brequire\(["']node:|\bprocess\.(?!env\b)|\bBuffer\b|\b__dirname\b|\b__filename\b/;

test("nothing that ships to the browser reaches for a Node builtin", () => {
  const files = sources(CLIENT_SRC);
  // The walk itself is load-bearing: an empty list would pass this test while checking nothing.
  expect(files.length).toBeGreaterThan(20);
  const offenders = files.filter((rel) => NODE_ONLY.test(readFileSync(join(CLIENT_SRC, rel), "utf8")));
  expect(offenders).toEqual([]);
});
