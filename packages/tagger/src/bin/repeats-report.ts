/** FREE. The repeatability distribution across the derived corpus, plus a sample per label so a
 *  human can check that a label means what it says. A label nobody has read is decoration.
 *
 *  Usage: tsx src/bin/repeats-report.ts [--sample N] */
import { connect, loadConfig } from "@mtg/data";
import type { CardTags } from "../schema.js";

const SAMPLE = Number(process.argv[process.argv.indexOf("--sample") + 1]) || 4;
const store = await connect(loadConfig());
const derived = store.db.collection("cardTagsDerived");

const counts = new Map<string, number>();
const samples = new Map<string, string[]>();
let abilities = 0;

for await (const d of derived.find({}) as never as AsyncIterable<CardTags & { name?: string }>) {
  for (const a of d.abilities ?? []) {
    abilities++;
    const key = a.repeats ?? "REFUSED";
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const bucket = samples.get(key) ?? [];
    if (bucket.length < SAMPLE) {
      bucket.push(`${d.name ?? d.oracleId} [${a.kind}${a.trigger ? ` on ${a.trigger.verbs.join("/")}` : ""}]`);
      samples.set(key, bucket);
    }
  }
}

console.log(`abilities ${abilities}`);
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`\n  ${k.padEnd(11)} ${String(n).padStart(5)}  ${((n / abilities) * 100).toFixed(1)}%`);
  for (const s of samples.get(k) ?? []) console.log(`      ${s}`);
}
process.exit(0);
