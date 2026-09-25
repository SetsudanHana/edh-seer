#!/usr/bin/env node
/** Every script lives in the home that matches what it is FOR.
 *
 *  Settled 2026-09-07 (roadmap Z3/Z4, PRs #221 and #223) and documented in CONTRIBUTING.md:
 *
 *      packages/*\/src/bin/     pipeline   - writes Mongo or a tracked artifact the product ships,
 *                                            or is a module with a test
 *      packages/instruments/   scoring    - judges the engine's output; its tests run in `npm test`
 *      research/<package>/     one-shot   - a census, sweep, audit, dump or probe that PRINTS
 *                                            and that nothing imports
 *
 *  `src/bin` went 110 files to 53 on that split. Without a gate it goes back: a new census dropped
 *  into `packages/matcher/src/bin` merges green, and the rule becomes a paragraph nobody reads.
 *
 *  TWO DIRECTIONS, because only one of them has actually bitten:
 *
 *    1. A one-shot in `src/bin` is untidy.
 *    2. A file under `research/` with a test beside it is WORSE THAN UNTIDY. `research/` has no
 *       vitest project, so its tests are collected by nothing -- the file looks covered, `npm test`
 *       stays green, and the coverage is simply gone. That is the shape of the "75 tests fail on a
 *       clean checkout" era, where the reported number and the real one had quietly parted company.
 *
 *  DECIDE BY WHAT A SCRIPT WRITES, NEVER BY ITS NAME. A name-based pass put `build-static` -- the
 *  deploy artifact builder -- in the move list, because it resolves its output directory at runtime.
 *  So the test below is for write CALLS, not for a `gen-`/`build-` prefix.
 *
 *  Run: node scripts/check_bin_placement.mjs [--self-test]
 *  Node built-ins only, no install step, same as the other gates in this directory. Ported from
 *  the Python original on 2026-09-25, with its output held identical on the repository and on a
 *  planted failure of every check. */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A write to Mongo, or a write to the filesystem. Either makes a script something the product or
// the corpus DEPENDS ON having been run, which is what "pipeline" means here.
const WRITES = new RegExp(
  String.raw`\b(writeFileSync|writeFile|createWriteStream|mkdirSync|cpSync|copyFileSync`
  + String.raw`|updateOne|updateMany|insertOne|insertMany|bulkWrite|replaceOne|deleteOne|deleteMany`
  + String.raw`|createIndex|upsert[A-Z]\w*)\s*\(`,
);
const IMPORTS_BIN = /from\s+"[^"]*\bbin\/([A-Za-z0-9_-]+)\.js"/g;

const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const read = (p) => readFileSync(p, "utf8");
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const stem = (f) => basename(f, extname(f));

/** Every file under `dir`, recursively, skipping `node_modules` and `dist` (which no check reads). */
function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort(byName);
}

const packages = () => readdirSync(join(ROOT, "packages")).sort(byName).map((n) => join(ROOT, "packages", n)).filter(isDir);

/** Bin stems named by any package.json `scripts` entry. */
function packageScriptTargets() {
  const out = new Set();
  for (const pkg of packages()) {
    const file = join(pkg, "package.json");
    if (!existsSync(file)) continue;
    const blob = JSON.stringify(JSON.parse(read(file)).scripts ?? {});
    for (const m of blob.matchAll(/src\/bin\/([A-Za-z0-9_-]+)\.ts/g)) out.add(`${basename(pkg)}/${m[1]}`);
  }
  return out;
}

/** Bin stems imported from a source file that is NOT itself a bin. */
function importedByProduct() {
  const out = new Set();
  for (const pkg of packages()) {
    const src = join(pkg, "src");
    if (!isDir(src)) continue;
    for (const f of walk(src)) {
      if (!basename(f).includes(".ts") || basename(dirname(f)) === "bin") continue;
      for (const m of read(f).matchAll(IMPORTS_BIN)) out.add(`${basename(pkg)}/${m[1]}`);
    }
  }
  return out;
}

