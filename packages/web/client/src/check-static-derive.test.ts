import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DERIVE_SOURCE, parseDeriveVersion } from "../../scripts/check-static-derive.mjs";

const ROOT = join(import.meta.dirname, "../../../..");

test("the deploy guard parses the REAL derive.ts to the number the tagger exports", async () => {
  const { DERIVE_VERSION } = await import("../../../tagger/src/derive/derive.js");
  const parsed = parseDeriveVersion(readFileSync(join(ROOT, DERIVE_SOURCE), "utf8"));
  expect(parsed).toBe(DERIVE_VERSION);
});
test("a source line of another shape parses to undefined, never NaN", () => {
  expect(parseDeriveVersion("export const DERIVE_VERSION = 12 + 1;")).toBeUndefined();
  expect(parseDeriveVersion("export const DERIVE_VERSION = 335;\n")).toBe(335);
});

// ---- the search pointer guard (#1781) ----
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { staticSearchProblem } from "../../scripts/check-static-derive.mjs";

function fakeRepo(manifest: object | null, search?: { dir: string; catalogue?: object }): string {
  const root = mkdtempSync(join(tmpdir(), "search-guard-"));
  mkdirSync(join(root, "static-out"), { recursive: true });
  if (manifest) writeFileSync(join(root, "static-out", "manifest.json"), JSON.stringify(manifest));
  if (search) {
    const dir = join(root, "static-out", "v-1", "search", search.dir);
    mkdirSync(dir, { recursive: true });
    if (search.catalogue) writeFileSync(join(dir, "catalogue.json"), JSON.stringify(search.catalogue));
  }
  return root;
}
const stamp = { version: "v-1", deriveVersion: 7 };

test("search guard: a manifest with no search pointer is refused", () => {
  expect(staticSearchProblem(fakeRepo(stamp))).toMatch(/no `search`/);
});
test("search guard: a missing directory or catalogue is refused", () => {
  expect(staticSearchProblem(fakeRepo({ ...stamp, search: "s-a" }))).toMatch(/s-a/);
  expect(staticSearchProblem(fakeRepo({ ...stamp, search: "s-a" }, { dir: "s-a" }))).toMatch(/catalogue\.json/);
});
test("search guard: a version or deriveVersion mismatch is refused", () => {
  const cat = { ...stamp };
  expect(staticSearchProblem(fakeRepo({ ...stamp, search: "s-a" }, { dir: "s-a", catalogue: { ...cat, version: "v-0" } }))).toMatch(/version/);
  expect(staticSearchProblem(fakeRepo({ ...stamp, search: "s-a" }, { dir: "s-a", catalogue: { ...cat, deriveVersion: 6 } }))).toMatch(/deriveVersion/);
});
test("search guard: a matching pointer passes, and a missing manifest is refused", () => {
  expect(staticSearchProblem(fakeRepo({ ...stamp, search: "s-a" }, { dir: "s-a", catalogue: stamp }))).toBeNull();
  expect(staticSearchProblem(fakeRepo(null))).toMatch(/manifest/);
});
