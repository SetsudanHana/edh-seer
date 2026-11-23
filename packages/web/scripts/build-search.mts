/** Builds the search artifact (#1781): a catalogue plus one payload per group, read from `static-out/`.
 *
 *    npx tsx packages/web/scripts/build-search.mts [--static static-out] [--verify]
 *
 *  Reads `manifest.json`, `<version>/name-index.json` and every `<version>/cards/*.json` shard (shards hold
 *  alias keys, so entries are joined to name-index rows by card name and deduped by row). Writes a staging
 *  directory, promotes it to `<version>/search/s-<hash of its bytes>/` and names it in the manifest as
 *  `search`, keeping the manifest's other keys. Same pattern as `build-precons.mts`: the URL is the bytes.
 *  A budget breach exits non-zero and promotes nothing.
 *
 *  `--verify` evaluates the acceptance query against the BUILT directory through the client library.
 *  Test-only flags: `--registry <file>`, `--creatures a,b`, `--lands a,b` (default: the tagger's lists). */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { CREATURE_SUBTYPES, LAND_SUBTYPES } from "@edh-seer/tagger/subtypes";
import { buildCatalogue, decodeGroup, type Catalogue, type GroupPayload } from "../client/src/lib/search/catalogue.ts";
import { evaluate, type Node } from "../client/src/lib/search/evaluate.ts";
import type { SearchRegistry } from "../client/src/lib/search/registry.ts";
import { buildIdentityView, buildNumberViews, buildTypeViews, sparseFront, type IndexRow, type NumericRow } from "../client/src/lib/search/type-views.ts";
import { walkRecords, type Column, type SetColumn, type WalkRecord } from "../client/src/lib/search/walk.ts";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const repo = resolve(import.meta.dirname, "..", "..", "..");
const source = resolve(arg("--static") ?? join(repo, "static-out"));
const registryPath = arg("--registry") ?? join(import.meta.dirname, "search-registry.json");
const manifestPath = join(source, "manifest.json");

type Row = IndexRow & NumericRow & { name: string; k?: number[] };
interface NameIndex { types: string[]; subtypes: string[]; keywords: string[]; cards: Row[] }

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string; deriveVersion: number } & Record<string, unknown>;
const versionDir = join(source, manifest.version);
const searchRoot = join(versionDir, "search");
const index = JSON.parse(readFileSync(join(versionDir, "name-index.json"), "utf8")) as NameIndex;

/** The core views, computed from name-index rows the way the client will: no new row bytes. */
function coreColumns(frontTypes: Map<number, string[]>, creatureList: string[]): Column[] {
  return [
    ...buildTypeViews(index, { creatureList, frontTypes }),
    ...buildNumberViews(index.cards),
    buildIdentityView(index.cards),
  ];
}

if (process.argv.includes("--verify")) {
  verify();
} else {
  build();
}

function lists(): { creature: string[]; land: string[] } {
  const given = (flag: string, fallback: readonly string[]) => (arg(flag) !== undefined ? arg(flag)!.split(",").filter(Boolean) : [...fallback]);
  return { creature: given("--creatures", CREATURE_SUBTYPES), land: given("--lands", [...LAND_SUBTYPES]) };
}

