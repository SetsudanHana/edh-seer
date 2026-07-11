import { MongoClient, type Collection } from "mongodb";
import type { DataConfig } from "./config.js";
import type { CardDoc, ComboDoc } from "./docs.js";
import { normalizeName } from "./names.js";
import type { CardLookup } from "./resolve.js";

export interface Store {
  cards: Collection<CardDoc>;
  combos: Collection<ComboDoc>;
  close(): Promise<void>;
}

export async function connect(config: DataConfig): Promise<Store> {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  const db = client.db(config.dbName);
  const cards = db.collection<CardDoc>("cards");
  const combos = db.collection<ComboDoc>("combos");
  await cards.createIndex({ searchNames: 1 });
  return { cards, combos, close: () => client.close() };
}

export function mongoLookup(store: Store): CardLookup {
  return {
    async findByName(normalized: string) {
      return store.cards.findOne({ searchNames: normalized });
    },
    async allCombos() {
      return store.combos.find().toArray();
    },
  };
}

export { normalizeName };
