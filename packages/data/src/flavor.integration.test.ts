import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { connect, mongoLookup, type Store } from "./db.js";
import { ingestFlavorNames } from "./flavor.js";
import { normalizeName } from "./names.js";
import type { CardDoc } from "./docs.js";

const uri = process.env.MONGO_TEST_URI;
const suite = uri ? describe : describe.skip;

suite("ingestFlavorNames", () => {
  let store: Store;

  const snuffOut: CardDoc = {
    _id: "snuff-out-oracle",
    name: "Snuff Out",
    typeLine: "Instant",
    oracleText: "",
    keywords: [],
    colors: ["B"],
    manaValue: 4,
    tags: { produces: [], cares: [] },
    searchNames: ["snuff out"],
  };

  beforeAll(async () => {
    store = await connect({ mongoUri: uri!, dbName: "mtg_flavor_test" });
    await store.cards.deleteMany({});
    await store.cards.insertOne(snuffOut);
  });

  afterAll(async () => {
    await store.cards.deleteMany({});
    await store.close();
  });

  test("adds the normalized flavor name and makes the card resolvable by it", async () => {
    const counts = await ingestFlavorNames(
      [{ oracleId: "snuff-out-oracle", flavorName: "Beholder's Death Ray" }],
      store.cards,
    );
    expect(counts).toEqual({ applied: 1, skipped: 0 });

    const doc = await store.cards.findOne({ _id: "snuff-out-oracle" });
    expect(doc?.searchNames).toContain(normalizeName("Beholder's Death Ray"));

    const found = await mongoLookup(store).findByName(normalizeName("Beholder's Death Ray"));
    expect(found?.name).toBe("Snuff Out");
  });

  test("is idempotent — a re-run adds no duplicate searchName", async () => {
    await ingestFlavorNames(
      [{ oracleId: "snuff-out-oracle", flavorName: "Beholder's Death Ray" }],
      store.cards,
    );
    const doc = await store.cards.findOne({ _id: "snuff-out-oracle" });
    const normalized = normalizeName("Beholder's Death Ray");
    expect(doc?.searchNames.filter((n) => n === normalized)).toHaveLength(1);
  });

  test("skips a pair whose oracle_id is not in the collection", async () => {
    const counts = await ingestFlavorNames(
      [{ oracleId: "does-not-exist", flavorName: "Whatever" }],
      store.cards,
    );
    expect(counts).toEqual({ applied: 0, skipped: 1 });
  });
});