function build(): void {
  const t0 = Date.now();
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as SearchRegistry;
  const { creature, land } = lists();
  registry.namedLists = {
    ...registry.namedLists,
    creature: { ...registry.namedLists["creature"]!, values: creature },
    land: { ...registry.namedLists["land"]!, values: land },
  };

  const rowOf = new Map(index.cards.map((c, i) => [c.name, i]));
  const records: WalkRecord[] = [];
  const frontTypes = new Map<number, string[]>();
  const seen = new Set<number>();
  for (const f of readdirSync(join(versionDir, "cards")).filter((n) => n.endsWith(".json")).sort()) {
    const shard = JSON.parse(readFileSync(join(versionDir, "cards", f), "utf8")) as Record<string, { card: { name: string }; tags: { characteristics?: { faces?: { types?: string[] }[] } } | null }>;
    for (const e of Object.values(shard)) {
      const row = rowOf.get(e.card.name);
      if (row === undefined || seen.has(row)) continue;
      seen.add(row);
      records.push({ row, card: e.card, tags: e.tags });
      const front = e.tags?.characteristics?.faces?.[0]?.types;
      if (front) frontTypes.set(row, front);
    }
  }

  const walk = walkRecords(records, registry);
  // THE READ STATE: grammar / model by the record's clauseSource; `unread` = a record whose tags are null (underived);
  // `no-record` = a row with no shard record at all (an alias-key collision in static-out, not papered over here).
  const read = new Map<string, number[]>([["grammar", []], ["model", []], ["no-record", []], ["unread", []]]);
  const source_ = new Map(records.map((r) => [r.row, (r.tags as { clauseSource?: string } | null)?.clauseSource]));
  const noRecord: string[] = [];
  index.cards.forEach((c, i) => {
    if (!source_.has(i)) {
      read.get("no-record")!.push(i);
      noRecord.push(c.name);
      return;
    }
    const cs = source_.get(i);
    read.get(cs === "grammar" || cs === "model" ? cs : "unread")!.push(i);
  });
  for (const [k, v] of [...read]) if (v.length === 0) read.delete(k);
  const readColumn: SetColumn = { kind: "set", path: "read", group: "read", values: read };
  walk.columns.set("read", readColumn);

  // tFront is NOT served by name-index (no face data there): only the rows whose front differs from `t` ship, as `faces`.
  const all = coreColumns(frontTypes, creature);
  const core = all.filter((c) => c.path !== "tFront");
  const front = all.find((c) => c.path === "tFront") as SetColumn;
  const sparse = sparseFront(front, all.find((c) => c.path === "t") as SetColumn);
  walk.columns.set("tFront", sparse);
  const { catalogue, payloads } = buildCatalogue({ version: manifest.version, deriveVersion: manifest.deriveVersion, registry, walk, core });

  const files = new Map<string, string>();
  const sizes: Record<string, { bytes: number; gzipBytes: number }> = {};
  for (const [name, payload] of Object.entries(payloads)) {
    const text = JSON.stringify(payload);
    const group = catalogue.groups[name]!;
    group.bytes = Buffer.byteLength(text);
    group.gzipBytes = gzipSync(text).length;
    sizes[name] = { bytes: group.bytes, gzipBytes: group.gzipBytes };
    files.set(group.file!, text);
  }
  const catalogueText = JSON.stringify(catalogue);
  sizes["catalogue"] = { bytes: Buffer.byteLength(catalogueText), gzipBytes: gzipSync(catalogueText).length };
  files.set("catalogue.json", catalogueText);

  console.log(`records ${records.length} of ${index.cards.length} rows; ${walk.columns.size} walked columns, ${core.length} core columns`);
  for (const [name, s] of Object.entries(sizes)) console.log(`  ${name.padEnd(10)} ${String(s.bytes).padStart(9)} bytes  ${String(s.gzipBytes).padStart(8)} gzip`);
  console.log(`faces: ${sparse.overrides!.length} rows whose front types differ from t`);
  console.log(`no record: ${noRecord.length ? noRecord.join(", ") : "none"}`);
  console.log(`multi-valued numeric paths (cmp reads their [min,max] range, see CEILING in evaluate.ts): ${walk.multiValued.length ? walk.multiValued.join(", ") : "none"}`);
  console.log(`mixed (numbers kept as set members): ${walk.mixed.length ? walk.mixed.join(", ") : "none"}`);
  console.log(`dropped (above threshold): ${walk.dropped.length ? walk.dropped.map((d) => `${d.path} (${d.distinct})`).join(", ") : "none"}`);

  // A BUDGET IS A CONTRACT BOTH WAYS: one naming no group is a typo, a group with a file and no budget is unbounded.
  const budgets = registry.budgets ?? {};
  const problems = [
    ...Object.keys(budgets).filter((n) => !(n in sizes)).map((n) => `budget ${n} names no group (groups with a file: ${Object.keys(sizes).join(", ")})`),
    ...Object.keys(sizes).filter((n) => !(n in budgets)).map((n) => `group ${n} has a file and no budget`),
  ];
  if (problems.length) {
    for (const p of problems) console.error(`${p}. Nothing promoted.`);
    process.exit(1);
  }
  const breaches = Object.entries(budgets).filter(([n, max]) => (sizes[n]?.gzipBytes ?? 0) > max);
  if (breaches.length) {
    for (const [n, max] of breaches) console.error(`budget breach: ${n} is ${sizes[n]!.gzipBytes} gzip bytes, budget ${max}. Nothing promoted.`);
    process.exit(1);
  }

  // `--check`: a registry per-path entry that names a path the build did not produce is a stale label.
  if (process.argv.includes("--check")) {
    const produced = new Set(Object.values(catalogue.groups).flatMap((g) => g.fields.map((f) => f.id)));
    const stale = Object.keys(registry.fields).filter((p) => !produced.has(p));
    if (stale.length) {
      console.error(`stale registry entries (no such field in the build): ${stale.join(", ")}`);
      process.exit(1);
    }
    console.log(`registry check: ${Object.keys(registry.fields).length} entries, none stale. Nothing promoted.`);
    return;
  }

  const staging = join(searchRoot, ".staging");
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const h = createHash("sha256");
  for (const name of [...files.keys()].sort()) {
    writeFileSync(join(staging, name), files.get(name)!);
    h.update(name).update(files.get(name)!);
  }
  const dir = `s-${h.digest("hex").slice(0, 12)}`;
  rmSync(join(searchRoot, dir), { recursive: true, force: true });
  renameSync(staging, join(searchRoot, dir));
  for (const e of readdirSync(searchRoot)) if (e !== dir) rmSync(join(searchRoot, e), { recursive: true, force: true });
  const m = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  writeFileSync(manifestPath, JSON.stringify({ ...m, search: dir }));
  console.log(`search artifact in ${join(searchRoot, dir)}, manifest points at ${dir} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

function verify(): void {
  const dirName = manifest["search"] as string | undefined;
  if (!dirName) throw new Error("manifest has no search pointer: run the build first");
  const dir = join(searchRoot, dirName);
  const catalogue = JSON.parse(readFileSync(join(dir, "catalogue.json"), "utf8")) as Catalogue;
  const columns = new Map<string, Column>();
  const creature = catalogue.namedLists["creature"]!.values;
  // What a client has: name-index views, then the fetched groups. tFront comes only from the faces group.
  for (const c of coreColumns(new Map(), [...creature])) if (c.path !== "tFront") columns.set(c.path, c);
  for (const [, g] of Object.entries(catalogue.groups)) {
    if (!g.file) continue;
    for (const c of decodeGroup(g, JSON.parse(readFileSync(join(dir, g.file), "utf8")) as GroupPayload)) columns.set(c.path, c);
  }
  const ctx = { rowCount: index.cards.length, columns, namedLists: catalogue.namedLists };
  const query: Node = {
    and: [
      { field: "t", op: "has", value: "creature" },
      { not: { field: "st", op: "has", value: "borg" } },
      { field: "st", op: "countIn", list: "creature", min: 3 },
      { field: "id", op: "within", value: ["W", "U", "G"] },
    ],
  };
  const res = evaluate(query, ctx);
  if (!res.ok) throw new Error(`cannot answer: ${res.cannotAnswer.join("; ")}`);
  const st = columns.get("st") as SetColumn;
  const inList = new Set(creature);
  const counts = new Map<number, number>();
  for (const [v, rows] of st.values) if (inList.has(v)) for (const r of rows) counts.set(r, (counts.get(r) ?? 0) + 1);
  const ranked = [...res.rows].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a - b);
  const every = new Set((columns.get("everyCreatureType") as SetColumn).values.get("true") ?? []);
  const changelingKw = index.keywords.indexOf("changeling");
  const kwRows = index.cards.filter((c) => changelingKw >= 0 && (c.k ?? []).includes(changelingKw)).length;
  console.log(`query: t has creature AND NOT st has borg AND countIn(st, creature) >= 3 AND id within [W,U,G], sorted by countIn desc`);
  console.log(`results: ${res.rows.length}`);
  for (const r of ranked.slice(0, 10)) console.log(`  ${index.cards[r]!.name}  (${counts.get(r)} creature types)`);
  console.log(`changelings in result: ${res.rows.filter((r) => every.has(r)).length}`);
  console.log(`everyCreatureType: ${every.size} (keyword changeling: ${kwRows})`);
  if (res.rows.some((r) => every.has(r))) { console.error("a changeling is in the result"); process.exit(1); }
  if (every.size !== kwRows) { console.error("everyCreatureType differs from the changeling keyword count"); process.exit(1); }
}
