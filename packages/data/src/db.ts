import { MongoClient, type Collection, type Db } from "mongodb";
import type { DataConfig } from "./config.js";
import type { CardDoc, ComboDoc } from "./docs.js";
import { normalizeName } from "./names.js";
import type { CardLookup } from "./resolve.js";

export interface Store {
  cards: Collection<CardDoc>;
  combos: Collection<ComboDoc>;
  db: Db;
  close(): Promise<void>;
}

export async function connect(config: DataConfig): Promise<Store> {
  const client = new MongoClient(config.mongoUri);
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Cannot reach MongoDB at ${config.mongoUri}. Start it with: ` +
        `docker compose -f packages/data/docker-compose.yml up -d`,
      { cause: err },
    );
  }
  const db = client.db(config.dbName);
  const cards = db.collection<CardDoc>("cards");
  const combos = db.collection<ComboDoc>("combos");
  await cards.createIndex({ searchNames: 1 });
  return { cards, combos, db, close: () => client.close() };
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
