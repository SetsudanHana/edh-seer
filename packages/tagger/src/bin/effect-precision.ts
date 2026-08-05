/** Precision check for the EFFECT_ACTIONS table — free, no LLM.
 *
 *  A derived verb is handed to the model as fact, and the prompt tells it to record those actions
 *  verbatim. So a false positive is worse than the `other` it replaces: a wrong verb is consumed as
 *  if it were true, while `other` is at least honestly inert. This scores the table against model
 *  output already collected, using the clauses where two independent runs AGREED — the subset
 *  measured at 80% correct, and the closest thing to ground truth available without spending
 *  credits.
 *
 *  Usage: tsx src/bin/effect-precision.ts /tmp/nx-pw3 /tmp/nx-struct3 /tmp/nx-rand3 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { effectActions, type Clause } from "../segment.js";

interface Rec { id: number; actions?: { verb?: string }[] }
interface Row { name: string; clauses: Clause[]; output: { clauses?: Rec[]; ERROR?: string } }

const dirs = process.argv.slice(2);
if (dirs.length === 0) { console.error("usage: effect-precision.ts <runDir>..."); process.exit(1); }

let agreed = 0, predicted = 0, hit = 0;
const misses = new Map<string, string[]>();
const rescued: string[] = [];
/** The case the table actually exists for: the two runs DISAGREED, so reconciliation has to pick a
 *  side or flag the clause. A verb the table can derive is a verb neither run had to choose. */
let disagreed = 0, disagreedPinned = 0, disagreedOther = 0, disagreedOtherPinned = 0;
const pinnedEx: string[] = [];

for (const dir of dirs) {
  const load = (f: string): Row[] => JSON.parse(readFileSync(join(dir, f), "utf8")) as Row[];
  const r1 = load("run1.json"), r2 = load("run2.json");
  for (const a of r1) {
    const b = r2.find((x) => x.name === a.name);
    if (!b || a.output.ERROR || b.output.ERROR) continue;
    for (const clause of a.clauses) {
      const verbs = (o: Row["output"]): string[] =>
        [...new Set((o.clauses?.find((c) => c.id === clause.id)?.actions ?? []).map((x) => x.verb ?? ""))].sort();
      const v1 = verbs(a.output), v2 = verbs(b.output);
      if (v1.length === 0 && v2.length === 0) continue;
      if (JSON.stringify(v1) !== JSON.stringify(v2)) {
        disagreed++;
        const pred = effectActions(clause.text, clause.kind);
        const sawOther = v1.includes("other") || v2.includes("other");
        if (sawOther) disagreedOther++;
        if (pred.length > 0) {
          disagreedPinned++;
          if (sawOther) disagreedOtherPinned++;
          if (pinnedEx.length < 8) {
            pinnedEx.push(`${a.name} [${clause.id}] ${v1.join(",")} vs ${v2.join(",")} -> ${pred.join(",")}`);
          }
        }
        continue;
      }
      agreed++;
      const pred = effectActions(clause.text, clause.kind);
      for (const p of pred) {
        predicted++;
        if (v1.includes(p)) hit++;
        else {
          const list = misses.get(p) ?? [];
          if (list.length < 4) list.push(`${a.name} [${clause.id}] got ${v1.join(",")} — "${clause.text.slice(0, 62)}"`);
          misses.set(p, list);
        }
      }
      // The case the table exists for: both runs settled on the escape hatch, but the text states
      // an action the vocabulary does cover.
      if (v1.join() === "other" && pred.length > 0 && rescued.length < 10) {
        rescued.push(`${a.name} [${clause.id}] -> ${pred.join(",")} — "${clause.text.slice(0, 62)}"`);
      }
    }
  }
}

console.log(`agreed clauses  : ${agreed}`);
console.log(`verbs predicted : ${predicted}`);
console.log(`  present in the agreed answer : ${hit} (${((hit / predicted) * 100).toFixed(1)}% precision)`);
console.log(`  absent  (false positives)    : ${predicted - hit}`);
if (misses.size) {
  console.log(`\nFALSE POSITIVES BY VERB — each one would hand the model a wrong fact`);
  for (const [verb, ex] of [...misses].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${verb}`);
    for (const e of ex) console.log(`    ${e}`);
  }
}
console.log(`\nCLAUSES THE TABLE RESCUES FROM AN AGREED "other" (${rescued.length} shown)`);
for (const r of rescued) console.log(`  ${r}`);

console.log(`\nWHERE THE TWO RUNS DISAGREED — the clauses reconciliation has to arbitrate`);
console.log(`  disagreeing clauses           : ${disagreed}`);
console.log(`  ...the table derives a verb   : ${disagreedPinned} (${((disagreedPinned / disagreed) * 100).toFixed(0)}%)`);
console.log(`  ...of which involve "other"   : ${disagreedOther} disagreements, ${disagreedOtherPinned} pinned`);
for (const p of pinnedEx) console.log(`    ${p}`);
