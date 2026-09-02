import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { manaModel } from "../goldfish.js";
import type { DeckCard } from "../types.js";

/** WHAT CONDITIONING CASTABILITY ON HOLDING THE CARD COSTS AND BUYS (roadmap T18b).
 *
 *  The per-card figure used to divide by every trial, including the ~92% where the card was never
 *  drawn. This reports the new denominators -- how many trials actually count -- so the refusal floor
 *  is chosen against measured counts rather than guessed, and the size of the move.
 *
 *  Free: Mongo reads only, no API, no writes.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/castability-conditional.ts [deck-name]
 */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);

  const only = process.argv[2];
  const files = readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()
    .filter((f) => only === undefined || f.replace(/\.txt$/, "") === only);

  const heldByTurn = new Map<number, number[]>();
  let cells = 0, thin = 0;
  const started = Date.now();

  for (const file of files) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      inputs.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
    }
    const commanders = new Set(sections.commanders);
    const library = inputs.filter((dc) => !commanders.has(dc.card.name));
    const model = manaModel(library, { alsoPrice: inputs.filter((dc) => commanders.has(dc.card.name)), ...(process.env.TRIALS ? { trials: Number(process.env.TRIALS) } : {}) });

    for (const [name, curve] of model.curves) {
      // Only the cell each card is actually PRICED at -- its own mana value -- because that is the
      // only one the report prints.
      const dc = inputs.find((x) => x.card.name === name);
      if (!dc) continue;
      const turn = Math.max(1, Math.round(dc.card.manaValue));
      const h = curve.held[turn - 1];
      if (h === undefined) continue;
      cells++;
      if (h < 100) thin++;
      const list = heldByTurn.get(turn) ?? [];
      list.push(h);
      heldByTurn.set(turn, list);
      if (only !== undefined && /Curse of Opulence|The Rani/.test(name)) {
        console.log(`${name}: turn ${turn}, held ${h} trials, castable `
          + `${(curve.castable[turn - 1].low * 100).toFixed(1)}-${(curve.castable[turn - 1].high * 100).toFixed(1)}%`);
      }
    }
  }
  await store.close();

  const median = (xs: number[]): number => {
    const s = xs.slice().sort((a, b) => a - b);
    return s.length === 0 ? 0 : s[Math.floor(s.length / 2)];
  };
  console.log(`\n${files.length} deck(s), ${cells} priced cells, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`cells with fewer than 100 held trials: ${thin} (${(thin / cells * 100).toFixed(1)}%)`);
  console.log(`held trials by deadline turn (of ${process.env.TRIALS ?? "REPORT_TRIALS"}):`);
  for (const turn of [...heldByTurn.keys()].sort((a, b) => a - b)) {
    const xs = heldByTurn.get(turn)!;
    console.log(`  turn ${String(turn).padStart(2)}: n=${String(xs.length).padStart(5)}  median ${median(xs)}  min ${Math.min(...xs)}`);
  }
}

void main();
