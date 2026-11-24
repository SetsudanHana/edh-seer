// @vitest-environment node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { decodeGroup, type Catalogue } from "./lib/search/catalogue.js";
import { evaluate, type EvalContext } from "./lib/search/evaluate.js";
import { buildIdentityView, buildNumberViews, buildTypeViews } from "./lib/search/type-views.js";
import type { Column } from "./lib/search/walk.js";

const SCRIPT = join(import.meta.dirname, "../../scripts/build-search.mts");
const REGISTRY = join(import.meta.dirname, "../../scripts/search-registry.json");

/** A tiny static-out: 6 cards. Row 0 changeling, 1 Borg, 2 three-type WUG, 3 two-type (null tags), 4 a land with no record,
 *  5 a DFC whose t is creature+land but whose FRONT is only a creature. */
function fakeStatic(): string {
  const root = mkdtempSync(join(tmpdir(), "search-build-"));
  const v = join(root, "v-t");
  mkdirSync(join(v, "cards"), { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: "v-t", deriveVersion: 9, precons: "p-keep" }));
  const row = (name: string, t: number[], s: number[], extra: object = {}) => ({ slug: name.toLowerCase(), name, identity: ["W", "U"], t, s, ...extra });
  writeFileSync(join(v, "name-index.json"), JSON.stringify({
    types: ["creature", "land"], subtypes: ["borg", "elf", "human", "wizard", "forest"], keywords: ["changeling"],
    cards: [
      row("Shifty", [0], [0, 1, 2, 3], { k: [0], pow: 1, tou: 1 }),
      row("Cube", [0], [0, 1]),
      row("Trio", [0], [1, 2, 3], { identity: ["W", "U", "G"], pow: 2, tou: 2 }),
      row("Duo", [0], [1, 2]),
      row("Wood", [1], [4], { identity: [] }),
      row("Umara", [0, 1], []),
    ],
  }));
  const entry = (name: string, tags: unknown) => ({ card: { name, edhrecRank: 1 }, tags });
  writeFileSync(join(v, "cards", "0000.json"), JSON.stringify({
    shifty: entry("Shifty", { clauseSource: "grammar", characteristics: { faces: [{ types: ["creature"] }] } }),
    cube: entry("Cube", { clauseSource: "model" }),
    trio: entry("Trio", { clauseSource: "grammar" }),
    "trio alias": entry("Trio", { clauseSource: "grammar" }),
    duo: entry("Duo", null),
    umara: entry("Umara", { clauseSource: "grammar", characteristics: { faces: [{ types: ["creature"] }, { types: ["land"] }] } }),
  }));
  return root;
}
const run = (args: string[]) => spawnSync("npx", ["tsx", SCRIPT, ...args], { encoding: "utf8", cwd: join(import.meta.dirname, "../../../..") });
const manifest = (root: string) => JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

test("build promotes search/s-<hash>, keeps the other manifest keys, and --verify answers the acceptance query", () => {
  const root = fakeStatic();
  const r = run(["--static", root, "--creatures", "borg,elf,human,wizard", "--lands", "forest"]);
  expect(r.status, r.stderr + r.stdout).toBe(0);
  const m = manifest(root);
  expect(m.precons).toBe("p-keep");
  expect(m.search).toMatch(/^s-[0-9a-f]{12}$/);
  const dir = join(root, "v-t", "search", m.search);
  expect(readdirSync(dir).sort()).toEqual(["catalogue.json", "faces.json", "read.json"]);
  const cat = JSON.parse(readFileSync(join(dir, "catalogue.json"), "utf8"));
  expect(cat).toMatchObject({ formatVersion: 1, version: "v-t", deriveVersion: 9 });
  expect(cat.groups.read.bytes).toBeGreaterThan(0);
  expect(cat.groups.read.gzipBytes).toBeGreaterThan(0);
  expect(cat.groups.types.file).toBeNull();
  expect(cat.namedLists.creature.values).toEqual(["borg", "elf", "human", "wizard"]);
  const read = cat.groups.read.fields.find((f: { id: string }) => f.id === "read");
  expect(read.values).toEqual([{ v: "grammar", n: 3 }, { v: "model", n: 1 }, { v: "no-record", n: 1 }, { v: "unread", n: 1 }]);
  expect(r.stdout).toMatch(/no record: Wood/);
  expect(cat.groups.faces.gzipBytes).toBeGreaterThan(0);
  const v = run(["--static", root, "--verify"]);
  expect(v.status, v.stderr + v.stdout).toBe(0);
  expect(v.stdout).toMatch(/results: 1\b/);
  expect(v.stdout).toMatch(/Trio/);
  expect(v.stdout).toMatch(/changelings in result: 0/);
  expect(v.stdout).toMatch(/everyCreatureType: 1 \(keyword changeling: 1\)/);
});

