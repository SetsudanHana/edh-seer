/** Generate `derive/cr-keywords.json` — the Comprehensive Rules' own keyword lists — from the cached
 *  rules text. Free: no key, no model, no network beyond the one cached download.
 *
 *  CHECKED IN, deliberately, exactly like `vocabulary.json` from MTGJSON. The rules text itself is a
 *  933 KB gitignored cache, and a TEST that reads a gitignored download is the `.cs-cache` mistake
 *  this repo already lives with — red in every fresh clone. A small generated JSON is committed
 *  instead, so `vocabulary.test.ts` can assert completeness offline and CI stays green.
 *
 *    tsx src/bin/gen-cr-keywords.ts           # regenerate from the cached rules
 *    tsx src/bin/gen-cr-keywords.ts --check   # non-zero exit if the committed file has drifted
 *
 *  Run it after `fetch-comp-rules.ts` pulls a new rules version. Drift means WotC printed a new
 *  keyword — which is exactly the event this whole apparatus exists to catch before the corpus is
 *  normalized without a word for it. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const CACHE = ".cr-cache";
const OUT = "packages/tagger/src/derive/cr-keywords.json";
const CHECK = process.argv.includes("--check");

const file = readdirSync(CACHE).filter((f) => f.endsWith(".txt")).sort().pop();
if (!file) throw new Error(`no cached rules in ${CACHE} — run fetch-comp-rules.ts first`);
const cr = readFileSync(`${CACHE}/${file}`, "utf8");

/** A section heading is "701.4. Behold" — the rule number, then a SHORT title on its own line. The
 *  first rule of each section is prose ("701.1. Most actions described in...") and is excluded by
 *  the length cap plus the trailing-punctuation test. */
const headings = (prefix: string): string[] =>
  [...cr.matchAll(new RegExp(`^${prefix}\\.\\d+\\. (.{2,45})$`, "gm"))]
    .map((m) => m[1].trim())
    .filter((t) => !/[.,;:]$/.test(t) && !/^most /i.test(t));

const out = {
  version: file.replace(/\D/g, ""),
  actions: headings("701"),
  abilities: headings("702"),
  // Every CR 7xx section — "Additional Rules", where the game puts its per-mechanic rules (Saga is
  // 714, Adventure 715, Omen 720, the monarch 725). Committed so `cr-completeness.test.ts` can
  // require a verdict for each without reading the gitignored rules cache.
  sections: [...new Map([...cr.matchAll(/^(7\d\d)\. ([A-Z][^\n]{2,50})$/gm)]
    .map((m) => [m[1], m[2].trim()] as [string, string])).entries()]
    .map(([rule, name]) => ({ rule, name })),
};

const json = `${JSON.stringify(out, null, 2)}\n`;

if (CHECK) {
  const current = readFileSync(OUT, "utf8");
  if (current !== json) {
    const was = JSON.parse(current) as typeof out;
    const added = out.actions.filter((a) => !was.actions.includes(a));
    const gone = was.actions.filter((a) => !out.actions.includes(a));
    console.error(`DRIFT: ${OUT} is stale (committed ${was.version}, rules ${out.version})`);
    if (added.length) console.error(`  new keyword actions: ${added.join(", ")}`);
    if (gone.length) console.error(`  removed: ${gone.join(", ")}`);
    process.exit(1);
  }
  console.log(`cr-keywords.json is current (rules ${out.version}, ${out.actions.length} actions, ${out.abilities.length} abilities)`);
  process.exit(0);
}

writeFileSync(OUT, json);
console.log(`wrote ${OUT}: ${out.actions.length} keyword actions, ${out.abilities.length} keyword abilities, ${out.sections.length} 7xx sections (rules ${out.version})`);
