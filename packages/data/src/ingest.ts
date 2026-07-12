import type { Collection } from "mongodb";
import {
  normalizeScryfallCard,
  fetchOracleCards,
  type ScryfallCard,
} from "./scryfall.js";
import {
  normalizeVariant,
  streamVariants,
  type SpellbookVariant,
} from "./spellbook.js";
import { toCardDoc, type CardDoc, type ComboDoc } from "./docs.js";
import { connect } from "./db.js";
import { loadConfig } from "./config.js";
import { fetchFlavorNames, ingestFlavorNames } from "./flavor.js";

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
  variants: AsyncIterable<SpellbookVariant> | Iterable<SpellbookVariant>,
  combos: Collection<ComboDoc>,
): Promise<IngestCounts> {
  let processed = 0;
  let skipped = 0;
  for await (const raw of variants) {
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

    console.log("Downloading flavor names...");
    const f = await ingestFlavorNames(await fetchFlavorNames(), store.cards);
    console.log(`Flavor names: ${f.applied} applied, ${f.skipped} skipped`);

    console.log("Downloading Commander Spellbook variants...");
    const k = await ingestCombos(streamVariants(), store.combos);
    console.log(`Combos: ${k.processed} processed, ${k.skipped} skipped`);
  } finally {
    await store.close();
  }
}
