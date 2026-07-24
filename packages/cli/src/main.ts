import { readFileSync } from "node:fs";
import { analyzeDeck, ComboIndex, type Card, type Combo } from "@mtg/engine";
import { analyzeDeckStructured, buildDeckCards, type CardTagsLookup } from "@mtg/matcher";
import {
  loadConfig,
  connect,
  mongoLookup,
  resolveNames,
  parseDecklistSections,
  normalizeName,
  parseMoxfieldId,
  fetchMoxfieldDeck,
} from "@mtg/data";
import { formatReport } from "./report.js";

interface DeckFile {
  cards: Card[];
  combos?: Combo[];
  commanders?: string[];
}

function reportFromJson(path: string): string {
  const deck = JSON.parse(readFileSync(path, "utf8")) as DeckFile;
  const combos = deck.combos ? new ComboIndex(deck.combos) : undefined;
  return formatReport(analyzeDeck(deck.cards, combos, deck.commanders));
}

async function reportFromDecklist(input: string): Promise<string> {
  let commanderNamesTyped: string[] = [];
  let deckNames: string[];
  if (input.includes("moxfield.com")) {
    const id = parseMoxfieldId(input);
    if (!id) throw new Error(`Could not parse Moxfield deck id from: ${input}`);
    deckNames = await fetchMoxfieldDeck(id); // Moxfield path: no commander split (API blocked anyway)
  } else {
    const sections = parseDecklistSections(readFileSync(input, "utf8"));
    commanderNamesTyped = sections.commanders;
    deckNames = sections.deck;
  }

  const store = await connect(loadConfig());
  try {
    const names = [...commanderNamesTyped, ...deckNames];
    const lookup = mongoLookup(store);
    const { cards, combos, missing } = await resolveNames(names, lookup);
    for (const name of missing) {
      console.error(`warning: card not found: ${name}`);
    }
    const cmdNorm = new Set(commanderNamesTyped.map(normalizeName));
    const commanderNames = cards.filter((c) => cmdNorm.has(normalizeName(c.name))).map((c) => c.name);
    const cardTagsCol = store.db.collection("cardTags");
    const tagsLookup: CardTagsLookup = { findOne: (oracleId) => cardTagsCol.findOne({ oracleId }) as never };
    const deckCards = await buildDeckCards(cards, lookup, tagsLookup);
    return formatReport(
      analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos)),
    );
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
