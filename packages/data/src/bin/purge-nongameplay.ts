import { fileURLToPath } from "node:url";
import { connect } from "../db.js";
import { loadConfig } from "../config.js";
import { junkCardFilter } from "../purge.js";

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const cardTags = store.db.collection("cardTags");

  const filter = junkCardFilter();
  const junk = await cards.find(filter).project({ _id: 1 }).toArray();
  const junkIds = junk.map((d) => d._id);
  console.log(`cards: ${await cards.countDocuments()} total, ${junkIds.length} junk to delete`);

  const taggedJunk = await cardTags.countDocuments({ oracleId: { $in: junkIds } });
  console.log(`cardTags: ${await cardTags.countDocuments()} total, ${taggedJunk} poisoned (junk oracleIds)`);

  const delCards = await cards.deleteMany(filter);
  const delTags = await cardTags.deleteMany({ oracleId: { $in: junkIds } });
  console.log(`deleted ${delCards.deletedCount} card docs, ${delTags.deletedCount} cardTags`);
  console.log(`cards now: ${await cards.countDocuments()}, cardTags now: ${await cardTags.countDocuments()}`);

  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("purge failed:", err);
    process.exit(1);
  });
}
