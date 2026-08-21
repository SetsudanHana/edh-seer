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
 *  every time; this flag is what catches a corpus that has moved underneath it.
 *
 *  SAME SWEEP ALSO GATES `ANSWER_BASELINE` AND `GRAVEYARD_HATE_SHARE` (whole-branch review, final
 *  fix wave). Both tables in `answer-coverage.ts` are hand-transcribed from a corpus count that
 *  moves -- `gameChanger: true` permanents/lands and `graveyardHateRecurring` matches, split by
 *  type -- and until now nothing re-checked either one against a live corpus, the identical gap
 *  criterion 6 was written to close for `answer-pool.json` itself. `--check` now fails on drift in
 *  either table too, not only the pool. */
import { writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, docToCard, loadConfig } from "@mtg/data";
import { answerClassesOf, loadRules } from "../rules.js";
import { POOL_CLASSES, identityKey, type AnswerPool } from "../answer-pool.js";
import { ANSWER_BASELINE, GRAVEYARD_HATE_SHARE } from "../answer-coverage.js";

const CHECK = process.argv.includes("--check");
const COLORS = ["W", "U", "B", "R", "G"] as const;
const store = await connect(loadConfig());

// The single-type classification the two hand-transcribed tables were counted against: first match
// wins, in this order, so an "Artifact Creature" (etc.) lands on one row and the tables stay a
// partition rather than an overlapping count.
const GAME_CHANGER_CLASSES = ["creature", "artifact", "enchantment", "planeswalker", "land"] as const;
const HATE_CLASSES = ["creature", "artifact", "enchantment"] as const;
const hateRe = new RegExp(loadRules().patterns.graveyardHateRecurring, "i");
const classify = <T extends readonly string[]>(typeLine: string, classes: T): T[number] | undefined => {
  const tl = typeLine.toLowerCase();
  return classes.find((c) => tl.includes(c));
};

const rows: { m: number; cls: Set<string> }[] = [];
const gameChangerCounts: Record<string, number> = Object.fromEntries(GAME_CHANGER_CLASSES.map((c) => [c, 0]));
const hateCounts: Record<string, number> = Object.fromEntries(HATE_CLASSES.map((c) => [c, 0]));
let hateOther = 0;
let scanned = 0;
for await (const doc of store.db.collection("cards").find({})) {
  scanned++;
  const d = doc as { colorIdentity?: string[]; typeLine?: string; oracleText?: string; gameChanger?: boolean };
  const cls = answerClassesOf({ card: docToCard(doc as never), tags: null });
  if (cls.size > 0) {
    const ci = (d.colorIdentity ?? []).map((c) => c.toUpperCase());
    rows.push({ m: ci.reduce((m, c) => m | (1 << COLORS.indexOf(c as (typeof COLORS)[number])), 0), cls: new Set(cls.keys()) });
  }

  const typeLine = d.typeLine ?? "";
  if (d.gameChanger === true) {
    const gc = classify(typeLine, GAME_CHANGER_CLASSES);
    if (gc) gameChangerCounts[gc]++; // absent = not a permanent or land (instant/sorcery/battle), excluded
  }
  if (hateRe.test(d.oracleText ?? "")) {
    const hc = classify(typeLine, HATE_CLASSES);
    if (hc) hateCounts[hc]++;
    else hateOther++;
  }
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

const gameChangerTotal = Object.values(gameChangerCounts).reduce((a, b) => a + b, 0);
const hateTotal = Object.values(hateCounts).reduce((a, b) => a + b, 0);
console.log(`gameChanger permanents/lands: ${JSON.stringify(gameChangerCounts)} (n=${gameChangerTotal})`);
console.log(`graveyardHateRecurring typed: ${JSON.stringify(hateCounts)} (n=${hateTotal}, other=${hateOther})`);

// EITHER TABLE DRIFTING FAILS --check, on the same discipline as the pool artifact below: a share
// baked into source at design time and never re-swept is exactly how hierarchy.json sat at 16 of
// 527 subtypes with every test green.
let tableDrift = false;
for (const c of GAME_CHANGER_CLASSES) {
  const measured = gameChangerTotal > 0 ? gameChangerCounts[c] / gameChangerTotal : 0;
  const stated = ANSWER_BASELINE[c] ?? 0;
  if (Math.abs(measured - stated) > 1e-9) {
    console.error(`DRIFT: ANSWER_BASELINE.${c} = ${stated}, measured ${measured} (${gameChangerCounts[c]}/${gameChangerTotal})`);
    tableDrift = true;
  }
}
for (const c of HATE_CLASSES) {
  const measured = hateTotal > 0 ? hateCounts[c] / hateTotal : 0;
  const stated = GRAVEYARD_HATE_SHARE[c] ?? 0;
  if (Math.abs(measured - stated) > 1e-9) {
    console.error(`DRIFT: GRAVEYARD_HATE_SHARE.${c} = ${stated}, measured ${measured} (${hateCounts[c]}/${hateTotal})`);
    tableDrift = true;
  }
}

if (CHECK) {
  const current = readFileSync(target, "utf8");
  if (current !== out || tableDrift) {
    if (current !== out) console.error("DRIFT: answer-pool.json is stale. Re-run without --check.");
    if (tableDrift) console.error("DRIFT: ANSWER_BASELINE or GRAVEYARD_HATE_SHARE (answer-coverage.ts) is stale against the corpus.");
    process.exit(1);
  }
  console.log("answer-pool.json and the two hand-transcribed tables are up to date.");
} else {
  writeFileSync(target, out);
  console.log(`wrote ${target}`);
  if (tableDrift) console.log("NOTE: ANSWER_BASELINE / GRAVEYARD_HATE_SHARE drifted -- update answer-coverage.ts by hand (design §4).");
}
await store.close();
