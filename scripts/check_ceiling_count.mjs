#!/usr/bin/env node
/** A per-file ratchet on `CEILING:` markers (#1268 part C, F12).
 *
 *  A deliberate simplification is marked `CEILING:` (CLAUDE.md). The marker is the repo's own ledger
 *  of what it knows it does badly, and nothing counted it: 276 three days before this gate was
 *  written, 299 when it was. A count nobody reads grows by accretion.
 *
 *  BOTH DIRECTIONS, like the other ratchets (`KNOWN_DEFECT_CAP`, `derive-compass`):
 *    - a file's count RISES: a new simplification landed. Bank it with `--bank` and say why in the
 *      commit; the diff of `scripts/ceiling-counts.json` is then the review surface.
 *    - a file's count FALLS: a ceiling was removed, which is the good outcome, and it fails until
 *      the snapshot is updated, so the improvement is banked and cannot quietly grow back.
 *
 *  Scope: non-test `.ts`/`.tsx` under packages/ and research/, skipping node_modules and dist.
 *  A line counts once however many times it says CEILING:.
 *
 *  Run: node scripts/check_ceiling_count.mjs [--self-test | --bank]. Node built-ins only. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "scripts", "ceiling-counts.json");
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const inScope = (rel) => /\.(ts|tsx)$/.test(rel) && !/\.test\./.test(rel);

/** Lines carrying the marker in one file's text. */
export const countIn = (text) => text.split("\n").filter((l) => l.includes("CEILING:")).length;

/** `{ relativePath: count }` for every in-scope file with at least one marker, keys sorted. */
function measure() {
  const out = {};
  for (const base of ["packages", "research"]) {
    for (const f of walk(join(ROOT, base)).map((p) => relative(ROOT, p).split("\\").join("/")).sort(byName)) {
      if (!inScope(f)) continue;
      const n = countIn(readFileSync(join(ROOT, f), "utf8"));
      if (n > 0) out[f] = n;
    }
  }
  return out;
}

export const format = (counts) =>
  JSON.stringify(Object.fromEntries(Object.keys(counts).sort(byName).map((k) => [k, counts[k]])), null, 2) + "\n";

/** The differences between a banked snapshot and a measurement, as messages. */
export function compare(banked, now) {
  const msgs = [];
  for (const f of [...new Set([...Object.keys(banked), ...Object.keys(now)])].sort(byName)) {
    const was = banked[f] ?? 0, is = now[f] ?? 0;
    if (is > was) msgs.push(`${f}: ${was} -> ${is} CEILING markers (a new simplification; bank it with --bank and say why)`);
    else if (is < was) msgs.push(`${f}: ${was} -> ${is} CEILING markers (one was removed: bank the improvement with --bank)`);
  }
  return msgs;
}

const total = (c) => Object.values(c).reduce((a, b) => a + b, 0);

function selfTest() {
  const must = (ok, m) => { if (!ok) throw new Error(`self-test failed: ${m}`); };
  must(countIn("a\n// CEILING: x\nb CEILING: y // CEILING: z\n") === 2, "a line counts once");
  must(countIn("// ceiling: no\n") === 0, "the marker is case-sensitive");
  must(inScope("pkg/src/x.ts") && inScope("pkg/x.tsx"), "source is in scope");
  must(!inScope("pkg/src/x.test.ts") && !inScope("pkg/x.test.tsx"), "a test is out of scope");
  must(!inScope("pkg/src/x.json"), "only ts and tsx count");
  must(compare({ "a.ts": 2 }, { "a.ts": 2 }).length === 0, "an equal count passes");
  must(compare({ "a.ts": 2 }, { "a.ts": 3 }).length === 1, "a RISE must fail");
  must(compare({ "a.ts": 2 }, { "a.ts": 1 }).length === 1, "a FALL must fail until banked");
  must(compare({}, { "new.ts": 1 }).length === 1, "a new file with a marker must fail");
  must(compare({ "gone.ts": 1 }, {}).length === 1, "a file that lost its last marker must fail");
  must(format({ "b.ts": 1, "a.ts": 2 }) === '{\n  "a.ts": 2,\n  "b.ts": 1\n}\n', "the snapshot is sorted and stable");
  console.log("self-test: both directions fire");
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) { selfTest(); return 0; }
  const now = measure();
  if (args.includes("--bank")) {
    writeFileSync(SNAPSHOT, format(now));
    console.log(`banked: ${total(now)} CEILING markers in ${Object.keys(now).length} files`);
    return 0;
  }
  const msgs = compare(JSON.parse(readFileSync(SNAPSHOT, "utf8")), now);
  for (const m of msgs) console.log(m);
  if (msgs.length) {
    console.log(`\n${msgs.length} file(s) moved. The CEILING count is a both-ways ratchet: \`node scripts/check_ceiling_count.mjs --bank\` rewrites scripts/ceiling-counts.json.`);
    return 1;
  }
  console.log(`CEILING markers: ${total(now)} in ${Object.keys(now).length} files, as banked`);
  return 0;
}

process.exitCode = main();
