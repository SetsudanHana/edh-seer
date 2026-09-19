/** ROADMAP AJ3: does the shipped event index say what the shipped counts say?
 *
 *  The build asserts this over its own in-memory artifact (`partners-core.test.ts`). This asks the
 *  same question of the FILES, after sharding, JSON round-tripping and the version directory --
 *  because the count a chip prints and the list a reader lands on travel to the browser
 *  separately, and AJ1 is the defect that happens when two such numbers are computed twice.
 *
 *  Free, read-only, no Mongo. Reads `static-out/` unless a directory is given.
 *
 *    npx tsx research/matcher/verify-event-index.ts [<artifact dir>]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { identityMask, inIdentityOf, type EventFrequencyFile, type EventMembers } from "../../packages/matcher/src/bin/partners-core.js";
import { eventShardOf } from "../../packages/matcher/src/bin/events-index-core.js";

const out = process.argv[2] ?? "static-out";
const version = (JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")) as { version: string }).version;
const base = join(out, version);
console.log(`artifact: ${base}`);

const freq = JSON.parse(readFileSync(join(base, "event-frequency.json"), "utf8")) as EventFrequencyFile;
const index = JSON.parse(readFileSync(join(base, "name-index.json"), "utf8")) as { name: string; identity: string[] }[];

const members = new Map<string, EventMembers>();
for (const file of readdirSync(join(base, "events"))) {
  for (const [key, m] of Object.entries(JSON.parse(readFileSync(join(base, "events", file), "utf8")) as Record<string, EventMembers>)) {
    // A KEY IN TWO SHARDS WOULD BE A SILENT HALF-ANSWER: the browser reads one file and would find
    // whichever half it landed in.
    if (members.has(key)) throw new Error(`${key} is in two shards`);
    if (eventShardOf(key) !== file.replace(".json", "")) throw new Error(`${key} is in ${file}, not ${eventShardOf(key)}.json`);
    members.set(key, m);
  }
}

let bad = 0;
const say = (msg: string): void => { bad++; if (bad <= 10) console.log(`  ${msg}`); };
for (const [key, m] of members) {
  if (m.p.length !== (freq.supply[key] ?? 0)) say(`${key}: ${m.p.length} causes listed, ${freq.supply[key]} counted`);
  if (m.c.length !== (freq.consume[key] ?? 0)) say(`${key}: ${m.c.length} askers listed, ${freq.consume[key]} counted`);
  for (const id of [...m.p, ...m.c]) if (id < 0 || id >= index.length) say(`${key}: id ${id} is outside the index`);
  // THE IDENTITY SPLIT IS THE SAME SET, COUNTED BY COLOUR. A commander page and a picker row both
  // read it; a slot total that disagrees with the member list is a scoped number over a corpus set.
  const slots = freq.byIdentity[key];
  if (slots && slots.reduce((a, b) => a + b, 0) !== m.p.length) say(`${key}: slots sum to ${slots.reduce((a, b) => a + b, 0)}, ${m.p.length} listed`);
}
// `meld|-|-|-` is a PRICE, not a census (`partners-core.ts`), so it ships no list on purpose.
for (const key of Object.keys(freq.supply)) {
  if (!members.has(key) && key !== "meld|-|-|-") say(`${key}: counted ${freq.supply[key]}, no list shipped`);
}

// AND ONE SCOPED READING, END TO END: the number a commander page prints against the set it links.
const sample = "applies:keyword-grant|creature|cleric|-";
if (freq.byIdentity[sample]) {
  const scoped = inIdentityOf(freq.byIdentity[sample], identityMask(["R", "G", "W"]));
  const listed = (members.get(sample)?.p ?? []).filter((id) => {
    const own = identityMask(index[id]?.identity ?? []);
    return (own & ~identityMask(["R", "G", "W"])) === 0;
  }).length;
  console.log(`  ${sample}: corpus ${freq.supply[sample]}, RGW slots ${scoped}, RGW listed ${listed}`);
  if (scoped !== listed) say(`${sample}: the scoped count and the scoped list disagree`);
}

console.log(`keys: ${members.size} indexed, ${Object.keys(freq.supply).length} counted`);
console.log(bad === 0 ? "ok: every count has a list of that length" : `MISMATCHES: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
