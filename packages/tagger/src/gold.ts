import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Card } from "@mtg/engine";
import type { CardTags } from "./schema.js";

export interface GoldCard {
  oracleId: string;
  card: Card;
  expected: CardTags;
}

const DEFAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "gold");

export function loadGold(dir: string = DEFAULT_DIR): GoldCard[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GoldCard);
}
