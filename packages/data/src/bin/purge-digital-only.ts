import { fileURLToPath } from "node:url";
import { connect } from "../db.js";
import { loadConfig } from "../config.js";
import { fetchDigitalOnlyOracleIds } from "../scryfall.js";

/**
 * Purge digital-only cards (Alchemy/Arena-exclusive) from the corpus.
 *
 * Cleans up corpora ingested before ingest.ts started excluding them; a fresh ingest
 * should leave nothing for this to delete. Selection rules live with
 * fetchDigitalOnlyOracleIds.
 *
 * Dry-run by default; pass --apply to delete.
 */

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const cardTags = store.db.collection("cardTags");
  const cardOtags = store.db.collection("cardOtags");

  console.log("fetching digital-only oracle_ids from Scryfall...");
  const digital = await fetchDigitalOnlyOracleIds();
  console.log(`digital-only oracle_ids: ${digital.size}`);

  const all = (await cards.find({}, { projection: { _id: 1 } }).toArray()) as unknown as { _id: string }[];
  const digitalIds = all.map((d) => d._id).filter((id) => digital.has(id));
  // A correct predicate touches a sliver of the corpus; a broad match means the query
  // changed meaning upstream, and deleting on it would gut the paper corpus.
  const share = digitalIds.length / all.length;
  if (share > 0.05) throw new Error(`digital-only set is ${(100 * share).toFixed(1)}% of corpus; refusing to purge`);

  console.log(`\ncards: ${all.length} total, ${digitalIds.length} digital-only`);
  console.log(`cardTags: ${await cardTags.countDocuments({ oracleId: { $in: digitalIds } })} matching`);
  console.log(`cardOtags: ${await cardOtags.countDocuments({ _id: { $in: digitalIds } } as never)} matching`);

  const sample = await cards.find({ _id: { $in: digitalIds.slice(0, 500) } } as never, { projection: { name: 1 } }).limit(8).toArray();
  console.log(`sample: ${(sample as unknown as { name: string }[]).map((c) => c.name).join(", ")}`);

  if (!apply) {
    console.log(`\nDRY RUN -- nothing deleted. Re-run with --apply to delete.`);
    await store.close();
    return;
  }

  const delCards = await cards.deleteMany({ _id: { $in: digitalIds } } as never);
  const delTags = await cardTags.deleteMany({ oracleId: { $in: digitalIds } });
  const delOtags = await cardOtags.deleteMany({ _id: { $in: digitalIds } } as never);
  console.log(`\ndeleted ${delCards.deletedCount} cards, ${delTags.deletedCount} cardTags, ${delOtags.deletedCount} cardOtags`);
  console.log(`cards now: ${await cards.countDocuments()}`);
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("purge failed:", err);
    process.exit(1);
  });
}
