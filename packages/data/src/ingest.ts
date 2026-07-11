import type { Collection } from "mongodb";
import {
  normalizeScryfallCard,
  fetchOracleCards,
  type ScryfallCard,
} from "./scryfall.js";
import {
  normalizeVariant,
  fetchVariants,
  type SpellbookVariant,
} from "./spellbook.js";
import { toCardDoc, type CardDoc, type ComboDoc } from "./docs.js";
import { connect } from "./db.js";
import { loadConfig } from "./config.js";

export interface IngestCounts {
  processed: number;
  skipped: number;
}

export async function ingestCards(
  raws: ScryfallCard[],
  cards: Collection<CardDoc>,
): Promise<IngestCounts> {
  let processed = 0;
  let skipped = 0;
  for (const raw of raws) {
    const n = normalizeScryfallCard(raw);
    if (!n) {
      skipped++;
      continue;
    }
    const doc = toCardDoc(n);
    await cards.replaceOne({ _id: doc._id }, doc, { upsert: true });
    processed++;
  }
  return { processed, skipped };
}

export async function ingestCombos(
  raws: SpellbookVariant[],
  combos: Collection<ComboDoc>,
): Promise<IngestCounts> {
  let processed = 0;
  let skipped = 0;
  for (const raw of raws) {
    const n = normalizeVariant(raw);
    if (!n) {
      skipped++;
      continue;
    }
    const doc: ComboDoc = { _id: n.id, cards: n.combo.cards, result: n.combo.result };
    await combos.replaceOne({ _id: doc._id }, doc, { upsert: true });
    processed++;
  }
  return { processed, skipped };
}

export async function runIngest(): Promise<void> {
  const store = await connect(loadConfig());
  try {
    console.log("Downloading Scryfall oracle cards...");
    const cardRaws = await fetchOracleCards();
    const c = await ingestCards(cardRaws, store.cards);
    console.log(`Cards: ${c.processed} processed, ${c.skipped} skipped`);

    console.log("Downloading Commander Spellbook variants...");
    const comboRaws = await fetchVariants();
    const k = await ingestCombos(comboRaws, store.combos);
    console.log(`Combos: ${k.processed} processed, ${k.skipped} skipped`);
  } finally {
    await store.close();
  }
}
