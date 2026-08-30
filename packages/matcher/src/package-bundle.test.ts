import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, expect, test } from "vitest";

/** DO THE PACKAGE SUBPATHS BUNDLE FOR A BROWSER? — the sibling of `browser-bundle.test.ts`.
 *
 *  That test points at a FILE (`analyze.ts`) and passes at zero offenders. This one points at the
 *  PACKAGE SPECIFIERS a client actually writes, which is a different question and was never asked:
 *  measured 2026-08-30, importing `@edh-seer/matcher` and `@edh-seer/data` by their BARRELS pulls
 *  31 browser-hostile modules (mongodb x24 through `data/db.ts`, plus `data/scratch.ts`,
 *  `data/scryfall.ts`, `data/spellbook.ts`, and four `@edh-seer/tagger` modules the matcher barrel
 *  drags). A file passing is not its package passing. */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const MIN_BUNDLE_BYTES = 200_000;

const dir = mkdtempSync(join(tmpdir(), "edh-seer-pkg-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("the browser-safe subpaths of @edh-seer/data and @edh-seer/matcher bundle with no Node-only modules", async () => {
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, [
    `import { resolveNames } from "@edh-seer/data/resolve";`,
    `import { normalizeName } from "@edh-seer/data/names";`,
    `import { docToCard } from "@edh-seer/data/docs";`,
    `import { detectCommanders } from "@edh-seer/data/commander";`,
    `import { parseDecklistText } from "@edh-seer/data/decklist";`,
    `import { parseDecklistSections } from "@edh-seer/data/sections";`,
    `import { analyzeDeckStructured } from "@edh-seer/matcher/analyze";`,
    `import { projectDeckGraph } from "@edh-seer/matcher/graph-projection";`,
    `import { faceDeckCards } from "@edh-seer/matcher/faces";`,
    `import { buildDeckCards } from "@edh-seer/matcher/deck-cards";`,
    `import { attachRolesAndArt } from "@edh-seer/matcher/wire-graph";`,
    `import { StaticLookup } from "@edh-seer/matcher/static-lookup";`,
    `export { resolveNames, normalizeName, docToCard, detectCommanders, parseDecklistText,`,
    `  parseDecklistSections, analyzeDeckStructured, projectDeckGraph, faceDeckCards, buildDeckCards,`,
    `  attachRolesAndArt, StaticLookup };`,
  ].join("\n"));

  // ponytail: the entry lives outside the repo tree on purpose (it stands in for a real
  // consumer's own project), so esbuild's node_modules directory-walk from the entry's own
  // location never finds one — verified with `esbuild --log-level=verbose`, which shows the
  // walk starting at the entry's directory and `absWorkingDir` playing no part in it. `nodePaths`
  // is esbuild's own answer to exactly this case; it does not relax what the test checks.
  const result = await build({
    entryPoints: [entry], bundle: true, platform: "browser", format: "esm",
    write: false, logLevel: "silent", absWorkingDir: ROOT, nodePaths: [join(ROOT, "node_modules")],
  }).then(
    (r) => ({ errors: [] as { location?: { file?: string } | null }[], bytes: r.outputFiles[0]?.contents.byteLength ?? 0 }),
    (e: { errors?: { location?: { file?: string } | null }[] }) => ({ errors: e.errors ?? [], bytes: 0 }),
  );

  const offenders = [...new Set(
    result.errors.map((e) => e.location?.file).filter((f): f is string => typeof f === "string"),
  )].sort();

  expect(offenders).toEqual([]);
  expect(result.bytes).toBeGreaterThan(MIN_BUNDLE_BYTES);
});
