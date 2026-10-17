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
