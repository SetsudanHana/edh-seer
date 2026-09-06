/** BANK A FIXED PANEL FALSE INTO THE PAIR-CALIBRATION RATCHET.
 *
 *  The panel (docs/measurements/panel, local-only) is where the owner's verdicts live; the ratchet
 *  that CI runs is `calibration-pairs.json` + `fixtures/calibration-clauses.json`, and it is
 *  pair-level: a pair judged neutral must produce NO reason at all. So a panel false can be banked
 *  only when, after the fix, the two cards share no reason whatsoever -- a pair whose false tag is
 *  gone but which still links on a real tag stays in the panel alone, and is reported here.
 *
 *    npx tsx research/bank-panel-falses.ts <falses-before.jsonl> <falses-after.jsonl> [--write] */
import { readFileSync, writeFileSync } from "node:fs";
import { connect, loadConfig, mongoLookup, resolveNames } from "@edh-seer/data";
import { createTagsLookup, segment } from "@edh-seer/tagger";
import { buildDeckCards, loadHierarchy, pairReasonsAcrossFaces } from "../packages/matcher/src/index.js";
import { mergeFixtures, upsertPair, type ClauseFixture, type PairRecord } from "../packages/matcher/src/bin/pair-calibrate-core.js";

const [beforeF, afterF] = [process.argv[2]!, process.argv[3]!];
const WRITE = process.argv.includes("--write");
const rows = (f: string) => readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { producer: string; consumer: string; tag: string; note: string });
const key = (r: { producer: string; consumer: string; tag: string }) => `${r.producer}|${r.consumer}|${r.tag}`;
const after = new Set(rows(afterF).map(key));
const fixed = rows(beforeF).filter((r) => !after.has(key(r)));

const store = await connect(loadConfig()); const lookup = mongoLookup(store); const tags = createTagsLookup(store.db);
const PAIRS = "packages/matcher/src/calibration-pairs.json", FIXTURE = "packages/matcher/src/fixtures/calibration-clauses.json";
let pairs = JSON.parse(readFileSync(PAIRS, "utf8")) as PairRecord[];
let fixtures = JSON.parse(readFileSync(FIXTURE, "utf8")) as ClauseFixture[];
const h = loadHierarchy();
for (const r of fixed) {
  const { cards } = await resolveNames([r.producer, r.consumer], lookup);
  const dcs = await buildDeckCards(cards, lookup, tags);
  const a = dcs.find((d) => d.card.name === r.producer)!, b = dcs.find((d) => d.card.name === r.consumer)!;
  const reasons = pairReasonsAcrossFaces(a, b, h);
  if (reasons.length) { console.log(`SKIP  ${r.producer} -> ${r.consumer}: false tag [${r.tag}] gone, but the pair still links on ${reasons.map((x) => x.tag).join(", ")} -- panel only`); continue; }
  console.log(`BANK  ${r.producer} -> ${r.consumer} [${r.tag}] neutral`);
  const clauseDocs = await store.db.collection("cardClauses").find({ name: { $in: [r.producer, r.consumer] } }).toArray();
  const cardDocs = await store.db.collection("cards").find({ name: { $in: [r.producer, r.consumer] } }).toArray();
  const snapshot: ClauseFixture[] = clauseDocs.map((c) => {
    const d = cardDocs.find((x) => x.name === c.name)!; const dc = dcs.find((x) => x.card.name === c.name)!;
    const texts: Record<number, string> = {}; for (const s of segment(d.oracleText ?? "", d.keywords ?? [], d.typeLine ?? "")) texts[s.id] = s.text;
    return { name: c.name as string, oracleId: c.oracleId as string, clauses: c.canonical as never, characteristics: dc.tags!.characteristics as never, clauseTexts: texts };
  });
  fixtures = mergeFixtures(fixtures, snapshot);
  pairs = upsertPair(pairs, {
    a: r.producer, b: r.consumer, verdict: "neutral", stratum: "linked", judgedAt: new Date().toISOString(),
    note: `Banked from the panel 2026-09-06 (W22 families 1-3): the engine claimed [${r.tag}] and the owner judged it FALSE -- ${r.note.slice(0, 200)}`,
  });
}
if (WRITE) { writeFileSync(PAIRS, JSON.stringify(pairs, null, 1) + "\n"); writeFileSync(FIXTURE, JSON.stringify(fixtures, null, 1) + "\n"); console.log(`wrote ${pairs.length} pairs, ${fixtures.length} fixture cards`); }
else console.log("dry run; add --write to bank");
await store.close();
