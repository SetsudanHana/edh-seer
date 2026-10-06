/** G1 on the labelled same-job pairs, for the rule the precon page and the report swap with today:
 *
 *    npx tsx packages/instruments/src/same-job-purity.ts            # static-out/, the local build
 *
 *  Reads `packages/matcher/src/same-job.labels.json` (owner's second reading, 2026-10-06), resolves
 *  each card the way the site does (`deckCards` over a `StaticLookup`), and asks `sameJob` whether
 *  the pair is the same job in its labelled role. Prints the purity, the gate, and every pair the
 *  rule gets wrong. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeName } from "@edh-seer/data/names";
import { sameJob } from "@edh-seer/matcher/same-job";
import { StaticLookup } from "@edh-seer/matcher/static-lookup";
import { deckCards } from "@edh-seer/matcher/suggest-static";
import { purity, type Label, type Scored } from "./same-job-purity-core.js";
import { STATIC_BASE, staticFetch } from "./static-deck.js";

const source = join(process.cwd(), "static-out");
const labels = JSON.parse(readFileSync("packages/matcher/src/same-job.labels.json", "utf8")) as {
  pairs: { role: string; out: string; in: string; label: Label; excluded?: boolean }[];
};
const lookup = new StaticLookup(STATIC_BASE, staticFetch(source));
await lookup.prefetch(labels.pairs.flatMap((p) => [p.out, p.in]).map(normalizeName));
const dc = deckCards(lookup);
const rows: (Scored & { pair: string })[] = [];
const missing: string[] = [];
for (const p of labels.pairs) {
  const [a, b] = await Promise.all([dc(p.out), dc(p.in)]);
  if (!a || !b) { missing.push(`${p.out} -> ${p.in}`); continue; }
  rows.push({ label: p.label, excluded: p.excluded, together: sameJob(a, b, p.role as never), pair: `${p.role}: ${p.out} -> ${p.in}` });
}
const r = purity(rows);
console.log(`pairs scored ${r.scored} (excluded ${rows.length - r.scored}, unresolved cards ${missing.length})`);
console.log(`together ${r.together}: same ${r.same}, weak ${r.weak}, different ${r.different}`);
console.log(`purity ${r.purity === null ? "n/a" : (r.purity * 100).toFixed(1) + "%"} · same pairs found ${r.sameFound}/${r.sameTotal} · G1 ${r.passes ? "PASS" : "FAIL"}`);
for (const x of rows.filter((x) => !x.excluded && x.together && x.label !== "same")) console.log(`  together but ${x.label}: ${x.pair}`);
for (const x of rows.filter((x) => !x.excluded && !x.together && x.label === "same")) console.log(`  same but apart: ${x.pair}`);
for (const m of missing) console.log(`  unresolved: ${m}`);