test("a rebuild removes the older s-* directory and a second identical build keeps the same hash", () => {
  const root = fakeStatic();
  const args = ["--static", root, "--creatures", "borg,elf,human,wizard", "--lands", "forest"];
  run(args);
  const first = manifest(root).search;
  mkdirSync(join(root, "v-t", "search", "s-old"), { recursive: true });
  run(args);
  expect(manifest(root).search).toBe(first);
  expect(readdirSync(join(root, "v-t", "search"))).toEqual([first]);
});

test("a budget breach exits non-zero and promotes nothing", () => {
  const root = fakeStatic();
  const reg = JSON.parse(readFileSync(REGISTRY, "utf8"));
  reg.budgets.read = 1;
  const regPath = join(root, "tight.json");
  writeFileSync(regPath, JSON.stringify(reg));
  const r = run(["--static", root, "--registry", regPath, "--creatures", "borg", "--lands", "forest"]);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/budget/i);
  expect(manifest(root).search).toBeUndefined();
  expect(existsSync(join(root, "v-t", "search", ".staging"))).toBe(false);
});

/** What a client does: the name-index views plus the fetched group files, through the catalogue. */
function clientColumns(root: string): EvalContext {
  const m = manifest(root);
  const dir = join(root, "v-t", "search", m.search);
  const cat = JSON.parse(readFileSync(join(dir, "catalogue.json"), "utf8")) as Catalogue;
  const index = JSON.parse(readFileSync(join(root, "v-t", "name-index.json"), "utf8"));
  const columns = new Map<string, Column>();
  for (const c of [...buildTypeViews(index, { creatureList: cat.namedLists["creature"]!.values }), ...buildNumberViews(index.cards), buildIdentityView(index.cards)]) columns.set(c.path, c);
  columns.delete("tFront"); // the index carries no face data: tFront comes only from the faces group
  for (const g of Object.values(cat.groups)) {
    if (!g.file) continue;
    for (const c of decodeGroup(g, JSON.parse(readFileSync(join(dir, g.file), "utf8")))) columns.set(c.path, c);
  }
  return { rowCount: index.cards.length, columns, namedLists: cat.namedLists };
}

test("tFront from the BUILT artifact: a DFC whose front lacks a type in t does not match it", () => {
  const root = fakeStatic();
  expect(run(["--static", root, "--creatures", "borg,elf,human,wizard", "--lands", "forest"]).status).toBe(0);
  const ctx = clientColumns(root);
  expect(evaluate({ field: "tFront", op: "has", value: "land" }, ctx)).toEqual({ ok: true, rows: [4] });
  expect(evaluate({ field: "t", op: "has", value: "land" }, ctx)).toEqual({ ok: true, rows: [4, 5] });
  expect(evaluate({ field: "tFront", op: "has", value: "creature" }, ctx)).toEqual({ ok: true, rows: [0, 1, 2, 3, 5] });
  const cat = JSON.parse(readFileSync(join(root, "v-t", "search", manifest(root).search, "catalogue.json"), "utf8")) as Catalogue;
  const f = cat.groups["faces"]!.fields.find((x) => x.id === "tFront")!;
  expect(f.fallback).toBe("t");
  expect(f.values).toEqual([{ v: "creature", n: 5 }, { v: "land", n: 1 }]);
});

function withRegistry(root: string, edit: (reg: any) => void): string[] {
  const reg = JSON.parse(readFileSync(REGISTRY, "utf8"));
  edit(reg);
  const p = join(root, "edited.json");
  writeFileSync(p, JSON.stringify(reg));
  return ["--registry", p, "--creatures", "borg", "--lands", "forest"];
}

test("a budget that names no group fails the build, and promotes nothing", () => {
  const root = fakeStatic();
  const r = run(["--static", root, ...withRegistry(root, (g) => { g.budgets.nonesuch = 10_000; })]);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/budget.*nonesuch.*no group/i);
  expect(manifest(root).search).toBeUndefined();
});

test("a group with a file and no budget fails the build, and promotes nothing", () => {
  const root = fakeStatic();
  const r = run(["--static", root, ...withRegistry(root, (g) => { delete g.budgets.faces; })]);
  expect(r.status).not.toBe(0);
  expect(r.stderr).toMatch(/faces.*no budget/i);
  expect(manifest(root).search).toBeUndefined();
});

test("--check passes on a clean registry and names a stale per-path entry; it promotes nothing", () => {
  const root = fakeStatic();
  const ok = run(["--static", root, "--check", ...withRegistry(root, () => {})]);
  expect(ok.status, ok.stderr + ok.stdout).toBe(0);
  const bad = run(["--static", root, "--check", ...withRegistry(root, (g) => { g.fields["tags.gone"] = { label: "Gone" }; })]);
  expect(bad.status).not.toBe(0);
  expect(bad.stderr).toMatch(/stale.*tags\.gone/i);
  expect(manifest(root).search).toBeUndefined();
});

