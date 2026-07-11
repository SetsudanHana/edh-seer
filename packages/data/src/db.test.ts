import { afterAll, beforeAll, expect, test, describe } from "vitest";
import { connect, mongoLookup, type Store } from "./db.js";
import type { CardDoc } from "./docs.js";

const uri = process.env.MONGO_TEST_URI;
const suite = uri ? describe : describe.skip;

suite("mongo db layer", () => {
  let store: Store;

  beforeAll(async () => {
    store = await connect({ mongoUri: uri!, dbName: "mtg_test_db" });
    await store.cards.deleteMany({});
    await store.combos.deleteMany({});
  });

  afterAll(async () => {
    await store.cards.deleteMany({});
    await store.combos.deleteMany({});
    await store.close();
  });

  test("mongoLookup.findByName matches on searchNames", async () => {
    const card: CardDoc = {
      _id: "sol",
      name: "Sol Ring",
      typeLine: "Artifact",
      oracleText: "",
      keywords: [],
      colors: [],
      manaValue: 1,
      tags: { produces: [], cares: [] },
      searchNames: ["sol ring"],
    };
    await store.cards.replaceOne({ _id: "sol" }, card, { upsert: true });

    const lookup = mongoLookup(store);
    const found = await lookup.findByName("sol ring");
    expect(found?.name).toBe("Sol Ring");
    expect(await lookup.findByName("nonexistent")).toBeNull();
  });
});
