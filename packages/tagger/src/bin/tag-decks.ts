import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect,
  loadConfig,
  mongoLookup,
  normalizeName,
  parseDecklistText,
  docToCard,
} from "@edh-seer/data";
import type { Card } from "@edh-seer/engine";
import { createProvider } from "../llm/factory.js";
import { extractCardTags } from "../extract.js";
import { upsertCardTags, needsRetag, type TagCollection } from "../store.js";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import { loadTaggerConfig } from "../config.js";
import { mapPool } from "../pool.js";
import { startProgress } from "../progress.js";

const DECKS = ["inalla", "chandra", "gisa", "gogo", "hidetsugu", "samut"];
const DECK_DIR = join(process.cwd(), "..", "cli", "decks");

async function main(): Promise<void> {
  const cfg = loadTaggerConfig();
  const store = await connect(loadConfig());
  const cardTags = store.db.collection("cardTags") as unknown as TagCollection;
  const llm = createProvider(cfg);
  const lookup = mongoLookup(store);

  // Collect unique oracle cards across all decks (dedupe by oracle id = CardDoc._id).
  const seen = new Map<string, Card>();
  const names = new Map<string, string>(); // oracleId -> display name for logging
  for (const deck of DECKS) {
    const text = readFileSync(join(DECK_DIR, `${deck}.txt`), "utf8");
    for (const name of parseDecklistText(text)) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue; // unresolved line — tolerated
      if (!seen.has(doc._id)) {
        seen.set(doc._id, docToCard(doc));
        names.set(doc._id, doc.name);
      }
    }
  }

  let tagged = 0;
  let skipped = 0;
  const failures: string[] = [];
  const entries = [...seen.entries()];
  console.log(`tagging ${entries.length} unique cards at concurrency ${cfg.concurrency} (model ${cfg.model})...`);
  const progress = startProgress(entries.length);
  await mapPool(entries, cfg.concurrency, async ([oracleId, card]) => {
    try {
      const existing = await cardTags.findOne({ oracleId });
      if (!needsRetag(existing, SCHEMA_VERSION, PROMPT_VERSION)) {
        skipped++;
      } else if (!card.oracleText.trim()) {
        skipped++; // vanilla/lands with no text
      } else {
        const tags = await extractCardTags(oracleId, card, llm);
        await upsertCardTags(cardTags, tags);
        tagged++;
      }
    } catch (err) {
      failures.push(`${names.get(oracleId)}: ${(err as Error).message}`);
    }
    progress.tick();
  });
  console.log(`done: ${tagged} tagged, ${skipped} skipped, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAILED ${f}`);
  await store.close();
}

main().catch((err) => {
  console.error("tag-decks failed:", err);
  process.exit(1);
});
