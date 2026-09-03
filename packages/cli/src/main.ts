import { readFileSync } from "node:fs";
import { analyzeDeck, ComboIndex, type Card, type Combo } from "@edh-seer/engine";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags, type CardTagsLookup } from "@edh-seer/matcher";
import { createTagsLookup } from "@edh-seer/tagger";
import {
  loadConfig,
  connect,
  mongoLookup,
  resolveNames,
  parseDecklistSections,
  normalizeName,
  parseMoxfieldId,
  fetchMoxfieldDeck,
  parseArchidektId,
  fetchArchidektDeck,
  isMoxfieldUrl,
  isArchidektUrl,
  type DeckSections,
} from "@edh-seer/data";
import { formatReport } from "./report.js";

interface DeckFile {
  cards: Card[];
  combos?: Combo[];
  commanders?: string[];
}

function reportFromJson(path: string, trim: number): string {
  const deck = JSON.parse(readFileSync(path, "utf8")) as DeckFile;
  const combos = deck.combos ? new ComboIndex(deck.combos) : undefined;
  return formatReport(analyzeDeck(deck.cards, combos, deck.commanders), trim);
}


/** A URL on a known host, or a path to a decklist file. Both sides return the same split, so the
 *  commander section is real for an imported deck too -- the Moxfield path used to hand back one
 *  flat list, which left `SubjectFilter.commander` with nothing to fire on. */
async function readDeck(input: string): Promise<DeckSections> {
  if (isMoxfieldUrl(input)) {
    const id = parseMoxfieldId(input);
    if (!id) throw new Error(`Could not parse Moxfield deck id from: ${input}`);
    const ua = process.env.MOXFIELD_UA ?? "";
    if (!ua.trim()) {
      throw new Error(
        "MOXFIELD_UA is not set. Moxfield issues a per-consumer User-Agent and rate-limits us to " +
          "1 request/second; importing without it is the thing we agreed not to do.",
      );
    }
    return fetchMoxfieldDeck(id, ua);
  }
  if (isArchidektUrl(input)) {
    const id = parseArchidektId(input);
    if (!id) throw new Error(`Could not parse Archidekt deck id from: ${input}`);
    return fetchArchidektDeck(id);
  }
  return parseDecklistSections(readFileSync(input, "utf8"));
}

async function reportFromDecklist(input: string, trim: number): Promise<string> {
  const sections = await readDeck(input);
  const commanderNamesTyped = sections.commanders;
  const deckNames = sections.deck;

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
    const tagsLookup: CardTagsLookup = createTagsLookup(store.db);
    const deckCards = await buildDeckCards(cards, lookup, tagsLookup);
    // TOKENS ARE NODES HERE TOO. Omitting `tokenTags` is not a lighter run, it is the PRE-TOKEN
    // engine: no token nodes, so no two-hop mediation, so different partner counts and different
    // ratings from the same deck the web server rates. Found 2026-08-18 by the same deck printing
    // one partner count in the CLI and another through the API.
    const tokenTags = await loadTokenTags(store.db);
    return formatReport(
      analyzeDeckStructured(deckCards, commanderNames, undefined, undefined, new ComboIndex(combos), undefined, tokenTags),
      trim,
    );
  } finally {
    await store.close();
  }
}

async function main(): Promise<void> {
  const input = process.argv[2];
  // `--trim N`: "I'm N over, what goes?" Off by default — the list always has an answer, and an
  // unasked-for one reads as a verdict.
  const trimArg = process.argv.indexOf("--trim");
  const trim = trimArg > 0 ? Number(process.argv[trimArg + 1] ?? 0) : 0;
  if (!input) {
    console.error("Usage: tsx src/main.ts <deck.json | deck.txt | moxfield-url> [--trim N]");
    process.exit(1);
  }
  const report = input.endsWith(".json")
    ? reportFromJson(input, trim)
    : await reportFromDecklist(input, trim);
  console.log(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
