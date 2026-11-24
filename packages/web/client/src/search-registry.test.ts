import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DEFAULT_DENY, type SearchRegistry } from "./lib/search/registry.js";

const ROOT = join(import.meta.dirname, "../../../..");
const registry = JSON.parse(readFileSync(join(import.meta.dirname, "../../scripts/search-registry.json"), "utf8")) as SearchRegistry;
const rules = join(ROOT, "rules/MagicCompRules.txt");

test("the registry owns the read state and the distinct-type payoff fields: the rest of the grammar and card.* are not walked", () => {
  expect(Object.keys(registry.groups).sort()).toEqual(["faces", "payoffs", "read", "types"]);
  expect(registry.groups["read"]).toEqual(["tags.clauseSource"]);
  // #1785: only the unit a distinct-type payoff counts, never the whole ability tree (that is #1784's).
  expect(registry.groups["payoffs"]).toEqual(["tags.abilities.effect.distinctCount.counts", "tags.abilities.thresholdDistinct.counts"]);
  expect(registry.groups["types"]).toEqual([]);
  expect(registry.deny).toEqual(expect.arrayContaining([...DEFAULT_DENY]));
});

test("budgets are gzip bytes for read, faces, payoffs and the catalogue", () => {
  expect(registry.budgets).toEqual({ read: 50_000, faces: 20_000, catalogue: 100_000, payoffs: 4_000 });
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
    description: "Whether our own rules could read the card's text, a language model read it, or nobody has yet.",
    valueLabels: { grammar: "read by our rules", model: "read by the model", unread: "not read yet", "no-record": "no record" },
  });
});

test("`cares` is computed from the two distinct-type paths, and a source path is always one the payoffs group owns (#1785)", () => {
  const owned = registry.groups["payoffs"]!;
  for (const [value, pairs] of Object.entries(registry.derivedSets!["cares"]!.values)) {
    expect(pairs.length, value).toBe(2);
    for (const pair of pairs) expect(owned, pair).toContain(pair.slice(0, pair.lastIndexOf("=")));
  }
  expect(registry.derivedSets!["cares"]!.group).toBe("payoffs");
  expect(Object.keys(registry.fields["cares"]!.valueLabels!).sort()).toEqual(Object.keys(registry.derivedSets!["cares"]!.values).sort());
});
