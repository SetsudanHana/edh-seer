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
/** IT LIVES IN THE SERVER SUITE, which is the only one in this package that runs in a NODE
 *  environment. Under the client's jsdom config `import.meta.url` is rewritten to an http URL and
 *  `fileURLToPath` throws — a guard that walks the filesystem cannot run inside the environment it
 *  is guarding.
 *
 *  `__dirname`, not `import.meta.url`, because the server tsconfig is `NodeNext` emitting CJS for
 *  `nest build` and rejects `import.meta` outright (TS1470). That this file uses the very name it
 *  forbids the client to use is the point: `__dirname` is correct in a CJS Node module and fatal in
 *  a browser bundle, which is the whole distinction being guarded. */
const CLIENT_SRC = join(__dirname, "../../client/src");

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
