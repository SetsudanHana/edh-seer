/** FREE, no database. Runs a candidate action parser against the stored actions over the action
 *  census (#896, task 6). See `action-diff-core.ts`.
 *
 *    npx tsx packages/instruments/src/action-diff.ts                  # the census, per family
 *    npx tsx packages/instruments/src/action-diff.ts <parser module>  # the diff; the module exports `parseActions`
 *
 *  Refresh the census first when the clauses change: `npx tsx packages/tagger/src/bin/extract-actions.ts`.
 *  Output goes to `docs/measurements/card-grammar/` (local-only). Run from the repo root. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { parse } from "@edh-seer/tagger/grammar";
import { parseSubject } from "@edh-seer/tagger/subject";
import { diffActions, FAMILIES, familyOf, readActions, type ActionParser } from "./action-diff-core.js";

const OUT = "docs/measurements/card-grammar";
const rows = readActions(gunzipSync(readFileSync("packages/tagger/actions.jsonl.gz")).toString("utf8"));
mkdirSync(OUT, { recursive: true });
const pct = (n: number, d: number) => `${(100 * n / (d || 1)).toFixed(1)}%`;
// Derive's own subject reader since #896 task 3: the filter grammar first, parseSubject after.
const subjectOf = (text: string) => parse(text) ?? parseSubject(text);

const modulePath = process.argv[2];
if (!modulePath) {
  const by = new Map<string, { actions: number; cards: number; verbs: Map<string, number> }>();
  for (const r of rows) for (const a of r.actions) {
    const f = familyOf(a.verb);
    const e = by.get(f) ?? by.set(f, { actions: 0, cards: 0, verbs: new Map() }).get(f)!;
    e.actions++; e.cards += r.cards; e.verbs.set(a.verb, (e.verbs.get(a.verb) ?? 0) + r.cards);
  }
  console.log(`census: ${rows.length} distinct rows, ${rows.reduce((n, r) => n + r.actions.length, 0)} distinct actions, ${rows.reduce((n, r) => n + r.cards * r.actions.length, 0)} action uses`);
  for (const f of FAMILIES) {
    const e = by.get(f);
    if (!e) continue;
    console.log(`  ${f.padEnd(12)} ${String(e.actions).padStart(6)} distinct ${String(e.cards).padStart(7)} uses   ${[...e.verbs].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => `${v} ${n}`).join(" · ")}`);
  }
} else {
  const parseActions = (await import(pathToFileURL(resolve(modulePath)).href)).parseActions as ActionParser;
  const d = diffActions(rows, parseActions, subjectOf);
  writeFileSync(`${OUT}/action-diff.json`, JSON.stringify(d, null, 1) + "\n");
  for (const f of FAMILIES) {
    const t = d.families[f];
    console.log(`${f.padEnd(12)} parsed ${pct(t.parsed.actions, t.total.actions)} distinct, ${pct(t.parsed.cards, t.total.cards)} of uses; agree ${pct(t.agree.cards, t.parsed.cards)} of parsed uses`);
  }
  console.log(`nondeterministic: ${d.nondeterministic.length}`);
  console.log(`disagreement groups: ${d.groups.length}`);
  for (const g of d.groups.slice(0, Number(process.env.GROUPS ?? 20))) console.log(`  ${g.family.padEnd(12)} ${g.fields.join(",").padEnd(36)} ${String(g.actions).padStart(6)} ${String(g.cards).padStart(7)} cards  e.g. "${g.examples[0]!.row.effect.slice(0, 80)}"`);
  console.log(`-> ${OUT}/action-diff.json`);
}
