import { fileURLToPath } from "node:url";
import { connect } from "../db.js";
import { loadConfig } from "../config.js";

/**
 * One-time purge: 966 corpus documents Scryfall's `oracle_cards` bulk no longer contains, so
 * ingest never refreshes them -- tokens, emblems, `Card`-type art entries, Events, Bosses, and old
 * challenge-deck cards. Four are token twins of real cards and carry `cardTags`, which makes
 * `findByName` return the TOKEN for Coruscation Mage and Earthshaker Khenra instead of the card.
 *
 * Discriminator: `legalities: { $exists: false }`. Every card `oracle_cards` ships has a
 * `legalities` object (even if every format in it is "not_legal"); these stale docs predate that
 * field or were never re-ingested with it. A type-line-based junk filter was measured to ALSO
 * catch 458 legitimate refreshed cards (Planes, Schemes, Vanguards, Stickers -- all still shipped
 * by Scryfall and still refreshed), so this does NOT use `junkCardFilter` from `../purge.js` and
 * must not be merged into it.
 *
 * SAFE ONLY as a one-time surgical operation against today's verified corpus state (34959 cards:
 * 33993 with `legalities`, 966 without). A future PARTIAL ingest could leave freshly-inserted,
 * legitimate cards without `legalities` populated yet, at which point this same filter would be
 * catastrophic -- it would delete real, current cards. That is why this script hard-aborts unless
 * the counts match exactly, rather than trusting the predicate on its own. Do not run this again,
 * and do not adapt it into a recurring/scheduled job.
 */

const EXPECTED_WITHOUT_LEGALITIES = 966;
const EXPECTED_WITH_LEGALITIES = 33993;

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const cardTags = store.db.collection("cardTags");

  const filter = { legalities: { $exists: false } };
  const total = await cards.countDocuments();
  const without = await cards.countDocuments(filter);
  const withLegalities = total - without;

  console.log(`cards: ${total} total, ${withLegalities} with legalities, ${without} without`);

  if (without !== EXPECTED_WITHOUT_LEGALITIES || withLegalities !== EXPECTED_WITH_LEGALITIES) {
    console.error(
      `ABORTING: expected ${EXPECTED_WITH_LEGALITIES} with legalities / ${EXPECTED_WITHOUT_LEGALITIES} without, ` +
        `got ${withLegalities} / ${without}. The corpus has moved since this script was written -- ` +
        `a human must re-verify before deleting anything.`,
    );
    await store.close();
    process.exit(1);
  }

  const stale = await cards.find(filter).project({ _id: 1 }).toArray();
  const staleIds = stale.map((d) => d._id);

  const delCards = await cards.deleteMany(filter);
  const delTags = await cardTags.deleteMany({ oracleId: { $in: staleIds } });

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
