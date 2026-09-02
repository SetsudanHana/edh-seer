import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  connect, docToCard, loadConfig, mongoLookup, normalizeName, parseDecklistSections,
} from "@edh-seer/data";
import { createTagsLookup } from "@edh-seer/tagger";
import { ComboIndex } from "@edh-seer/engine";
import { analyzeDeckStructured } from "../analyze.js";
import { loadTokenTags } from "../token-tags.js";
import type { DeckCard } from "../types.js";

/** WHAT READING THE TOKEN'S OWN SUBTYPE COSTS THE ARCHETYPE RANKING (roadmap T2b).
 *
 *  The Tokens row matches on the EFFECT KIND `token-generation`, which carries no token identity,
 *  while the guard that drops resource tokens read only `create-token:<subtype>` theme tags -- which
 *  most of these cards do not have. So every Treasure maker voted the deck a Tokens deck.
 *
 *  Run it on both sides of the change and diff the files:
 *    set -a && source packages/tagger/.env && set +a
 *    npx tsx packages/matcher/src/bin/archetype-token-kinds.ts /tmp/after.json
 *    git stash && npx tsx ... /tmp/before.json && git stash pop
 *
 *  Free: Mongo reads only, no API, no writes.
 */
const DIR = join(process.cwd(), "packages", "cli", "decks", "calibration");

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) { console.log("usage: archetype-token-kinds.ts <out.json>"); return; }
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const cardTags = createTagsLookup(store.db);
  const tokenTags = await loadTokenTags(store.db);

  const rows: Record<string, { top: string; tokens: number; all: string[] }> = {};
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".txt")).sort()) {
    const sec = parseDecklistSections(readFileSync(join(DIR, f), "utf8"));
    const inputs: DeckCard[] = [];
    for (const name of [...sec.commanders, ...sec.deck]) {
      const doc = await lookup.findByName(normalizeName(name));
      if (!doc) continue;
      inputs.push({ card: docToCard(doc), tags: await cardTags.findOne(String(doc._id)) });
    }
    const r = analyzeDeckStructured(
      inputs, sec.commanders, undefined, undefined, new ComboIndex([]), undefined, tokenTags,
    ) as unknown as { strategies?: { name: string; label: string; confidence: number }[] };
    const s = r.strategies ?? [];
    rows[f.replace(/\.txt$/, "")] = {
      top: s[0]?.label ?? "(none)",
      tokens: Math.round(((s.find((x) => x.name === "tokens")?.confidence) ?? 0) * 1000) / 10,
      all: s.slice(0, 3).map((x) => x.label),
    };
  }
  await store.close();
  writeFileSync(out, JSON.stringify(rows, null, 1));
  console.log(`wrote ${Object.keys(rows).length} decks to ${out}`);
}

void main();
