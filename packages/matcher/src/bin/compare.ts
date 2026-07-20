import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistText, docToCard } from "@mtg/data";
import { analyzeDeck } from "@mtg/engine";
import type { CardTags } from "@mtg/tagger";
import { analyzeDeckStructured } from "../analyze.js";
import { rankTable } from "../compare-core.js";
import type { DeckCard } from "../types.js";

const DECKS = ["inalla", "chandra", "gisa", "gogo", "hidetsugu", "samut"];
const DECK_DIR = join(process.cwd(), "..", "cli", "decks");

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");

  for (const deck of DECKS) {
    const inputs: DeckCard[] = [];
    let untagged = 0;
    for (const name of parseDecklistText(readFileSync(join(DECK_DIR, `${deck}.txt`), "utf8"))) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
      if (!tags) untagged++;
      inputs.push({ card: docToCard(doc), tags });
    }
    const flat = analyzeDeck(inputs.map((i) => i.card));
    const structured = analyzeDeckStructured(inputs);
    console.log(`\n===== ${deck} (${inputs.length} cards, ${untagged} untagged) =====`);
    console.log(rankTable(flat, structured, 15));
  }
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("compare failed:", err);
    process.exit(1);
  });
}
