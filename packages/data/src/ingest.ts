import type { AnyBulkWriteOperation, Collection } from "mongodb";
import {
  normalizeScryfallCard,
  fetchDigitalOnlyOracleIds,
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

/** Upserts flushed per bulkWrite round-trip; keeps memory bounded on large corpora. */
const BATCH_SIZE = 500;

export async function ingestCards(
  raws: ScryfallCard[],
  cards: Collection<CardDoc>,
  onProgress?: (done: number, total: number) => void,
  /** Oracle IDs with no paper printing; excluded so digital-only cards never enter the
   *  corpus. They are unplayable in paper and unreachable by ingest-otags, which filters
   *  -is:alchemy, so they would sit permanently untagged. */
  digitalOnly: ReadonlySet<string> = new Set(),
): Promise<IngestCounts> {
  const total = raws.length;
  let processed = 0;
  let skipped = 0;
  let done = 0;
  let ops: AnyBulkWriteOperation<CardDoc>[] = [];

  const flush = async (): Promise<void> => {
    if (ops.length === 0) return;
    await cards.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for (const raw of raws) {
    done++;
    const n = normalizeScryfallCard(raw);
    if (!n || digitalOnly.has(n.oracleId)) {
      skipped++;
    } else {
      const doc = toCardDoc(n);
      ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      processed++;
    }
    if (ops.length >= BATCH_SIZE) {
      await flush();
      onProgress?.(done, total);
    }
  }
  await flush();
  onProgress?.(done, total);
  return { processed, skipped };
}

export async function ingestCombos(
  variants: AsyncIterable<SpellbookVariant> | Iterable<SpellbookVariant>,
  combos: Collection<ComboDoc>,
  onProgress?: (done: number) => void,
): Promise<IngestCounts> {
  let processed = 0;
  let skipped = 0;
  let done = 0;
  let ops: AnyBulkWriteOperation<ComboDoc>[] = [];

  const flush = async (): Promise<void> => {
    if (ops.length === 0) return;
    await combos.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const raw of variants) {
    done++;
    const n = normalizeVariant(raw);
    if (!n) {
      skipped++;
    } else {
      const doc: ComboDoc = { _id: n.id, cards: n.combo.cards, result: n.combo.result };
      ops.push({ replaceOne: { filter: { _id: doc._id }, replacement: doc, upsert: true } });
      processed++;
    }
    if (ops.length >= BATCH_SIZE) {
      await flush();
      onProgress?.(done);
    }
  }
  await flush();
  onProgress?.(done);
  return { processed, skipped };
}

/** A carriage-return progress bar; no dependency. Prints a newline when complete. */
function barReporter(label: string): (done: number, total: number) => void {
  const width = 30;
  return (done, total) => {
    const frac = total > 0 ? done / total : 1;
    const filled = Math.round(frac * width);
    const bar = "#".repeat(filled) + "-".repeat(width - filled);
    process.stdout.write(`\r${label} [${bar}] ${Math.round(frac * 100)}% (${done}/${total})`);
    if (done >= total) process.stdout.write("\n");
  };
}

/** Stream reporter with no known total: overwrites a running count. */
function countReporter(label: string): (done: number) => void {
  return (done) => {
    process.stdout.write(`\r${label} ${done} processed`);
  };
}

export async function runIngest(): Promise<void> {
  const store = await connect(loadConfig());
  try {
    console.log("Downloading Scryfall oracle cards...");
    const cardRaws = await fetchOracleCards();
    const digitalOnly = await fetchDigitalOnlyOracleIds();
    console.log(`Excluding ${digitalOnly.size} digital-only (non-paper) cards`);
    const c = await ingestCards(cardRaws, store.cards, barReporter("Cards:"), digitalOnly);
    console.log(`Cards: ${c.processed} processed, ${c.skipped} skipped`);

    console.log("Downloading flavor names...");
    const f = await ingestFlavorNames(await fetchFlavorNames(), store.cards);
    console.log(`Flavor names: ${f.applied} applied, ${f.skipped} skipped`);

    console.log("Downloading Commander Spellbook variants...");
    const k = await ingestCombos(streamVariants(), store.combos, countReporter("Combos:"));
    process.stdout.write("\n");
    console.log(`Combos: ${k.processed} processed, ${k.skipped} skipped`);
  } finally {
    await store.close();
  }
}
