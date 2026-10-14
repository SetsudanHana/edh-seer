/** Removes every sticker card (`isStickerCard`: sticker-using cards and the "Stickers" sheets) from
 *  every per-card collection. Owner 2026-10-14: sticker cards are dropped from the engine entirely.
 *  DRY RUN by default: prints the count per collection. `--run` deletes (local Mongo only; a re-ingest
 *  skips them, so they do not come back). */
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { stickerPurgeFilters } from "../purge.js";

const RUN = process.argv.includes("--run");
const store = await connect(loadConfig());
const ids = (await store.cards.find({}).toArray()).filter((c) => isStickerCard(c)).map((c) => c._id);
console.log(`sticker cards in cards: ${ids.length}${RUN ? "" : " (dry run; --run deletes)"}`);
for (const { collection, filter } of stickerPurgeFilters(ids)) {
  const col = store.db.collection(collection);
  if (RUN) console.log(`${collection}: deleted ${(await col.deleteMany(filter)).deletedCount}`);
  else console.log(`${collection}: would delete ${await col.countDocuments(filter)}`);
}
await store.close();
