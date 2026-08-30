/** Writes one JSON file per card name under `<out>/cards/`, each carrying the card, its derived
 *  tags and every combo anchored on it (see `build-static-core.ts`), plus the resolved token-tags
 *  map the browser needs for token nodes. Free — Mongo reads only, no model call.
 *
 *  THE CLI IS SPLIT FROM ITS LOGIC ON PURPOSE: importing a bin RUNS it (the recorded
 *  `isMoxfieldUrl` trap), so everything testable lives in `build-static-core.ts` and this file is
 *  the Mongo wiring only.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/build-static.ts [--out <dir>] */
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
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
// Ship only the commander-legal 31,829 and a Black Lotus paste reads `missing` — the wrong answer,
// not a missing one. Measured 2026-08-30: the corpus is 34,433 cards; ALL of them produce 35,713
// files (searchNames occurrences, minus the collisions dumped below), 2,604 more than the
// commander-legal subset alone would cover.
const cards = await store.cards.find({}).toArray();
const derivedRows = await store.db.collection<CardTags>(DERIVED_COLLECTION).find({}).toArray();
const tagsByOracle = new Map(derivedRows.map((r) => [r.oracleId, r]));
const combos = await store.combos.find().toArray();
const combosByAnchor = comboIndex(combos.map((c) => ({ cards: c.cards, result: c.result })));

// LAST WRITE WINS. `searchNames` keys collide across cards (packages/data/src/docs.ts, ~79
// corpus-wide) — one file per name means a colliding name collapses to whichever card's write
// landed last (Mongo's own `find({})` order), so the file count legitimately lands BELOW the
// pre-collision name count. Tracked here rather than guessed: `occurrences` counts every
// (card, name) pair written, and any name written more than once is a real collision, dumped below.
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

const resolveToken = await loadTokenTags(store.db);
const tokens = await store.db.collection<{ printingIds: string[] }>("tokens").find({}).toArray();
const tokenTags: Record<string, CardTags> = {};
for (const t of tokens) {
  for (const pid of t.printingIds) {
    const tt = resolveToken({ name: "", typeLine: "", printingId: pid });
    if (tt) tokenTags[pid] = tt;
  }
}
writeFileSync(join(outDir, "token-tags.json"), JSON.stringify(tokenTags));

await store.close();

let totalBytes = 0;
for (const f of readdirSync(cardsDir)) totalBytes += statSync(join(cardsDir, f)).size;
totalBytes += statSync(join(outDir, "token-tags.json")).size;

const actualFiles = readdirSync(cardsDir).length;
console.log(`cards: ${cards.length}`);
console.log(`searchNames occurrences (pre-collision): ${occurrences}`);
console.log(`files on disk: ${actualFiles}`);
console.log(
  `colliding names: ${collisions.length} (shortfall ${occurrences - actualFiles})` +
    (collisions.length ? ` -> ${collisions.map(([n, c]) => `${n} x${c}`).join(", ")}` : ""),
);
console.log(`token-tags entries: ${Object.keys(tokenTags).length}`);
console.log(`bytes on disk: ${totalBytes} (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
