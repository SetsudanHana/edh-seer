/** Writes `SHARD_COUNT` JSON files under `<out>/cards/`, each an object keyed by card name whose
 *  values carry the card, its derived tags and every combo anchored on it (see
 *  `build-static-core.ts`), plus the resolved token-tags map and the token-art map the browser
 *  needs for token nodes. Free — Mongo reads only, no model call.
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
import { SHARD_COUNT, comboIndex, shardOf, type StaticCombo } from "./build-static-core.js";

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
type CardEntry = { card: (typeof cards)[number]; tags: CardTags | null; combos: StaticCombo[] };
const entryOf = (card: (typeof cards)[number]): CardEntry => ({
  card,
  tags: tagsByOracle.get(card._id) ?? null,
  combos: combosByAnchor.get(card.name) ?? [],
});

// BUILT IN MEMORY, WRITTEN ONCE. The previous layout wrote a file per name as it went and then
// rewrote the colliding ones; a shard holds many names, so a second pass over the same file would
// have to read it back and merge. Holding the map instead makes the collision fix a `set` on a
// plain object, and the whole corpus is 100 MB of JSON in a bin that already loads every card.
let occurrences = 0;
const occurrencesByName = new Map<string, number>();
const entryByName = new Map<string, CardEntry>();
for (const card of cards) {
  const entry = entryOf(card);
  for (const name of card.searchNames) {
    occurrencesByName.set(name, (occurrencesByName.get(name) ?? 0) + 1);
    entryByName.set(name, entry);
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
  entryByName.set(name, entryOf(winner));
}

// ONE FILE PER SHARD, and every shard is written even when it is empty: a missing file is a 404,
// and a 404 means "no such card" to `StaticLookup`. That is the right answer for a name nobody
// has, but a shard file that does not exist because no corpus card hashed into it would make the
// host's 404 mean two different things. `{}` says "this shard is real and holds nothing".
const shards = new Map<string, Record<string, CardEntry>>();
for (let i = 0; i < SHARD_COUNT; i++) shards.set(i.toString(16).padStart(4, "0"), {});
for (const [name, entry] of entryByName) shards.get(shardOf(name))![name] = entry;
for (const [shard, body] of shards) {
  writeFileSync(join(cardsDir, `${shard}.json`), JSON.stringify(body));
}

// PROOF, NOT ASSERTION: read every rewritten file back and confirm its card matches the live
// lookup's answer, rather than trusting the write above did what it says.
let parityOk = 0;
const parityMismatches: string[] = [];
for (const [name, winner] of winners) {
  const onDisk = JSON.parse(
    readFileSync(join(cardsDir, `${shardOf(name)}.json`), "utf8"),
  ) as Record<string, { card: { _id: string } }>;
  if (onDisk[name]?.card._id === winner._id) parityOk++;
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
console.log(`names: ${entryByName.size}`);
console.log(`files on disk: ${actualFiles} (shards, fixed at ${SHARD_COUNT})`);
const perShard = [...shards.values()].map((o) => Object.keys(o).length);
console.log(
  `names per shard: min ${Math.min(...perShard)} · mean ` +
    `${(entryByName.size / SHARD_COUNT).toFixed(1)} · max ${Math.max(...perShard)}`,
);
console.log(
  `colliding names: ${collisions.length} (shortfall ${occurrences - entryByName.size})` +
    (collisions.length ? ` -> ${collisions.map(([n, c]) => `${n} x${c}`).join(", ")}` : ""),
);
console.log(
  `collision parity with findOne: ${parityOk}/${winners.size}` +
    (parityMismatches.length ? `; MISMATCHES: ${parityMismatches.join(", ")}` : ""),
);
console.log(`token-tags entries: ${Object.keys(tokenTags).length}`);
console.log(`token-art entries: ${Object.keys(tokenArt).length} (of ${tokens.length} tokens)`);
console.log(`bytes on disk: ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
