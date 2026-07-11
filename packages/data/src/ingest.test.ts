import { afterAll, beforeAll, expect, test, describe } from "vitest";
import { connect, type Store } from "./db.js";
import { ingestCards, ingestCombos } from "./ingest.js";
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
