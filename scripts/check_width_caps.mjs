#!/usr/bin/env node
/** NO EMPTY BAND: a wide screen buys columns, never a narrow strip in the middle of it.
 *
 *  Owner, 2026-09-28: "you constantly waste space ... 2k or 4k monitors as a standard and phone which
 *  is 390px, but there are sections after sections that are basically ignoring how I am pointing out
 *  those wasting space cases". The rule was already written down (`packages/web/DESIGN.md`, The
 *  Width-Buys-Columns Rule) and nothing enforced it: 13 page and section containers were capped at
 *  `max-w-5xl` (1024px), which leaves ~900px blank at 1920 and ~1,500px at 2560. Issue #770.
 *
 *  WHAT IS A WIDTH CAP HERE: a Tailwind `max-w-xl`..`max-w-7xl`, an arbitrary `max-w-[N px|rem]`, or
 *  a CSS `max-width: N px|rem`, at 36rem (576px) or wider. Narrower caps size a component (a dial, a
 *  chart, a chip); they are not a page layout. A `ch` cap is a LINE LENGTH for prose and passes -- it
 *  is the one cap DESIGN.md asks for. A cap inside `@media (max-width: ...)` only applies on a narrow
 *  screen and passes too.
 *
 *  THE ALLOWLIST IS TODAY'S INVENTORY OF OFFENDERS, NOT A LIST OF EXCEPTIONS. Each entry is a file, a
 *  token and a count, with the reason it is still there. It ratchets BOTH ways, like every other gate
 *  in this directory: a new cap fails, and so does an entry that no longer matches -- a fixed page
 *  must shrink the list in the same PR, or the next cap could hide in the slack.
 *
 *  Run: node scripts/check_width_caps.mjs [--self-test]
 *  Node built-ins only, no install step. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN = ["packages/web/client/src", "packages/web/client/index.html", "packages/web/functions"];
const ALLOW = join(ROOT, "scripts/width-caps-allowlist.json");
const MIN_REM = 36;
const TW = { xl: 36, "2xl": 42, "3xl": 48, "4xl": 56, "5xl": 64, "6xl": 72, "7xl": 80 };

const rem = (n, unit) => (unit === "px" ? n / 16 : n);

/** Every width cap in one file's text, as `max-w-5xl` / `max-w-[88rem]` / `max-width: 64rem`. */
export function scan(text, css) {
  const out = [];
  // Comments do not style anything; drop them first so a CSS note that NAMES a cap is not one.
  if (css) {
    for (let a = text.indexOf("/*"); a >= 0; a = text.indexOf("/*")) {
      const z = text.indexOf("*/", a + 2);
      text = text.slice(0, a) + (z < 0 ? "" : text.slice(z + 2));
    }
  }
  for (const m of text.matchAll(/(?<![\w-])max-w-(xl|[2-7]xl|\[([\d.]+)(px|rem)\])(?![\w-])/g)) {
    const width = m[2] ? rem(Number(m[2]), m[3]) : TW[m[1]];
    if (width >= MIN_REM) out.push(m[0]);
  }
  if (css) {
    // A declaration inside `@media (max-width: ...)` is a narrow-screen rule; strip those blocks by
    // brace depth before reading declarations. String ops, not a nested regex (CodeQL redos rule).
    let kept = "", depth = 0, skipAt = -1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") {
        const head = text.slice(text.lastIndexOf("}", i) + 1, i);
        if (skipAt < 0 && head.includes("@media") && head.includes("max-width")) skipAt = depth;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === skipAt) { skipAt = -1; continue; }
      }
      if (skipAt < 0) kept += ch;
    }
    for (const m of kept.matchAll(/(?<![(\w-])max-width:\s*([\d.]+)(px|rem)/g)) {
      if (rem(Number(m[1]), m[2]) >= MIN_REM) out.push(`max-width: ${m[1]}${m[2]}`);
    }
  }
  return out;
}

/** `{file: {token: count}}` for the given files. */
export function inventory(files) {
  const found = {};
  for (const [path, text] of files) {
    if (/\.test\.[jt]sx?$/.test(path)) continue;
    for (const t of scan(text, path.endsWith(".css"))) {
      found[path] ??= {};
      found[path][t] = (found[path][t] ?? 0) + 1;
    }
  }
  return found;
}

