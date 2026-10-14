/** Removes every sticker card (`isStickerCard`: sticker-using cards and the "Stickers" sheets) from
 *  every per-card collection and the combos that name one. Owner 2026-10-14: sticker cards are dropped from the engine entirely.
 *  DRY RUN by default: prints the count per collection. `--run` deletes (local Mongo only; a re-ingest
 *  skips them, so they do not come back). */
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { comboNamesOf, stickerComboFilter, stickerPurgeFilters } from "../purge.js";
import { fetchOracleCards, normalizeScryfallCard } from "../scryfall.js";
import { toCardDoc } from "../docs.js";

const RUN = process.argv.includes("--run");
const store = await connect(loadConfig());
const ids = (await store.cards.find({}).toArray()).filter((c) => isStickerCard(c)).map((c) => c._id);
console.log(`sticker cards in cards: ${ids.length}${RUN ? "" : " (dry run; --run deletes)"}`);
for (const { collection, filter } of stickerPurgeFilters(ids)) {
  const col = store.db.collection(collection);
  if (RUN) console.log(`${collection}: deleted ${(await col.deleteMany(filter)).deletedCount}`);
  else console.log(`${collection}: would delete ${await col.countDocuments(filter)}`);
}

// COMBOS name a card by NAME, and a purged card's name is gone from `cards`, so the names come from
// the cards still in the collection plus Scryfall's oracle list (a re-run after a purge still finds them).
const names = new Set<string>();
for (const c of await store.cards.find({}).toArray()) if (isStickerCard(c)) for (const n of comboNamesOf(c.name)) names.add(n);
for (const raw of await fetchOracleCards()) {
  const n = normalizeScryfallCard(raw);
  if (!n) continue;
  const doc = toCardDoc(n);
  if (isStickerCard(doc)) for (const nm of comboNamesOf(doc.name)) names.add(nm);
}
const comboFilter = stickerComboFilter(names);
console.log(`sticker card names: ${names.size}`);
if (RUN) console.log(`combos: deleted ${(await store.combos.deleteMany(comboFilter as never)).deletedCount}`);
else console.log(`combos: would delete ${await store.combos.countDocuments(comboFilter as never)}`);
await store.close();
