import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const SCRIPT = join(import.meta.dirname, "../../scripts/build-search.mts");
const REGISTRY = join(import.meta.dirname, "../../scripts/search-registry.json");

/** A tiny static-out: 5 cards. Row 0 changeling, 1 Borg, 2 three-type WUG, 3 two-type, 4 a land with no record. */
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
    ],
  }));
  const entry = (name: string, tags: unknown) => ({ card: { name, edhrecRank: 1 }, tags });
  writeFileSync(join(v, "cards", "0000.json"), JSON.stringify({
    shifty: entry("Shifty", { clauseSource: "grammar", characteristics: { faces: [{ types: ["creature"] }] } }),
    cube: entry("Cube", { clauseSource: "model" }),
    trio: entry("Trio", { clauseSource: "grammar" }),
    "trio alias": entry("Trio", { clauseSource: "grammar" }),
    duo: entry("Duo", null),
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
  expect(readdirSync(dir).sort()).toEqual(["catalogue.json", "read.json"]);
  const cat = JSON.parse(readFileSync(join(dir, "catalogue.json"), "utf8"));
  expect(cat).toMatchObject({ formatVersion: 1, version: "v-t", deriveVersion: 9 });
  expect(cat.groups.read.bytes).toBeGreaterThan(0);
  expect(cat.groups.read.gzipBytes).toBeGreaterThan(0);
  expect(cat.groups.types.file).toBeNull();
  expect(cat.namedLists.creature.values).toEqual(["borg", "elf", "human", "wizard"]);
  const read = cat.groups.read.fields.find((f: { id: string }) => f.id === "read");
  expect(read.values).toEqual([{ v: "grammar", n: 2 }, { v: "model", n: 1 }, { v: "unread", n: 2 }]);
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
