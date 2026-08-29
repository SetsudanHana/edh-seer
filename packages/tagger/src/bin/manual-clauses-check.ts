/** Does every hand-authored entry still describe the card the corpus holds?
 *
 *  `manual-clauses.test.ts` is the free ratchet and runs in every `npm test`: it re-segments each
 *  entry from the printed text STORED IN THE ENTRY, so it needs no database and catches a waiver
 *  that has stopped firing. What it structurally cannot see is the stored text going stale — an
 *  errata, an oracle rewording, or a name pointing at a different card after a resolution fix.
 *
 *  That is this bin, and it is the same split `gen-answer-pool.ts --check` already ships: the
 *  structural property is a test, the corpus-driven one is a separate step that needs Mongo.
 *
 *  A STALE ENTRY IS A LOUD FAILURE RATHER THAN A QUIET CORRECTION. Rewriting the stored text here
 *  would keep a hand-written ANSWER attached to a card whose text has changed underneath it, which
 *  is exactly the thing the fixture exists to prevent — so it exits non-zero and says which entry to
 *  re-author.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/tagger/src/bin/manual-clauses-check.ts */
import { connect, loadConfig } from "@edh-seer/data";
import { loadManualEntries } from "../manual-clauses.js";

const store = await connect(loadConfig());
const entries = loadManualEntries();
let stale = 0;

for (const e of entries) {
  const doc = await store.cards.findOne({ _id: e.oracleId } as never) as unknown as
    { name: string; oracleText?: string; typeLine?: string; keywords?: string[] } | null;
  if (!doc) {
    console.log(`GONE     ${e.name} (${e.oracleId}) — no card with this oracle id`);
    stale++;
    continue;
  }
  const drift: string[] = [];
  if ((doc.oracleText ?? "") !== e.oracleText) drift.push("oracleText");
  if ((doc.typeLine ?? "") !== e.typeLine) drift.push("typeLine");
  // Sorted, because Scryfall's order is not a promise and a reordering is not a change.
  const a = [...(doc.keywords ?? [])].sort().join(","), b = [...e.keywords].sort().join(",");
  if (a !== b) drift.push("keywords");
  if (drift.length) {
    console.log(`STALE    ${e.name} — ${drift.join(", ")} no longer matches the corpus; re-author the entry`);
    stale++;
  } else {
    console.log(`ok       ${e.name}`);
  }
}

console.log(`\n${entries.length} hand-authored entr${entries.length === 1 ? "y" : "ies"}, ${stale} stale`);
await store.close();
process.exit(stale ? 1 : 0);
