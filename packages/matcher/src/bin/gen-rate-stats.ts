/** THE RATE QUANTILES PER FAMILY (roadmap Y9), committed as `packages/matcher/rate-stats.json`.
 *
 *  Usage: tsx src/bin/gen-rate-stats.ts        -- reads Mongo (cards + cardTagsDerived), writes the file
 *
 *  The same population `build-static.ts` gives a page: every card with derived tags, a card legal
 *  in no format left out. Regenerate after any DERIVE bump or `rate.ts` change, or the percentiles
 *  describe a corpus the rate no longer reads. */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connect, docToCard, loadConfig } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
import { computeRateStats } from "../rate-stats.js";
import type { DeckCard } from "../types.js";

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const tags = new Map<string, CardTags>();
  for await (const t of store.db.collection<CardTags>("cardTagsDerived").find({})) tags.set(t.oracleId, t);
  const cards: DeckCard[] = [];
  for await (const card of store.cards.find({})) {
    const legalities = (card as { legalities?: Record<string, string> }).legalities;
    if (legalities && !Object.values(legalities).some((v) => v !== "not_legal")) continue;
    const t = tags.get(card._id);
    if (!t) continue;
    cards.push({ card: { ...card, ...docToCard(card) }, tags: t } as unknown as DeckCard);
  }
  await store.close();
  const stats = computeRateStats(cards);
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "rate-stats.json");
  writeFileSync(path, JSON.stringify(stats) + "\n");
  console.log(`wrote ${Object.keys(stats).length} families from ${cards.length} cards to ${path}`);
}

main().catch((err) => { console.error("gen-rate-stats failed:", err); process.exit(1); });
