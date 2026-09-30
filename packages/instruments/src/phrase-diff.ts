/** FREE, no database. Runs a candidate subject parser against `parseSubject` over the phrase census
 *  (#896, task 1). See `phrase-diff-core.ts`.
 *
 *    npx tsx packages/instruments/src/phrase-diff.ts                  # the baseline: parseSubject per phrase
 *    npx tsx packages/instruments/src/phrase-diff.ts <parser module>  # the diff; the module exports `parse`
 *
 *  Refresh the census first when the clauses change: `npx tsx packages/tagger/src/bin/extract-phrases.ts`.
 *  Output goes to `docs/measurements/card-grammar/` (local-only). Run from the repo root. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseSubject } from "@edh-seer/tagger/subject";
import { diffParsers, readPhrases, type Parser } from "./phrase-diff-core.js";

const OUT = "docs/measurements/card-grammar";
const phrases = readPhrases(readFileSync("packages/tagger/phrases.jsonl", "utf8"));
mkdirSync(OUT, { recursive: true });
const pct = (n: number, d: number) => `${(100 * n / d).toFixed(1)}%`;

const modulePath = process.argv[2];
if (!modulePath) {
  const lines = phrases.map((p) => JSON.stringify({ ...p, filter: parseSubject(p.phrase) }));
  writeFileSync(`${OUT}/baseline.jsonl`, lines.join("\n") + "\n");
  const empty = phrases.filter((p) => Object.keys(parseSubject(p.phrase)).every((k) => ["control", "token"].includes(k)));
  const cards = phrases.reduce((n, p) => n + p.cards, 0), emptyCards = empty.reduce((n, p) => n + p.cards, 0);
  console.log(`baseline: ${phrases.length} phrases, ${cards} card-occurrences -> ${OUT}/baseline.jsonl`);
  console.log(`parseSubject names no class (control/token only) for ${empty.length} phrases (${pct(empty.length, phrases.length)}), ${emptyCards} card-occurrences (${pct(emptyCards, cards)})`);
} else {
  const parse = (await import(pathToFileURL(resolve(modulePath)).href)).parse as Parser;
  const d = diffParsers(phrases, parse, parseSubject);
  writeFileSync(`${OUT}/phrase-diff.json`, JSON.stringify(d, null, 1) + "\n");
  console.log(`parsed completely: ${d.parsed.distinct}/${d.total.distinct} distinct (${pct(d.parsed.distinct, d.total.distinct)}), ${pct(d.parsed.cards, d.total.cards)} of card-occurrences`);
  console.log(`agree with parseSubject: ${d.agree.distinct} distinct, ${pct(d.agree.cards, d.parsed.cards || 1)} of parsed card-occurrences`);
  console.log(`nondeterministic: ${d.nondeterministic.length}`);
  console.log(`disagreement groups: ${d.groups.length}`);
  for (const g of d.groups.slice(0, 15)) console.log(`  ${g.fields.join(",").padEnd(30)} ${String(g.distinct).padStart(6)} phrases ${String(g.cards).padStart(7)} cards  e.g. "${g.examples[0]!.phrase}"`);
  console.log(`-> ${OUT}/phrase-diff.json`);
}
