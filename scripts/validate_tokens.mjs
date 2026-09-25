#!/usr/bin/env node
/** Validate DTCG token files.
 *
 *  Checks:
 *    1. Every token file parses as valid JSON.
 *    2. Every {alias.reference} resolves to a token defined in the same set.
 *
 *  Usage:
 *    node scripts/validate_tokens.mjs                    # the engine's tokens/ directory
 *    node scripts/validate_tokens.mjs design-tokens.json # any file or directory
 *
 *  With explicit paths the set is treated as self-contained, so an unresolved alias
 *  FAILS. The default tokens/ run only warns, because a reference there may point at
 *  a token that is about to be added.
 *  Exit code 0 = all good, 1 = problems found. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = join(ROOT, "tokens");
const ALIAS = /\{([^}]+)\}/g;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const kind = (p) => { try { const s = statSync(p); return s.isDirectory() ? "dir" : s.isFile() ? "file" : null; } catch { return null; } };
const jsonFiles = (dir) => readdirSync(dir).filter((n) => n.endsWith(".json")).sort().map((n) => join(dir, n));

/** Dotted token paths that have a $value (DTCG leaf tokens). A Map, so keys keep the file's own
 *  order: a plain object would move numeric keys like `100` to the front. */
function flatten(obj, prefix = "", out = new Map()) {
  if (!isObject(obj)) return out;
  if ("$value" in obj) out.set(prefix, obj.$value);
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith("$")) continue;
    flatten(v, prefix ? `${prefix}.${k}` : k, out);
  }
  return out;
}

/** Every {ref} string inside a value (which may be nested). */
function collectAliases(value) {
  if (typeof value === "string") return [...value.matchAll(ALIAS)].map((m) => m[1]);
  if (Array.isArray(value)) return value.flatMap(collectAliases);
  if (isObject(value)) return Object.values(value).flatMap(collectAliases);
  return [];
}

function main(argv) {
  const explicit = argv.filter((a) => !a.startsWith("-"));
  let files = [];
  if (explicit.length) {
    for (const p of explicit) {
      const k = kind(p);
      if (k === "dir") files.push(...jsonFiles(p));
      else if (k === "file") files.push(p);
      else { console.log(`ERROR: ${p} not found`); return 1; }
    }
  } else {
    if (kind(TOKENS) !== "dir") { console.log(`ERROR: ${TOKENS} not found`); return 1; }
    files = jsonFiles(TOKENS);
  }
  if (!files.length) { console.log("ERROR: no token files found"); return 1; }

  const allTokens = new Set();
  const errors = [];

  // Pass 1: parse + collect every defined token path (per file namespace + global).
  const parsed = new Map();
  for (const f of files) {
    let data;
    try {
      data = JSON.parse(readFileSync(f, "utf8"));
    } catch (e) {
      errors.push(`${basename(f)}: invalid JSON — ${e.message}`);
      continue;
    }
    parsed.set(f, data);
    const stem = basename(f, extname(f));
    for (const path of flatten(data).keys()) {
      allTokens.add(path);             // e.g. "duration.fast"
      allTokens.add(`${stem}.${path}`); // e.g. "motion.duration.fast"
    }
  }

  // Pass 2: resolve aliases.
  const unresolved = [];
  for (const [f, data] of parsed) {
    for (const [path, val] of flatten(data)) {
      for (let ref of collectAliases(val)) {
        ref = ref.trim();
        // Normalize cross-file refs like {../colors.semantic.border.default}.
        let norm = ref;
        while (norm.startsWith("../") || norm.startsWith("./")) norm = norm.slice(norm.startsWith("../") ? 3 : 2);
        if (allTokens.has(ref) || allTokens.has(norm)) continue;
        // Tolerate cross-file refs that omit the file prefix.
        const dot = norm.indexOf(".");
        if (allTokens.has(dot === -1 ? norm : norm.slice(dot + 1))) continue;
        if ([...allTokens].some((k) => k.endsWith(norm))) continue;
        unresolved.push(`${basename(f)}: ${path} → {${ref}} (unresolved)`);
      }
    }
  }

  console.log(`Parsed ${parsed.size}/${files.length} token files, ${Math.floor(allTokens.size / 2)} tokens defined.`);
  for (const e of errors) console.log("  x " + e);
  for (const u of unresolved) console.log("  ! " + u);

  if (errors.length) { console.log("\nFAIL: JSON errors above."); return 1; }
  if (unresolved.length) {
    if (explicit.length) {
      console.log(`\nFAIL: ${unresolved.length} unresolved alias(es) in a self-contained token set.`);
      return 1;
    }
    console.log(`\nWARN: ${unresolved.length} unresolved alias(es) — may reference tokens to be added.`);
    // Warnings don't fail the build.
  }
  console.log("\nOK: all token files valid JSON.");
  return 0;
}

process.exitCode = main(process.argv.slice(2));