/** Files in `packages/*\/src/bin` that nothing depends on and that write nothing. */
function misplacedBins() {
  const scripted = packageScriptTargets(), imported = importedByProduct();
  const bad = [];
  for (const pkg of packages()) {
    const bindir = join(pkg, "src", "bin");
    if (!isDir(bindir)) continue;
    for (const name of readdirSync(bindir).sort(byName)) {
      const f = join(bindir, name);
      if (!name.endsWith(".ts") || name.endsWith(".test.ts") || isDir(f)) continue;
      const key = `${basename(pkg)}/${stem(name)}`;
      if (existsSync(join(bindir, `${stem(name)}.test.ts`))) continue;
      if (scripted.has(key) || imported.has(key)) continue;
      if (WRITES.test(read(f))) continue;
      bad.push(relative(ROOT, f));
    }
  }
  return bad;
}

const RUNTIME_PATH = /new URL\(\s*"(\.\.?\/[^"]+)"/g;

/** Relative `new URL(...)` targets that do not exist.
 *
 *  MOVING A FILE SILENTLY BREAKS THESE AND NOTHING ELSE NOTICES. The 2026-09-07 reorg rewrote
 *  every `import` specifier and left 16 runtime paths across 10 files pointing at directories
 *  that had never existed -- `packages/instruments/fixtures/gold-clauses.json`,
 *  `packages/instruments/goldpairs.json`, `cli/decks/`. TypeScript cannot see inside a string,
 *  these scripts have no tests by design, and the failure only shows when someone runs the tool
 *  months later. Found by accident while pricing something unrelated.
 *
 *  A directory target is accepted when its PARENT exists: `.cs-cache/` and `.edhrec-cache/` are
 *  gitignored and created on demand, so requiring them would fail a clean checkout. */
function brokenRuntimePaths() {
  const bad = [];
  for (const base of ["packages", "research"]) {
    const root = join(ROOT, base);
    if (!isDir(root)) continue;
    for (const f of walk(root)) {
      if (!f.endsWith(".ts")) continue;
      for (const m of read(f).matchAll(RUNTIME_PATH)) {
        const target = resolve(dirname(f), m[1]);
        if (existsSync(target) || isDir(dirname(target))) continue;
        bad.push(`${relative(ROOT, f)}: new URL("${m[1]}") -> ${target} does not exist`);
      }
    }
  }
  return bad;
}

const WRITTEN_PATH = /(?<![\p{L}\p{N}_./-])((?:packages|research|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|mts|mjs|py))(?![\p{L}\p{N}_])/gu;
const WRITTEN_EXT = new Set([".ts", ".tsx", ".mts", ".mjs", ".js", ".py", ".md", ".html", ".json", ".yml", ".txt"]);
// Python's str.splitlines, so a line number here is the line number an editor shows. The control
// characters are the separators it splits on, on purpose.
// oxlint-disable-next-line no-control-regex
const LINES = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

/** Script paths written out in prose -- a run instruction, a docstring, a cited command -- that
 *  point at nothing.
 *
 *  THE SAME MOVE, THE OTHER HALF. `brokenRuntimePaths` catches the strings a script reads; the
 *  2026-09-07 reorg also left 47 run instructions pointing at `packages/*\/src/bin/` paths the files
 *  had moved out of, one of them quoted on the live How it works page (found 2026-09-25). A path
 *  counts as resolved from the repository root, from its own package, or from its own directory,
 *  which is how these are written. The engineering log is history and keeps the paths it had. */
