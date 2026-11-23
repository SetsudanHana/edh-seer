import { expect, test } from "vitest";
import { buildCatalogue } from "./catalogue.js";
import { decodePostings } from "./postings.js";
import { DEFAULT_DENY, type SearchRegistry } from "./registry.js";
import { walkRecords, type SetColumn, type WalkRecord } from "./walk.js";

const registry = (over: Partial<SearchRegistry> = {}): SearchRegistry => ({
  fields: {},
  groups: { read: ["tags"] },
  namedLists: {},
  deny: [...DEFAULT_DENY],
  ...over,
});

const rec = (row: number, tags: unknown, card: unknown = {}): WalkRecord => ({ row, card, tags });
const fixture = (): WalkRecord[] => [
  rec(
    0,
    {
      clauseSource: "grammar",
      characteristics: { power: "2", cmc: 3, token: false },
      abilities: [
        { kind: "triggered", emits: [{ verb: "dies" }, { verb: "sacrifice" }], amount: 2 },
        { kind: "static", emits: [{ verb: "dies" }], amount: 5 },
      ],
    },
    { edhrecRank: 12, q: [1], tags: { produces: ["tribe:human"], cares: [] } },
  ),
  rec(1, { clauseSource: "model", characteristics: { cmc: 1, token: true }, abilities: [] }),
  rec(2, null),
];

test("set, number and boolean leaves classify by shape; array indices collapse", () => {
  const { columns } = walkRecords(fixture(), registry());
  const verb = columns.get("tags.abilities.emits.verb") as SetColumn;
  expect(verb.kind).toBe("set");
  expect([...verb.values]).toEqual([["dies", [0]], ["sacrifice", [0]]]);
  expect(columns.get("tags.characteristics.token")).toMatchObject({ kind: "set" });
  const amount = columns.get("tags.abilities.amount");
  expect(amount).toEqual({ kind: "number", path: "tags.abilities.amount", group: "read", rows: [0], min: [2], max: [5] });
});

test("a card without a numeric value stays absent, never 0", () => {
  const { columns } = walkRecords(fixture(), registry());
  const cmc = columns.get("tags.characteristics.cmc");
  expect(cmc).toMatchObject({ kind: "number", rows: [0, 1], min: [3, 1], max: [3, 1] });
});

test("a string path above the threshold is dropped and reported with its distinct count", () => {
  const recs = Array.from({ length: 5 }, (_, i) => rec(i, { flavor: `text ${i}`, kind: i % 2 ? "a" : "b" }));
  const r = walkRecords(recs, registry({ threshold: 4 }));
  expect(r.columns.has("tags.flavor")).toBe(false);
  expect(r.dropped).toEqual([{ path: "tags.flavor", distinct: 5 }]);
  expect(r.columns.has("tags.kind")).toBe(true);
});

test("the deny list is honoured, including leaf wildcards", () => {
  const recs = fixture();
  (recs[0]!.tags as any).abilities[0].clause = 1;
  (recs[0]!.tags as any).abilities[0].grantedBy = "x";
  (recs[0]!.tags as any).model = "derived";
  const { columns } = walkRecords(recs, registry({ groups: { read: ["tags"], card: ["card"] } }));
  const ids = [...columns.keys()];
  for (const banned of ["card.q", "card.edhrecRank", "card.tags.produces", "card.tags.cares", "tags.model"]) {
    expect(ids).not.toContain(banned);
  }
  expect(ids.some((i) => i.endsWith(".clause") || i.endsWith(".grantedBy"))).toBe(false);
  expect(ids).toContain("tags.abilities.kind");
});

test("a per-field deny flag in the registry removes the field", () => {
  const { columns } = walkRecords(fixture(), registry({ fields: { "tags.clauseSource": { deny: true } } }));
  expect(columns.has("tags.clauseSource")).toBe(false);
});

test("paths outside every owned prefix are not walked", () => {
  const { columns } = walkRecords(fixture(), registry({ groups: { read: ["tags.characteristics"] } }));
  expect([...columns.keys()].every((k) => k.startsWith("tags.characteristics"))).toBe(true);
});

