/** FREE, no database. Runs a candidate trigger parser against the stored triggers over the trigger
 *  census (#896, task 5). See `trigger-diff-core.ts`.
 *
 *    npx tsx packages/instruments/src/trigger-diff.ts                  # the census: events, controls, conditions
 *    npx tsx packages/instruments/src/trigger-diff.ts <parser module>  # the diff; the module exports `parseTrigger`
 *
 *  Refresh the census first when the clauses change: `npx tsx packages/tagger/src/bin/extract-triggers.ts`.
 *  Output goes to `docs/measurements/card-grammar/` (local-only). Run from the repo root. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "@edh-seer/tagger/grammar";
import { isSelfSubject } from "@edh-seer/tagger/self-reference";
import { parseSubject } from "@edh-seer/tagger/subject";
import { diffTriggers, readTriggers, type TriggerParser } from "./trigger-diff-core.js";

const OUT = "docs/measurements/card-grammar";
const rows = readTriggers(readFileSync("packages/tagger/triggers.jsonl", "utf8"));
mkdirSync(OUT, { recursive: true });
const pct = (n: number, d: number) => `${(100 * n / d).toFixed(1)}%`;
// Derive's own subject reader since #896 task 3: the filter grammar first, parseSubject after.
const subjectOf = (text: string) => parse(text) ?? parseSubject(text);
const isSelf = (text: string) => text.trim() === "~" || isSelfSubject(text);

const modulePath = process.argv[2];
if (!modulePath) {
  const cards = rows.reduce((n, r) => n + r.cards, 0);
  const tally = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + r.cards);
    return [...m].sort((a, b) => b[1] - a[1]);
  };
  console.log(`census: ${rows.length} distinct rows, ${cards} card-uses, ${new Set(rows.map((r) => r.preamble)).size} distinct preambles`);
  const withIf = rows.filter((r) => r.condition !== null);
  console.log(`intervening if: ${withIf.length} rows, ${withIf.reduce((n, r) => n + r.cards, 0)} card-uses`);
  console.log(`events: ${tally((r) => r.event ?? "none").slice(0, 30).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  console.log(`controls: ${tally((r) => r.control ?? "none").map(([k, v]) => `${k} ${v}`).join(" · ")}`);
} else {
  const parseTrigger = (await import(pathToFileURL(resolve(modulePath)).href)).parseTrigger as TriggerParser;
  const d = diffTriggers(rows, parseTrigger, subjectOf, isSelf);
  writeFileSync(`${OUT}/trigger-diff.json`, JSON.stringify(d, null, 1) + "\n");
  console.log(`parsed completely: ${d.parsed.distinct}/${d.total.distinct} distinct (${pct(d.parsed.distinct, d.total.distinct)}), ${pct(d.parsed.cards, d.total.cards)} of card-uses`);
  console.log(`agree with the stored trigger: ${d.agree.distinct} distinct, ${pct(d.agree.cards, d.parsed.cards || 1)} of parsed card-uses`);
  console.log(`nondeterministic: ${d.nondeterministic.length}`);
  console.log(`disagreement groups: ${d.groups.length}`);
  for (const g of d.groups.slice(0, Number(process.env.GROUPS ?? 20))) console.log(`  ${g.fields.join(",").padEnd(36)} ${String(g.distinct).padStart(6)} rows ${String(g.cards).padStart(7)} cards  e.g. "${g.examples[0]!.row.preamble}"`);
  console.log(`-> ${OUT}/trigger-diff.json`);
}
