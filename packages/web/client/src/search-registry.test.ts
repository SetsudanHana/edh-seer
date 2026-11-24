// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BUILD_CATEGORIES } from "@edh-seer/matcher/build";
import { POOL_CLASSES } from "@edh-seer/matcher";
import { DEFAULT_DENY, groupOf, isDenied, type SearchRegistry } from "./lib/search/registry.js";

const ROOT = join(import.meta.dirname, "../../../..");
const registry = JSON.parse(readFileSync(join(import.meta.dirname, "../../scripts/search-registry.json"), "utf8")) as SearchRegistry;
const rules = join(ROOT, "rules/MagicCompRules.txt");

test("the registry owns the read state, the grammar's paths, roles and the distinct-type payoff fields: card.* is not walked", () => {
  expect(Object.keys(registry.groups).sort()).toEqual(["abilities", "commander", "faces", "payoffs", "read", "roles", "types"]);
  expect(registry.groups["read"]).toEqual(["tags.clauseSource"]);
  // #1785: only the unit a distinct-type payoff counts. #1784's group owns the rest of `tags.abilities`, and the LONGER prefix wins (groupOf), so `payoffs` keeps these two paths and `cares` keeps working.
  expect(registry.groups["abilities"]).toEqual(["tags.abilities"]);
  expect(registry.groups["roles"]).toEqual([]);
  for (const path of registry.groups["payoffs"]!) expect(groupOf(path, registry), path).toBe("payoffs");
  expect(groupOf("tags.abilities.count.scalesWith.notSubtype", registry)).toBe("abilities");
  expect(registry.groups["payoffs"]).toEqual(["tags.abilities.effect.distinctCount.counts", "tags.abilities.thresholdDistinct.counts"]);
  expect(registry.groups["types"]).toEqual([]);
  expect(registry.deny).toEqual(expect.arrayContaining([...DEFAULT_DENY]));
});

test("budgets are gzip bytes for read, faces, payoffs, abilities, roles, commander, the ability rows and the catalogue", () => {
  expect(registry.budgets).toEqual({ read: 50_000, faces: 20_000, catalogue: 100_000, payoffs: 4_000, abilities: 550_000, roles: 30_000, commander: 4_000, abilityRows: 800_000 });
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
  // the two distinct-type counts read exactly the payoffs group's two paths; `one-type-count` (#1784) reads how many of ONE creature type, from the abilities group
  const { "one-type-count": oneType, ...distinct } = registry.derivedSets!["cares"]!.values;
  for (const [value, pairs] of Object.entries(distinct)) {
    expect(pairs.length, value).toBe(2);
    for (const pair of pairs) expect(owned, pair).toContain(pair.slice(0, pair.lastIndexOf("=")));
  }
  expect(oneType!.every((pair) => pair.endsWith("@creature") && groupOf(pair.slice(0, pair.indexOf("@")), registry) === "abilities")).toBe(true);
  expect(registry.derivedSets!["cares"]!.group).toBe("payoffs");
  expect(Object.keys(registry.fields["cares"]!.valueLabels!).sort()).toEqual(Object.keys(registry.derivedSets!["cares"]!.values).sort());
});

test("the grammar is searchable under `ab.` and every labelled path is a path of the grammar a player can name (#1784)", () => {
  expect(registry.pathAliases).toEqual({ "tags.abilities.": "ab." });
  expect(registry.abilityPrefixes).toEqual(["tags.abilities"]);
  const labelled = Object.entries(registry.fields).filter(([id]) => id.startsWith("tags.abilities."));
  expect(labelled.length).toBeGreaterThanOrEqual(20);
  for (const [id, e] of labelled) { expect(e.label, id).toBeTruthy(); expect(e.description, id).toBeTruthy(); }
  // free text is not a field: an oracle-text or cost phrase is not an enum, and there is no oracle-text search
  for (const path of ["tags.abilities.amount", "tags.abilities.cost", "tags.abilities.gate.text", "tags.abilities.payment.other", "tags.abilities.unless.cost"]) expect(isDenied(path, registry), path).toBe(true);
});

test("roles and answers are labelled for every category and class the wire formats hold, and nothing else (#1784)", () => {
  expect(Object.keys(registry.fields["r"]!.valueLabels!)).toEqual([...BUILD_CATEGORIES]);
  for (const id of ["a", "n"]) expect(Object.keys(registry.fields[id]!.valueLabels!)).toEqual([...POOL_CLASSES]);
});

test("each named query says what it is, in player words, for every value it can hold (#1784)", () => {
  for (const [id, def] of Object.entries(registry.derivedSets!)) {
    expect(Object.keys(registry.fields[id]!.valueLabels!).sort(), id).toEqual(Object.keys(def.values).sort());
    expect(registry.fields[id]!.description, id).toBeTruthy();
  }
  expect(Object.keys(registry.derivedSets!).sort()).toEqual(["cares", "counts", "grants"]);
});
