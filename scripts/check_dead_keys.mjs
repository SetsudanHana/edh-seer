#!/usr/bin/env node
/** No literal `<verb>:any` for a verb that has an implied class (#1268 part C, F11).
 *
 *  `VERB_IMPLIED_CLASS` (tagger `schema.ts`, owner ruling 2026-10-10, #1166) fills the class a verb
 *  implies at read time, so `zoneEventKey` can no longer emit `enters:any`, `cast:any`, `dies:any`,
 *  `attacks:any` and the rest. A string literal that still names one is a dead key: in source it is
 *  a lookup that never matches, in a test or a fixture it pins the FALLBACK instead of the product
 *  (34 test hits in 19 files and 7 graph fixtures when this gate was written).
 *
 *  The verb list is READ from `schema.ts`, never copied here, so a verb added to the table is
 *  covered the day it lands. A line that must keep the dead key on purpose (a test proving the key
 *  is gone, or the fallback itself) carries `dead-key-ok` and a reason. Comment lines are not
 *  scanned; prose may name the key it retired.
 *
 *  Scope: `.ts`/`.tsx` under packages/ and research/, plus the web graph fixtures, skipping
 *  node_modules and dist.
 *
 *  Run: node scripts/check_dead_keys.mjs [--self-test]. Node built-ins only. */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA = join(ROOT, "packages", "tagger", "src", "schema.ts");
const OK_MARK = "dead-key-ok";

/** The verbs of `VERB_IMPLIED_CLASS`, parsed out of the schema source. */
export function impliedVerbs(schemaSource) {
  const m = /export const VERB_IMPLIED_CLASS[^=]*=\s*\{([^}]*)\}/.exec(schemaSource);
  if (!m) throw new Error("VERB_IMPLIED_CLASS not found in schema.ts");
  const verbs = [...m[1].matchAll(/^\s*(?:"([a-z-]+)"|([a-z]+))\s*:/gm)].map((x) => x[1] ?? x[2]);
  if (verbs.length === 0) throw new Error("VERB_IMPLIED_CLASS has no rows");
  return verbs;
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A quoted `verb:any` whose verb is not the tail of a longer one (`non-combat-damage`). */
export function deadKeyPattern(verbs) {
  return new RegExp(String.raw`["'\`](?:${verbs.map(escape).join("|")}):any(?![\w-])`);
}

/** A line's code: empty for a comment line, a trailing `// ...` comment cut off. */
function code(line) {
  const t = line.trim();
  if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
  return line.replace(/\s\/\/.*$/, "");
}

/** `json` files have no comments, and a fixture is ONE line, so each match is counted, not each line. */
export function scanSource(text, re, json = false) {
  const hits = [];
  if (json) {
    const all = new RegExp(re.source, "g");
    for (const m of text.matchAll(all)) hits.push({ line: 1, text: text.slice(Math.max(0, m.index - 20), m.index + 40) });
    return hits;
  }
  text.split("\n").forEach((line, i) => {
    if (line.includes(OK_MARK)) return;
    if (re.test(code(line))) hits.push({ line: i + 1, text: line.trim().slice(0, 120) });
  });
  return hits;
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile()) out.push(p);
  }
  return out.sort();
}

const inScope = (f) => /\.(ts|tsx)$/.test(f) || /web\/client\/src\/fixtures\/[^/]+\.json$/.test(f);

function selfTest() {
  const verbs = impliedVerbs(readFileSync(SCHEMA, "utf8"));
  const must = (ok, m) => { if (!ok) throw new Error(`self-test failed: ${m}`); };
  must(["cast", "enters", "dies", "attacks", "combat-damage"].every((v) => verbs.includes(v)), "the verb list must come from schema.ts");
  const re = deadKeyPattern(verbs);
  must(scanSource('const k = "dies:any";', re).length === 1, "a dead key literal must fire");
  must(scanSource("tags: [`enters:any`]", re).length === 1, "a template literal must fire");
  must(scanSource('{"a":1,"tags":["attacks:any"],"b":["dies:any"]}', re, true).length === 2, "a one-line fixture counts every key");
  must(scanSource('const k = "dies:creature";', re).length === 0, "a filled key must NOT fire");
  must(scanSource('const k = "draw:any";', re).length === 0, "a verb with no implied class must NOT fire");
  must(scanSource('const k = "non-combat-damage:any";', re).length === 0, "a longer verb must NOT fire");
  must(scanSource('const k = "enters-graveyard:any";', re).length === 0, "enters-graveyard is another verb");
  must(scanSource("// the old `enters:any` key", re).length === 0, "prose in a comment must NOT fire");
  must(scanSource('expect(x).not.toContain("attacks:any"); // dead-key-ok: proves it is gone', re).length === 0, "the marker must excuse a line");
  console.log("self-test: both directions fire");
}

function main() {
  if (process.argv.includes("--self-test")) { selfTest(); return 0; }
  const re = deadKeyPattern(impliedVerbs(readFileSync(SCHEMA, "utf8")));
  let total = 0;
  for (const base of ["packages", "research"]) {
    for (const f of walk(join(ROOT, base))) {
      if (!inScope(f)) continue;
      for (const h of scanSource(readFileSync(f, "utf8"), re, f.endsWith(".json"))) {
        console.log(`${relative(ROOT, f)}:${h.line}: ${h.text}`);
        total++;
      }
    }
  }
  if (total) {
    console.log(`\n${total} dead key(s). A verb in VERB_IMPLIED_CLASS never emits \`<verb>:any\`; \`zoneEventKey\` fills the class. `
      + `Use the filled key (\`dies:creature\`), or mark a line that proves the key is gone with \`${OK_MARK}: reason\`.`);
    return 1;
  }
  console.log("dead keys: none");
  return 0;
}

process.exitCode = main();
