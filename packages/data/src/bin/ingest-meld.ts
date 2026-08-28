/** Writes the meld relation onto the corpus, from Scryfall's `all_parts`.
 *
 *  FREE: one search request, 21 cards. Scryfall rather than MTGJSON's per-set files because
 *  `cardParts` is PRINTING-level and absent from AtomicCards, and our documents carry no set code —
 *  finding the right set files would mean enumerating sets first, to reach 21 cards that one query
 *  returns. Scryfall is already our card source, so the field semantics match.
 *
 *  Usage: tsx src/bin/ingest-meld.ts [--dry-run]
 */
import { fileURLToPath } from "node:url";
import { connect, loadConfig } from "@edh-seer/data";
import { buildMeld, type ScryfallMeldCard } from "./ingest-meld-core.js";

const SEARCH = "https://api.scryfall.com/cards/search?q=layout%3Ameld&unique=cards";
/** Scryfall rejects requests without these — the same pair `scryfall.ts` already sends. */
const HEADERS = { "User-Agent": "edh-seer/0.1", Accept: "application/json" };

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const res = await fetch(SEARCH, { headers: HEADERS });
  if (!res.ok) throw new Error(`Scryfall search failed: ${res.status}`);
  const payload = await res.json() as { data: ScryfallMeldCard[]; has_more?: boolean };
  if (payload.has_more) throw new Error("paged results not handled — meld should fit one page");
  const meld = buildMeld(payload.data);
  console.log(`meld cards returned ${payload.data.length} | names with a relation ${meld.size}`);

  const store = await connect(loadConfig());
  const cards = store.db.collection("cards");
  const missing: string[] = [];
  const ops: { updateOne: { filter: object; update: object } }[] = [];
  for (const [name, fields] of meld) {
    const doc = await cards.findOne({ name }, { projection: { _id: 1 } });
    if (!doc) { missing.push(name); continue; }
    ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: fields } } });
  }
  // Every name MUST resolve: this joins on name rather than oracle id, so an unresolved name is the
  // one failure mode worth refusing to paper over.
  if (missing.length) console.log(`WARNING unresolved names (${missing.length}): ${missing.join(", ")}`);

  if (dryRun) {
    console.log("DRY RUN — nothing written.");
    for (const [name, f] of [...meld].slice(0, 4)) console.log(`  ${name} -> ${JSON.stringify(f)}`);
  } else {
    if (ops.length) await cards.bulkWrite(ops, { ordered: false });
    console.log(`wrote meld fields to ${ops.length} card(s)`);
  }
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
