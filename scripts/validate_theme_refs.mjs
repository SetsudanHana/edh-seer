#!/usr/bin/env node
/** Verify every CSS variable a component references is DEFINED in the shared theme.
 *
 *  This is the precision gate: a component that uses var(--color-foo) which the theme never
 *  defines renders wrong (a "floating token" = drift = inconsistency across pages). It also
 *  proves theme + components stay in lock-step.
 *
 *  Usage (`npm run tokens:check` passes these):
 *    node scripts/validate_theme_refs.mjs tokens/theme.css packages/web/client/src
 *  Exit 0 = every referenced var is defined; 1 = a component references an undefined token. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";

const DEF = /(--[A-Za-z0-9_-]+)\s*:/g;                        // --x: value  (a definition)
const REF = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,[^)]*)?\)/g;     // var(--x) or var(--x, fallback)
const CODE_EXT = new Set([".css", ".scss", ".tsx", ".jsx", ".ts", ".js", ".vue", ".svelte", ".html", ".astro"]);
// A test may quote var(--x) as a FIXTURE -- a string it asserts about, not a token it renders.
// Scanning tests reported three "floating tokens" that no component references.
const TEST_MARKERS = [".test.", ".spec."];

const isCode = (f) => CODE_EXT.has(extname(f)) && !TEST_MARKERS.some((m) => basename(f).includes(m));
const kind = (p) => { try { const s = statSync(p); return s.isDirectory() ? "dir" : s.isFile() ? "file" : null; } catch { return null; } };

function collectDefs(themePaths) {
  const defined = new Set();
  for (const p of themePaths) {
    if (kind(p) !== "file") continue;
    for (const m of readFileSync(p, "utf8").matchAll(DEF)) defined.add(m[1]);
  }
  return defined;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && isCode(p)) yield p;
  }
}

function* iterFiles(paths) {
  for (const p of paths) {
    const k = kind(p);
    if (k === "dir") yield* walk(p);
    else if (k === "file" && isCode(p)) yield p;
  }
}

function main(argv) {
  if (argv.length < 2) {
    console.error("usage: validate_theme_refs.mjs THEME.css CODE_DIR [CODE_DIR ...]");
    return 2;
  }
  const themePaths = [argv[0]];
  const codePaths = argv.slice(1);

  const defined = collectDefs(themePaths);
  if (!defined.size) {
    console.log(`ERROR: no CSS variables defined in theme (${themePaths.join(", ")}).`);
    return 1;
  }

  const missing = [];
  for (const f of iterFiles(codePaths)) {
    let text;
    try { text = readFileSync(f, "utf8"); } catch { continue; }
    text.split(/\r\n|\r|\n/).forEach((line, i) => {
      for (const m of line.matchAll(REF)) {
        if (!defined.has(m[1])) missing.push(`${f}:${i + 1}: var(${m[1]}) is NOT defined in the theme`);
      }
    });
  }

  console.log(`Theme defines ${defined.size} tokens.`);
  if (missing.length) {
    console.log(`\nFAIL: ${missing.length} reference(s) to undefined theme token(s):`);
    for (const m of missing) console.log("  x " + m);
    return 1;
  }
  console.log("OK: every component token reference resolves to a defined theme token.");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
