import { readFileSync } from "node:fs";
import { analyzeDeck, ComboIndex, type Card, type Combo } from "@mtg/engine";
import {
  loadConfig,
  connect,
  mongoLookup,
  resolveNames,
  parseDecklistText,
  parseMoxfieldId,
  fetchMoxfieldDeck,
} from "@mtg/data";
import { formatReport } from "./report.js";

interface DeckFile {
  cards: Card[];
  combos?: Combo[];
}

function reportFromJson(path: string): string {
  const deck = JSON.parse(readFileSync(path, "utf8")) as DeckFile;
  const combos = deck.combos ? new ComboIndex(deck.combos) : undefined;
  return formatReport(analyzeDeck(deck.cards, combos));
}

async function reportFromDecklist(input: string): Promise<string> {
  let names: string[];
  if (input.includes("moxfield.com")) {
    const id = parseMoxfieldId(input);
    if (!id) throw new Error(`Could not parse Moxfield deck id from: ${input}`);
    names = await fetchMoxfieldDeck(id);
  } else {
    names = parseDecklistText(readFileSync(input, "utf8"));
  }

  const store = await connect(loadConfig());
  try {
    const { cards, combos, missing } = await resolveNames(names, mongoLookup(store));
    for (const name of missing) {
      console.error(`warning: card not found: ${name}`);
    }
    return formatReport(analyzeDeck(cards, new ComboIndex(combos)));
  } finally {
    await store.close();
  }
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: tsx src/main.ts <deck.json | deck.txt | moxfield-url>");
    process.exit(1);
  }
  const report = input.endsWith(".json")
    ? reportFromJson(input)
    : await reportFromDecklist(input);
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