function brokenWrittenPaths() {
  const tracked = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).split("\n");
  const bad = [];
  for (const rel of tracked) {
    // This file's own self-test names a path that must not exist.
    if (!rel || rel.startsWith("docs/engineering-log/") || rel === "package-lock.json" || rel === "scripts/check_bin_placement.mjs") continue;
    if (!WRITTEN_EXT.has(extname(rel))) continue;
    const f = join(ROOT, rel);
    if (!existsSync(f)) continue;
    const pkg = rel.startsWith("packages/") ? join(ROOT, ...rel.split("/").slice(0, 2)) : null;
    read(f).split(LINES).forEach((line, i) => {
      for (const m of line.matchAll(WRITTEN_PATH)) {
        const target = m[1];
        if (existsSync(join(ROOT, target)) || existsSync(join(dirname(f), target)) || (pkg && existsSync(join(pkg, target)))) continue;
        bad.push(`${rel}:${i + 1}: ${target}`);
      }
    });
  }
  return bad;
}

/** Test files under `research/`, which no vitest project collects. */
function orphanedResearchTests() {
  const research = join(ROOT, "research");
  if (!isDir(research)) return [];
  return walk(research).filter((f) => basename(f).includes(".test.ts")).map((f) => relative(ROOT, f)).sort(byName);
}

function assert(ok, message) {
  if (!ok) throw new Error(`self-test failed: ${message}`);
}

/** Prove BOTH directions fire. A gate nobody has watched fail is decoration. */
function selfTest() {
  const hit = (re, s) => { re.lastIndex = 0; const r = re.test(s); re.lastIndex = 0; return r; };
  assert(hit(WRITES, 'writeFileSync(target, "x")'), "a file writer must read as pipeline");
  assert(hit(WRITES, "await col.updateOne({}, {})"), "a Mongo write must read as pipeline");
  assert(hit(WRITES, "await upsertCardTags(a, b)"), "an upsert helper must read as pipeline");
  assert(!hit(WRITES, 'console.log("just a census")'), "a printer must NOT read as pipeline");
  // The trap this rule exists to avoid: the decision is the write call, never the name.
  assert(!hit(WRITES, "const outDir = argv[i + 1];"), "naming an out dir is not writing");
  assert(hit(RUNTIME_PATH, 'readFileSync(new URL("../x.json", import.meta.url))'), "must see a runtime path");
  assert(!hit(RUNTIME_PATH, 'from "../x.js"'), "an import specifier is not a runtime path");
  assert(hit(WRITTEN_PATH, "npx tsx packages/matcher/src/bin/x.ts"), "must see a written script path");
  assert(!hit(WRITTEN_PATH, "my-packages/x.ts"), "a path inside a longer word is not one");
  console.log("self-test: both directions fire");
}

function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return 0;
  }
  const bad = misplacedBins(), orphans = orphanedResearchTests(), paths = brokenRuntimePaths();
  const written = brokenWrittenPaths();
  for (const f of bad) {
    const pkg = f.split("/")[1];
    console.log(
      `${f}: nothing imports it, no package.json script runs it, it has no test and it `
      + `writes nothing -- that is a one-shot measurement. Move it to research/${pkg}/ `
      + `(see CONTRIBUTING.md, 'Where a script goes'), or give it the test or the write that `
      + `makes it pipeline.`,
    );
  }
  for (const f of orphans) {
    console.log(
      `${f}: research/ is not a vitest project, so this test is collected by NOTHING and `
      + `its coverage is silently absent from \`npm test\`. Move the module and its test into `
      + `a package -- packages/instruments/ for a scoring or verification instrument.`,
    );
  }
  for (const f of paths) {
    console.log(`${f} -- a relative runtime path that no longer resolves. Moving a file rewrites its `
      + `imports but NOT the strings inside \`new URL(...)\`, and nothing else can see them.`);
  }
  for (const f of written) {
    console.log(`${f} -- a written script path that no longer exists. A move rewrites imports, not the `
      + `run instructions and citations that name the file; point this at where it lives now.`);
  }
  const total = bad.length + orphans.length + paths.length + written.length;
  if (total) {
    console.log(`\n${total} problem(s).`);
    return 1;
  }
  console.log("bin placement: ok");
  return 0;
}

process.exitCode = main();
