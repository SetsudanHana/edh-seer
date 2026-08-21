/** Generates `answer-pool.json`: how many answers of each class EXIST inside each colour identity.
 *
 *  FREE -- Mongo reads only, no model. The answer rules in `rules.json` read `oracle` and `typeLine`
 *  only, so this needs no derived corpus and covers all ~34k cards rather than the 2,541 the
 *  derived corpus holds. (Counting a vocabulary case against the derived corpus has understated it
 *  by two orders of magnitude twice in this project's history.)
 *
 *  `--check` regenerates and diffs against the committed file without writing, for CI -- the same
 *  contract `gen-vocabulary.ts --check` already ships. The suite's own `answer-pool.test.ts` guards
 *  STRUCTURE (monotonicity under identity superset), which needs no database and therefore runs
 *  every time; this flag is what catches a corpus that has moved underneath it. */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, docToCard, loadConfig } from "@mtg/data";
import { answerClassesOf } from "../rules.js";
import { POOL_CLASSES, identityKey, type AnswerPool } from "../answer-pool.js";

const CHECK = process.argv.includes("--check");
const COLORS = ["W", "U", "B", "R", "G"] as const;
const store = await connect(loadConfig());

const rows: { m: number; cls: Set<string> }[] = [];
let scanned = 0;
for await (const doc of store.db.collection("cards").find({})) {
  scanned++;
  const cls = answerClassesOf({ card: docToCard(doc as never), tags: null });
  if (cls.size === 0) continue;
  const ci = ((doc as { colorIdentity?: string[] }).colorIdentity ?? []).map((c) => c.toUpperCase());
  rows.push({ m: ci.reduce((m, c) => m | (1 << COLORS.indexOf(c as (typeof COLORS)[number])), 0), cls: new Set(cls.keys()) });
}

const pool: AnswerPool = {};
for (let m = 0; m < 32; m++) {
  // A deck of identity m may play any card whose identity is a SUBSET of m.
  const legal = rows.filter((r) => (r.m & ~m) === 0);
  const key = identityKey(COLORS.filter((_, i) => m & (1 << i)));
  pool[key] = Object.fromEntries(POOL_CLASSES.map((c) => [c, legal.filter((r) => r.cls.has(c)).length]));
}

const out = JSON.stringify(pool, null, 2) + "\n";
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "answer-pool.json");
console.log(`corpus ${scanned} cards, ${rows.length} carry an answer class`);
console.log(`B: ${JSON.stringify(pool.B)}`);
console.log(`WUBRG: ${JSON.stringify(pool.WUBRG)}`);

if (CHECK) {
  const current = readFileSync(target, "utf8");
  if (current !== out) {
    console.error("DRIFT: answer-pool.json is stale. Re-run without --check.");
    process.exit(1);
  }
  console.log("answer-pool.json is up to date.");
} else {
  writeFileSync(target, out);
  console.log(`wrote ${target}`);
}
await store.close();