// #1785: the payoff field `cares`, built from the grammar's distinct-type fields. Production documents and stored clauses (DERIVE 593 tree, 2026-11-24), derived HERE with the real engine so the fixture cannot go stale.
import fx from "./fixtures/payoff-1785.fixtures.json" with { type: "json" };
import { deriveCardTags, deriveInputOf, grammarClauseRecords, type ClauseRecord } from "@edh-seer/tagger";

type Fx = { source: Record<string, unknown>; canonical?: ClauseRecord[] };
const PAYOFF_NAMES = Object.keys(fx);
function payoffStatic(withDerived: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "search-payoff-"));
  const v = join(root, "v-t");
  mkdirSync(join(v, "cards"), { recursive: true });
  writeFileSync(join(root, "manifest.json"), JSON.stringify({ version: "v-t", deriveVersion: 594 }));
  writeFileSync(join(v, "name-index.json"), JSON.stringify({
    types: ["creature"], subtypes: ["elf"], keywords: [],
    cards: PAYOFF_NAMES.map((name) => ({ slug: name.toLowerCase(), name, identity: [], t: [0], s: [0] })),
  }));
  const shard: Record<string, unknown> = {};
  for (const name of PAYOFF_NAMES) {
    const f = (fx as unknown as Record<string, Fx>)[name]!;
    const g = f.canonical === undefined ? grammarClauseRecords(f.source as never) : undefined;
    const tags = deriveCardTags(deriveInputOf(f.source as never, name, name, g ? g.records : f.canonical!, undefined, g?.readings));
    // `withDerived: false` is a corpus derived before #1785: the grammar's own fields are not in its rows.
    const stripped = JSON.parse(JSON.stringify(tags, (k, val) => (k === "distinctCount" || k === "thresholdDistinct" ? undefined : val)));
    shard[name.toLowerCase()] = { card: { name }, tags: withDerived ? tags : stripped };
  }
  writeFileSync(join(v, "cards", "0000.json"), JSON.stringify(shard));
  return root;
}
const cares = (ctx: EvalContext, value: string): string[] => {
  const r = evaluate({ field: "cares", op: "has", value }, ctx);
  if (!r.ok) throw new Error(r.cannotAnswer.join("; "));
  return r.rows.map((i) => PAYOFF_NAMES[i]!).sort();
};

test("cares:card-types and cares:creature-types come back from the BUILT artifact, over the grammar's fields (#1785)", () => {
  const root = payoffStatic(true);
  const built = run(["--static", root]);
  expect(built.status, built.stderr + built.stdout).toBe(0);
  const ctx = clientColumns(root);
  const cardTypes = cares(ctx, "card-types");
  // a graveyard scaling count, a delirium threshold, a battlefield card-type count; and none of the cards that count nothing
  expect(cardTypes).toEqual(["Dragon's Rage Channeler", "Emrakul, the Promised End", "Loot, the Key to Everything", "Tarmogoyf", "Traverse the Ulvenwald"]);
  expect(cares(ctx, "creature-types")).toEqual(["Infinite Diversity", "Valiant Changeling"]);
  for (const bad of ["Grizzly Bears", "Mistform Ultimus", "Maskwood Nexus", "Keen-Eyed Curator", "Nael, Avizoa Aeronaut", "Subgoyf"]) {
    expect(cardTypes, bad).not.toContain(bad);
    expect(cares(ctx, "creature-types"), bad).not.toContain(bad);
  }
  const cat = JSON.parse(readFileSync(join(root, "v-t", "search", manifest(root).search, "catalogue.json"), "utf8")) as Catalogue;
  const f = cat.groups["payoffs"]!.fields.find((x) => x.id === "cares")!;
  expect(f.valueLabels).toMatchObject({ "card-types": "how many card types" });
  expect(f.values).toEqual([{ v: "card-types", n: 5 }, { v: "creature-types", n: 2 }]);
  expect(cat.groups["payoffs"]!.gzipBytes).toBeLessThan(JSON.parse(readFileSync(REGISTRY, "utf8")).budgets.payoffs);
});

test("shards derived before #1785 build no `cares` field: a question about it is cannot-answer, never an empty list", () => {
  const root = payoffStatic(false);
  const built = run(["--static", root]);
  expect(built.status, built.stderr + built.stdout).toBe(0);
  expect(built.stdout).toMatch(/computed fields not built: cares \(no card holds tags\.abilities\.effect\.distinctCount\.counts, tags\.abilities\.thresholdDistinct\.counts\)/);
  const ctx = clientColumns(root);
  expect(evaluate({ field: "cares", op: "has", value: "card-types" }, ctx)).toEqual({ ok: false, cannotAnswer: ["unknown field cares"] });
});