/** Errors for caps beyond the allowlist, and for allowlist entries that no longer match. */
export function check(found, allow) {
  const errors = [];
  for (const [file, tokens] of Object.entries(found)) {
    for (const [token, n] of Object.entries(tokens)) {
      const a = allow[file]?.[token]?.count ?? 0;
      if (n > a) errors.push(`${file}: ${n - a} new \`${token}\` -- a wide screen buys columns, not a narrow band (DESIGN.md, The Empty Band)`);
    }
  }
  for (const [file, tokens] of Object.entries(allow)) {
    for (const [token, { count }] of Object.entries(tokens)) {
      const n = found[file]?.[token] ?? 0;
      if (n < count) errors.push(`${file}: allowlist holds ${count} \`${token}\`, the file has ${n} -- shrink scripts/width-caps-allowlist.json to bank the fix`);
    }
  }
  return errors;
}

function walk(p, out) {
  const want = (name) => /\.(tsx?|css|html)$/.test(name);
  let entries;
  try {
    entries = readdirSync(join(ROOT, p), { withFileTypes: true });
  } catch {
    // Not a directory: a single file named in SCAN. Read it directly, no stat first (a stat-then-read
    // is a file-system race, CodeQL js/file-system-race).
    if (want(p)) { try { out.push([p, readFileSync(join(ROOT, p), "utf8")]); } catch { /* absent */ } }
    return;
  }
  for (const e of entries) {
    const q = join(p, e.name);
    if (e.isDirectory()) walk(q, out);
    else if (e.isFile() && want(e.name)) out.push([q, readFileSync(join(ROOT, q), "utf8")]);
  }
}

function selfTest() {
  const eq = (a, b, what) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`self-test: ${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`);
  };
  eq(scan(`<div className="max-w-5xl mx-auto">`, false), ["max-w-5xl"], "a page cap is found");
  eq(scan(`<p className="max-w-[65ch]">`, false), [], "a prose line length passes");
  eq(scan(`<svg className="max-w-[420px]">`, false), [], "a component-sized cap passes");
  eq(scan(`<div className="max-w-[88rem]">`, false), ["max-w-[88rem]"], "an arbitrary rem cap is found");
  eq(scan(`<div className="md:max-w-5xl">`, false), ["max-w-5xl"], "a responsive prefix is still a cap");
  eq(scan(`.a { max-width: 64rem; } .b { max-width: 65ch; }`, true), ["max-width: 64rem"], "css rem cap found, ch passes");
  eq(scan(`@media (max-width: 40rem) { .a { max-width: 64rem; } } .b { max-width: 72rem; }`, true), ["max-width: 72rem"], "a narrow-screen media block passes");
  eq(scan(`/* @media (max-width: 9rem) note, max-w-5xl */\n.a { max-width: 64rem; }`, true), ["max-width: 64rem"], "a CSS comment is not a cap");
  const found = inventory([["a.tsx", `max-w-5xl max-w-5xl`], ["a.test.tsx", `max-w-7xl`]]);
  eq(found, { "a.tsx": { "max-w-5xl": 2 } }, "tests are not scanned");
  eq(check(found, { "a.tsx": { "max-w-5xl": { count: 2, why: "x" } } }), [], "an allowlisted cap passes");
  eq(check(found, { "a.tsx": { "max-w-5xl": { count: 1, why: "x" } } }).length, 1, "a NEW cap fails");
  eq(check(found, { "a.tsx": { "max-w-5xl": { count: 3, why: "x" } } }).length, 1, "a STALE allowlist entry fails");
  console.log("width caps self-test: ok (12 checks)");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const files = [];
  for (const p of SCAN) walk(p, files);
  const found = inventory(files.map(([p, t]) => [relative(ROOT, join(ROOT, p)), t]));
  const allow = JSON.parse(readFileSync(ALLOW, "utf8")).files;
  const errors = check(found, allow);
  const total = Object.values(allow).flatMap((t) => Object.values(t)).reduce((s, e) => s + e.count, 0);
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`);
    console.error(`\nwidth caps: ${errors.length} problem(s). See packages/web/DESIGN.md, The Empty Band.`);
    process.exit(1);
  }
  console.log(`width caps: ok -- ${total} allowlisted cap(s) left to fix (#770)`);
}
