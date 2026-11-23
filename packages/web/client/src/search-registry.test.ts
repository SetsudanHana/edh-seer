import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_DENY, type SearchRegistry } from "./lib/search/registry.js";

const ROOT = join(import.meta.dirname, "../../../..");
const registry = JSON.parse(readFileSync(join(import.meta.dirname, "../../scripts/search-registry.json"), "utf8")) as SearchRegistry;
const rules = join(ROOT, "rules/MagicCompRules.txt");

test("the registry owns only the read state in this slice: grammar and card.* are not walked", () => {
  expect(Object.keys(registry.groups).sort()).toEqual(["faces", "read", "types"]);
  expect(registry.groups["read"]).toEqual(["tags.clauseSource"]);
  expect(registry.groups["types"]).toEqual([]);
  expect(registry.deny).toEqual(expect.arrayContaining([...DEFAULT_DENY]));
});

test("budgets are gzip bytes for read and the catalogue", () => {
  expect(registry.budgets).toEqual({ read: 50_000, faces: 20_000, catalogue: 100_000 });
});

test("creature and land are named, with values supplied at build time", () => {
  for (const n of ["creature", "land"]) expect(registry.namedLists[n]).toMatchObject({ field: "st", values: [] });
});

/** The words of one rule: "205.2a The card types are a, b, and c. See ..." -> [a, b, c]. */
function words(rule: string, lead: RegExp): string[] {
  const line = readFileSync(rules, "latin1").split("\n").find((l) => l.startsWith(rule + " "));
  if (!line) throw new Error(`rule ${rule} not found`);
  const m = lead.exec(line);
  if (!m) throw new Error(`rule ${rule} has another shape: ${line}`);
  return m[1]!.replace(/,? and /, ", ").split(", ").map((w) => w.trim());
}

test.skipIf(!existsSync(rules))("card and super match CR 205.2a / 205.4a, whose titles are Card Types / Supertypes", () => {
  const text = readFileSync(rules, "latin1");
  expect(text).toMatch(/^205\.2\. Card Types/m);
  expect(text).toMatch(/^205\.4\. Supertypes/m);
  expect(registry.namedLists["card"]!.values).toEqual(words("205.2a", /The card types are ([^.]+)\./));
  expect(registry.namedLists["super"]!.values).toEqual(words("205.4a", /The supertypes are ([^.]+)\./));
});
test.skipIf(existsSync(rules))("CR check skipped: rules/MagicCompRules.txt absent (npx tsx research/rules/fetch-comprehensive-rules.ts)", () => {
  expect(true).toBe(true);
});

test("`read` says itself in player words, one label per value the build can produce (#1782)", () => {
  expect(registry.fields["read"]).toEqual({
    label: "Our reading",
    valueLabels: { grammar: "read by our rules", model: "read by the model", unread: "not read yet", "no-record": "no record" },
  });
});
