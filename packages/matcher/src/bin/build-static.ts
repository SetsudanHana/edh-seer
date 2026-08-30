/** Writes one JSON file per card name under `<out>/cards/`, each carrying the card, its derived
 *  tags and every combo anchored on it (see `build-static-core.ts`), plus the resolved token-tags
 *  map and the token-art map the browser needs for token nodes. Free — Mongo reads only, no model
 *  call.
 *
 *  THE CLI IS SPLIT FROM ITS LOGIC ON PURPOSE: importing a bin RUNS it (the recorded
 *  `isMoxfieldUrl` trap), so everything testable lives in `build-static-core.ts` and this file is
 *  the Mongo wiring only.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/build-static.ts [--out <dir>] */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { loadTokenTags } from "../index.js";
import { cardFileName, comboIndex, type StaticCombo } from "./build-static-core.js";

const outIdx = process.argv.indexOf("--out");
const outDir = outIdx >= 0 ? process.argv[outIdx + 1] : "static-out";
const cardsDir = join(outDir, "cards");
mkdirSync(cardsDir, { recursive: true });

const store = await connect(loadConfig());

// EVERY CARD, NOT ONLY THE COMMANDER-LEGAL ONES. `legality.ts` reports colour-identity violations,
// duplicate nonbasics and format-illegal cards, and it can only do that for a card it can RESOLVE.
// Ship only the legal 31,829 and a Black Lotus paste reads `missing` — the wrong answer, not a
// missing one. Measured 2026-08-30, re-verified against the live corpus (not just quoted): 35,713
// distinct searchNames across all 34,433 cards against 33,164 among the 31,829 commander-legal
// ones alone, so shipping every card costs 2,549 files (7.7%).
const cards = await store.cards.find({}).toArray();
const derivedRows = await store.db.collection<CardTags>(DERIVED_COLLECTION).find({}).toArray();
const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
const combos = await store.combos.find().toArray();
const combosByAnchor = comboIndex(combos.map((c) => ({ cards: c.cards, result: c.result })));

// `searchNames` keys collide across cards (packages/data/src/docs.ts, ~79 corpus-wide) — one file
// per name means a colliding name collapses to one winner, so the file count legitimately lands
// BELOW the pre-collision name count. Tracked here rather than guessed: `occurrences` counts every
// (card, name) pair written, and any name written more than once is a real collision, resolved
// below.
let occurrences = 0;
const occurrencesByName = new Map<string, number>();
for (const card of cards) {
  const tags = tagsByOracle.get(card._id) ?? null;
  const cardCombos: StaticCombo[] = combosByAnchor.get(card.name) ?? [];
  const body = JSON.stringify({ card, tags, combos: cardCombos });
  for (const name of card.searchNames) {
    occurrencesByName.set(name, (occurrencesByName.get(name) ?? 0) + 1);
    writeFileSync(join(cardsDir, `${cardFileName(name)}.json`), body);
    occurrences++;
  }
}
const collisions = [...occurrencesByName.entries()].filter(([, n]) => n > 1);

// PARITY WITH THE LIVE PATH, NOT A NICER-LOOKING WINNER. The loop above writes every card in
// `find({})` order, so a colliding name's file was left holding whichever card was processed
// LAST — an arbitrary winner that need not agree with `mongoLookup.findByName`
// (`db.ts`: `cards.findOne({ searchNames: name })`), the query every live lookup in this app
// actually runs. `findOne` on an indexed field answers in INDEX order, which `find({})`'s
// natural-order stream does not reproduce, so imitating it is guessing — re-querying it directly,
// once per colliding name (53 here, nothing), is exact by construction instead. Rewriting only
// these files after the fact — rather than resolving every name through `findOne` up front — keeps
// the common case (no collision) a single bulk read.
const winners = new Map<string, { _id: string }>();
for (const [name] of collisions) {
  const winner = await store.cards.findOne({ searchNames: name });
  if (!winner) continue; // cannot happen: `name` was just written from a real card above
  winners.set(name, winner);
  const tags = tagsByOracle.get(winner._id) ?? null;
  const cardCombos: StaticCombo[] = combosByAnchor.get(winner.name) ?? [];
  writeFileSync(
    join(cardsDir, `${cardFileName(name)}.json`),
    JSON.stringify({ card: winner, tags, combos: cardCombos }),
  );
}

// PROOF, NOT ASSERTION: read every rewritten file back and confirm its card matches the live
// lookup's answer, rather than trusting the write above did what it says.
let parityOk = 0;
const parityMismatches: string[] = [];
for (const [name, winner] of winners) {
  const onDisk = JSON.parse(
    readFileSync(join(cardsDir, `${cardFileName(name)}.json`), "utf8"),
  ) as { card: { _id: string } };
  if (onDisk.card._id === winner._id) parityOk++;
  else parityMismatches.push(name);
}

const resolveToken = await loadTokenTags(store.db);
const tokens = await store.db.collection<{ _id: string; artCrop?: string; printingIds: string[] }>(
  "tokens",
).find({}).toArray();
const tokenTags: Record<string, CardTags> = {};
for (const t of tokens) {
  for (const pid of t.printingIds) {
    const tt = resolveToken({ name: "", typeLine: "", printingId: pid });
    if (tt) tokenTags[pid] = tt;
  }
}
writeFileSync(join(outDir, "token-tags.json"), JSON.stringify(tokenTags));

// KEYED ON THE COLLECTION'S OWN `_id` — that IS the oracle id, and `AnalysisSources.tokenArt`
// takes oracle ids on both sides (`orchestrate.ts` does the ONLY node-id translation, on purpose,
// so neither caller has to). Small enough to ship whole (995 tokens): sharding it the way `cards/`
// is sharded would buy nothing and cost a second lookup for something the browser wants in one
// shot alongside `token-tags.json`.
//
// FOUND MISSING 2026-08-30, after Task 5 shipped `StaticLookup.tokenArt` against what
// `build-static.ts` actually wrote and it was an empty `Map` on every deck: this bin called
// `loadTokenTags` for the `CardTags` resolver and never touched the SAME `tokens` documents' own
// `artCrop` field, which the Mongo path's `tokenArt` reads directly
// (`{_id: {$in: oracleIds}}, {projection: {artCrop: 1}}`).
const tokenArt: Record<string, string> = {};
for (const t of tokens) if (t.artCrop) tokenArt[t._id] = t.artCrop;
writeFileSync(join(outDir, "token-art.json"), JSON.stringify(tokenArt));

await store.close();

let totalBytes = 0;
for (const f of readdirSync(cardsDir)) totalBytes += statSync(join(cardsDir, f)).size;
totalBytes += statSync(join(outDir, "token-tags.json")).size;
totalBytes += statSync(join(outDir, "token-art.json")).size;

const actualFiles = readdirSync(cardsDir).length;
console.log(`cards: ${cards.length}`);
console.log(`searchNames occurrences (pre-collision): ${occurrences}`);
console.log(`files on disk: ${actualFiles}`);
console.log(
  `colliding names: ${collisions.length} (shortfall ${occurrences - actualFiles})` +
    (collisions.length ? ` -> ${collisions.map(([n, c]) => `${n} x${c}`).join(", ")}` : ""),
);
console.log(
  `collision parity with findOne: ${parityOk}/${winners.size}` +
    (parityMismatches.length ? `; MISMATCHES: ${parityMismatches.join(", ")}` : ""),
);
console.log(`token-tags entries: ${Object.keys(tokenTags).length}`);
console.log(`token-art entries: ${Object.keys(tokenArt).length} (of ${tokens.length} tokens)`);
console.log(`bytes on disk: ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