test("elasticity: a NEW enum path yields a catalogue field with no code or registry change", () => {
  const reg = registry();
  const before = buildCatalogue({ version: "v", deriveVersion: 1, registry: reg, walk: walkRecords(fixture(), reg) });
  const recs = fixture();
  (recs[1]!.tags as any).abilities.push({ kind: "static", newThing: "x" });
  const after = buildCatalogue({ version: "v", deriveVersion: 1, registry: reg, walk: walkRecords(recs, reg) });
  const ids = (c: typeof before) => c.catalogue.groups["read"]!.fields.map((f) => f.id);
  expect(ids(before)).not.toContain("tags.abilities.newThing");
  expect(ids(after)).toContain("tags.abilities.newThing");
  const f = after.catalogue.groups["read"]!.fields.find((x) => x.id === "tags.abilities.newThing")!;
  expect(f).toMatchObject({ kind: "set", label: "tags.abilities.newThing", values: [{ v: "x", n: 1 }] });
  expect(decodePostings((after.payloads["read"]!.fields["tags.abilities.newThing"] as any).values.x)).toEqual([1]);
});

test("catalogue carries stamps, counts and registry labels", () => {
  const reg = registry({ fields: { "tags.abilities.kind": { label: "Ability kind", alias: "ak" } } });
  const { catalogue } = buildCatalogue({ version: "abc", deriveVersion: 538, registry: reg, walk: walkRecords(fixture(), reg) });
  expect(catalogue).toMatchObject({ formatVersion: 1, version: "abc", deriveVersion: 538 });
  expect(catalogue.groups["read"]!.file).toBe("read.json");
  expect(catalogue.groups["read"]!.fields.find((f) => f.id === "tags.abilities.kind")).toMatchObject({
    label: "Ability kind",
    alias: "ak",
    values: [{ v: "static", n: 1 }, { v: "triggered", n: 1 }],
  });
});

test("registry value labels reach the catalogue field, and a field without them carries none", () => {
  const reg = registry({ fields: { "tags.abilities.kind": { label: "Ability kind", valueLabels: { static: "always on" } } } });
  const { catalogue } = buildCatalogue({ version: "v", deriveVersion: 1, registry: reg, walk: walkRecords(fixture(), reg) });
  const fields = catalogue.groups["read"]!.fields;
  expect(fields.find((f) => f.id === "tags.abilities.kind")).toMatchObject({ valueLabels: { static: "always on" } });
  expect(fields.find((f) => f.id === "tags.clauseSource")).not.toHaveProperty("valueLabels");
});

test("a registry description reaches the catalogue field", () => {
  const reg = registry({ fields: { "tags.abilities.kind": { label: "Ability kind", description: "What sort of ability it is." } } });
  const { catalogue } = buildCatalogue({ version: "v", deriveVersion: 1, registry: reg, walk: walkRecords(fixture(), reg) });
  expect(catalogue.groups["read"]!.fields.find((f) => f.id === "tags.abilities.kind")).toMatchObject({ description: "What sort of ability it is." });
  expect(catalogue.groups["read"]!.fields.find((f) => f.id === "tags.clauseSource")).not.toHaveProperty("description");
});

test("a path with string and number leaves keeps the numbers as set members and is reported as mixed", () => {
  const recs = [rec(0, { amount: "all" }), rec(1, { amount: 3 }), rec(2, { amount: [2, "x"] })];
  const r = walkRecords(recs, registry());
  const col = r.columns.get("tags.amount") as SetColumn;
  expect(col.kind).toBe("set");
  expect([...col.values]).toEqual([["2", [2]], ["3", [1]], ["all", [0]], ["x", [2]]]);
  expect(r.mixed).toEqual(["tags.amount"]);
  expect(walkRecords(fixture(), registry()).mixed).toEqual([]);
});

test("external, internal and build-state fields never become fields, nested or not", () => {
  const card = { edhrecSaltiness: 0.07, artCrop: "u", nested: { _id: "a", printingId: "p", oracleId: "o", artCrop: "u", ok: "yes" } };
  const tags = { deriveVersion: 5, normalizeVersion: 2, clauseSource: "grammar", abilities: [{ _id: "z", kind: "static" }] };
  const { columns } = walkRecords([rec(0, tags, card)], registry({ groups: { read: ["tags"], card: ["card"] } }));
  expect([...columns.keys()].sort()).toEqual(["card.nested.ok", "tags.abilities.kind", "tags.clauseSource"]);
});

test("multiValued lists numeric paths where one card holds more than one distinct value", () => {
  const recs = [rec(0, { amount: [2, 5], single: 1 }), rec(1, { amount: 3, single: 1 }), rec(2, { amount: [4, 4] })];
  expect(walkRecords(recs, registry()).multiValued).toEqual(["tags.amount"]);
});
