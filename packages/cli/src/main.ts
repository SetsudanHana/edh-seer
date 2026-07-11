import { readFileSync } from "node:fs";
import { analyzeDeck, ComboIndex, type Card, type Combo } from "@mtg/engine";
import { formatReport } from "./report.js";

interface DeckFile {
  cards: Card[];
  combos?: Combo[];
}

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: tsx src/main.ts <deck.json>");
    process.exit(1);
  }
  const deck = JSON.parse(readFileSync(path, "utf8")) as DeckFile;
  const combos = deck.combos ? new ComboIndex(deck.combos) : undefined;
  const report = analyzeDeck(deck.cards, combos);
  console.log(formatReport(report));
}

main();
