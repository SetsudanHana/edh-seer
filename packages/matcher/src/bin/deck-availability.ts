import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAbsolute, join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { deckAvailability, type AvailabilityRow } from "../availability.js";
import { loadHierarchy } from "../hierarchy.js";
import type { DeckCard } from "../types.js";

/** Prints one deck's demand shapes against how likely you are to have anything answering them.
 *
 *  Free to run -- Mongo reads only, no model. `npx tsx packages/matcher/src/bin/deck-availability.ts
 *  packages/cli/decks/inalla.txt [turn]`.
 *
 *  The row to read is a big `consumers` next to a small `avail`: many cards waiting on something
 *  the deck rarely has. A big `consumers` next to a `--` is not a defect, it is a combat trigger
 *  the game itself supplies. */
const pct = (row: AvailabilityRow): string =>
  row.available === null ? "  --  " : `${(row.available * 100).toFixed(1).padStart(5)}%`;

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: deck-availability <decklist.txt> [turn]");
    process.exit(2);
  }
  const turn = Number(process.argv[3] ?? 5);
  const path = isAbsolute(file) ? file : join(process.cwd(), file);

  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = store.db.collection("cardTags");

  const sections = parseDecklistSections(readFileSync(path, "utf8"));
  const inputs: DeckCard[] = [];
  let untagged = 0;
  for (const name of [...sections.commanders, ...sections.deck]) {
    const doc = await lookup.findByName(normalizeName(name));
    if (!doc) continue;
    const tags = (await cardTags.findOne({ oracleId: doc._id })) as CardTags | null;
    if (!tags) untagged++;
    inputs.push({ card: docToCard(doc), tags });
  }

  const rows = deckAvailability(inputs, loadHierarchy(), { turn, commanderNames: sections.commanders });
  const library = inputs.length - sections.commanders.length;

  console.log(`\n${file} — ${inputs.length} cards (${library} in library, ${untagged} untagged), turn ${turn}, ${7 + turn} seen\n`);
  console.log("consumers  suppliers   avail  shape");
  for (const r of rows) {
    if (r.consumers === 0) continue;
    const zone = r.fromCommandZone ? " (command zone)" : "";
    console.log(
      `${String(r.consumers).padStart(9)}  ${String(r.suppliers).padStart(9)}  ${pct(r)}  ${r.key}${zone}`,
    );
  }
  console.log(
    "\nUnweighted supply: four Ashnod's Altars and four Fling effects count the same here.\n" +
    "No mulligans, no opponent, and seen(T) = 7 + T ignores draw, so every figure is conservative.",
  );
  await store.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("deck-availability failed:", err);
    process.exit(1);
  });
}
