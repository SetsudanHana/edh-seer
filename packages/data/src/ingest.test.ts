import { afterAll, beforeAll, expect, test, describe, vi } from "vitest";
import type { Collection } from "mongodb";
import { connect, type Store } from "./db.js";
import { ingestCards, ingestCombos } from "./ingest.js";
import type { CardDoc } from "./docs.js";
import type { ScryfallCard } from "./scryfall.js";
import type { SpellbookVariant } from "./spellbook.js";

const uri = process.env.MONGO_TEST_URI;
const suite = uri ? describe : describe.skip;

const cardRaws: ScryfallCard[] = [
  { oracle_id: "a", name: "Sol Ring", type_line: "Artifact", oracle_text: "", colors: [], cmc: 1 },
  { name: "malformed — no id" },
];
const comboRaws: SpellbookVariant[] = [
  { id: "v1", uses: [{ card: { name: "A" } }], produces: [{ feature: { name: "Win" } }] },
  { id: "bad", uses: [], produces: [] },
];

test("ingestCards batches upserts via bulkWrite and reports progress (no Mongo)", async () => {
  const bulkWrite = vi.fn(async () => ({}));
  const cards = { bulkWrite } as unknown as Collection<CardDoc>;
  const progress: Array<[number, number]> = [];
  const counts = await ingestCards(cardRaws, cards, (done, total) => progress.push([done, total]));

  expect(counts).toEqual({ processed: 1, skipped: 1 });
  // One bulkWrite call carrying a single replaceOne-upsert op (Sol Ring); malformed skipped.
  expect(bulkWrite).toHaveBeenCalledTimes(1);
  const ops = (bulkWrite as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
    replaceOne: { filter: { _id: string }; upsert: boolean };
  }>;
  expect(ops).toHaveLength(1);
  expect(ops[0].replaceOne.upsert).toBe(true);
  expect(ops[0].replaceOne.filter._id).toBe("a");
  // Progress ends at total (2 raws seen).
  expect(progress.at(-1)).toEqual([2, 2]);
});

suite("ingest idempotency", () => {
  let store: Store;

  beforeAll(async () => {
    store = await connect({ mongoUri: uri!, dbName: "mtg_ingest_test" });
    await store.cards.deleteMany({});
    await store.combos.deleteMany({});
  });

  afterAll(async () => {
    await store.cards.deleteMany({});
    await store.combos.deleteMany({});
    await store.close();
  });

  test("counts processed/skipped and upserts without duplicates on re-run", async () => {
    const first = await ingestCards(cardRaws, store.cards);
    expect(first).toEqual({ processed: 1, skipped: 1 });
    await ingestCombos(comboRaws, store.combos);

    // Re-run: still one card, one combo — upsert, not insert.
    await ingestCards(cardRaws, store.cards);
    await ingestCombos(comboRaws, store.combos);

    expect(await store.cards.countDocuments()).toBe(1);
    expect(await store.combos.countDocuments()).toBe(1);
  });
});
