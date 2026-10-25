import { afterAll, beforeAll, expect, test, describe, vi } from "vitest";
import type { Collection } from "mongodb";
import { connect, type Store } from "./db.js";
import { ingestCards, ingestCombos } from "./ingest.js";
import type { CardDoc, ComboDoc } from "./docs.js";
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

/** A collection that holds `stamped` ids as currently carrying `upcoming`, and records writes. */
function fakeCards(bulkWrite: ReturnType<typeof vi.fn>, stamped: string[] = []): Collection<CardDoc> {
  return { bulkWrite, find: vi.fn(() => ({ toArray: async () => stamped.map((_id) => ({ _id })) })) } as unknown as Collection<CardDoc>;
}

test("ingestCards batches upserts via bulkWrite and reports progress (no Mongo)", async () => {
  const bulkWrite = vi.fn(async () => ({}));
  const cards = fakeCards(bulkWrite);
  const progress: Array<[number, number]> = [];
  const counts = await ingestCards(cardRaws, cards, (done, total) => progress.push([done, total]));

  expect(counts).toMatchObject({ processed: 1, skipped: 1, stickers: 0 });
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

test("ingestCards replaces the whole doc, so a released card loses `upcoming` (owner 2026-10-25)", async () => {
  const bulkWrite = vi.fn(async () => ({}));
  const raw: ScryfallCard = {
    oracle_id: "s", name: "Spoiler", type_line: "Creature", oracle_text: "", colors: [], cmc: 1,
    legalities: { commander: "not_legal" }, released_at: "2026-11-13", set_type: "commander", games: ["paper"],
  };
  const replacement = async (today: string, stamped: string[] = []) => {
    bulkWrite.mockClear();
    await ingestCards([raw], fakeCards(bulkWrite, stamped), undefined, new Set(), today);
    const ops = (bulkWrite.mock.calls as unknown as unknown[][])[0][0] as Array<{ replaceOne: { replacement: CardDoc } }>;
    return ops[0].replaceOne.replacement;
  };
  expect((await replacement("2026-10-25")).upcoming).toBe("2026-11-13");
  // Release day and a week on, Scryfall still says not_legal: a card ALREADY stamped keeps it (grace).
  expect((await replacement("2026-11-20", ["s"])).upcoming).toBe("2026-11-13");
  // ...but a card never stamped (a playtest card released into a not_legal set) is not.
  expect("upcoming" in (await replacement("2026-11-20", []))).toBe(false);
  // Scryfall flips a legality: the stamp clears.
  raw.legalities = { commander: "legal" };
  expect("upcoming" in (await replacement("2026-11-20", ["s"]))).toBe(false);
  // Still not_legal 31 days after release: the grace is over.
  raw.legalities = { commander: "not_legal" };
  expect("upcoming" in (await replacement("2026-12-14", ["s"]))).toBe(false);
});

test("ingestCards drops sticker cards and sticker sheets, counted apart (owner 2026-10-14)", async () => {
  const bulkWrite = vi.fn(async () => ({}));
  const cards = fakeCards(bulkWrite);
  const raws: ScryfallCard[] = [
    { oracle_id: "ring", name: "Sol Ring", type_line: "Artifact", oracle_text: "", colors: [], cmc: 1 },
    { oracle_id: "user", name: "Sticky", type_line: "Creature — Elf", oracle_text: "When this enters, put a name sticker on it.", colors: [], cmc: 1 },
    { oracle_id: "sheet", name: "Sticker sheet", type_line: "Stickers", oracle_text: "", colors: [], cmc: 0 },
  ];
  const counts = await ingestCards(raws, cards);
  expect(counts).toMatchObject({ processed: 1, skipped: 2, stickers: 2 });
  expect([...counts.stickerNames].sort()).toEqual(["Sticker sheet", "Sticky"]);
  const ops = (bulkWrite as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ replaceOne: { filter: { _id: string } } }>;
  expect(ops.map((o) => o.replaceOne.filter._id)).toEqual(["ring"]);
});

test("ingestCombos drops a combo naming a sticker card, counted apart (owner 2026-10-14)", async () => {
  const bulkWrite = vi.fn(async () => ({}));
  const combos = { bulkWrite } as unknown as Collection<ComboDoc>;
  const raws: SpellbookVariant[] = [
    { id: "ok", uses: [{ card: { name: "Sol Ring" } }], produces: [{ feature: { name: "Mana" } }] },
    { id: "sticky", uses: [{ card: { name: "Sol Ring" } }, { card: { name: "Sticky // Back" } }], produces: [{ feature: { name: "Win" } }] },
  ];
  const counts = await ingestCombos(raws, combos, undefined, new Set(["Sticky // Back", "Sticky", "Back"]));
  expect(counts).toEqual({ processed: 1, skipped: 1, stickers: 1 });
  const ops = (bulkWrite as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{ replaceOne: { filter: { _id: string } } }>;
  expect(ops.map((o) => o.replaceOne.filter._id)).toEqual(["ok"]);
});

test("ingestCards excludes digital-only oracle ids", async () => {
  const bulkWrite = vi.fn(async () => ({}));
  const cards = fakeCards(bulkWrite);
  const raws: ScryfallCard[] = [
    { oracle_id: "paper", name: "Sol Ring", type_line: "Artifact", oracle_text: "", colors: [], cmc: 1 },
    { oracle_id: "arena", name: "A-Sol Ring", type_line: "Artifact", oracle_text: "", colors: [], cmc: 1 },
  ];
  const counts = await ingestCards(raws, cards, undefined, new Set(["arena"]));

  expect(counts).toMatchObject({ processed: 1, skipped: 1, stickers: 0 });
  const ops = (bulkWrite as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
    replaceOne: { filter: { _id: string } };
  }>;
  expect(ops.map((o) => o.replaceOne.filter._id)).toEqual(["paper"]);
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
    expect(first).toMatchObject({ processed: 1, skipped: 1, stickers: 0 });
    await ingestCombos(comboRaws, store.combos);

    // Re-run: still one card, one combo — upsert, not insert.
    await ingestCards(cardRaws, store.cards);
    await ingestCombos(comboRaws, store.combos);

    expect(await store.cards.countDocuments()).toBe(1);
    expect(await store.combos.countDocuments()).toBe(1);
  });
});
