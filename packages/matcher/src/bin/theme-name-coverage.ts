import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured } from "../analyze.js";
import { loadTokenTags } from "../token-tags.js";
import type { DeckCard } from "../types.js";

/** HOW MANY DECKS GET A NAME A PLAYER USES (roadmap T2).
 *
 *  `theme-names.ts` is a table plus one typal rule, and the question it has to answer is what share
 *  of real decks it reaches -- a table that names 12 of 71 is not vocabulary, it is decoration.
 *  Prints every deck that still falls back to the mechanical phrase, because that list is the input
 *  to the next edit of the table.
 *
 *  Free: Mongo reads only, no API, no writes.
 *
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/theme-name-coverage.ts
 */
const DECK_DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);
  const tokenTags = await loadTokenTags(store.db);

  let named = 0, fellBack = 0, declined = 0;
  const byName = new Map<string, number>();
  const misses = new Map<string, string>();

  for (const file of readdirSync(DECK_DIR).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(DECK_DIR, file), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sections.commanders, ...sections.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      inputs.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
    }
    const r = analyzeDeckStructured(
      inputs, sections.commanders, undefined, undefined, new ComboIndex([]), undefined, tokenTags,
    ) as unknown as { cohesion?: { theme: string; name: string; tag: string; dominant: boolean } | null };
    const c = r.cohesion;
    if (!c || c.dominant === false) { declined++; continue; }
    if (c.name === c.theme) { fellBack++; misses.set(c.tag, c.theme); }
    else { named++; byName.set(c.name, (byName.get(c.name) ?? 0) + 1); }
  }
  await store.close();

  const total = named + fellBack;
  console.log(`named decks: ${total} (+${declined} that decline to be named)`);
  console.log(`given a player's name: ${named} (${(named / total * 100).toFixed(1)}%)`);
  console.log(`kept the mechanism:    ${fellBack} (${(fellBack / total * 100).toFixed(1)}%)`);
  console.log(`\nnames in use:`);
  for (const [n, k] of [...byName.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(k).padStart(2)}  ${n}`);
  if (misses.size > 0) {
    console.log(`\nstill mechanical -- the input to the next edit of the table:`);
    for (const [tag, theme] of [...misses.entries()].sort()) console.log(`  ${tag.padEnd(26)} ${theme}`);
  }
}

void main();
