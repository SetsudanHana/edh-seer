import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistSections, resolveNames, CALIBRATION_DECKS } from "@edh-seer/data";
import { ComboIndex } from "@edh-seer/engine";
import { createTagsLookup, DERIVE_VERSION } from "@edh-seer/tagger";
import { analyzeDeckStructured, buildDeckCards, loadTokenTags } from "../index.js";
import { computeRelationStats } from "../relation-stats.js";

/** THE CROSS-DECK RARITY OF THE OWN-THEME RELATION TAGS, committed as `packages/matcher/relation-stats.json`
 *  (#1095). Usage: `npm run gen:relation-stats -w @edh-seer/matcher` -- free: Mongo, no model. Analyses every
 *  calibration deck and counts, per own-theme reason tag, the decks that have it. Regenerate after any DERIVE
 *  bump or an edit to the channels that write these tags (`relation-stats.test.ts` pins the version). */
async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lookup = mongoLookup(store);
  const tags = createTagsLookup(store.db);
  const tokenTags = await loadTokenTags(store.db);
  const perDeck: string[][] = [];
  for (const file of readdirSync(CALIBRATION_DECKS).filter((f) => f.endsWith(".txt")).sort()) {
    const sections = parseDecklistSections(readFileSync(join(CALIBRATION_DECKS, file), "utf8"));
    const { cards, combos } = await resolveNames([...sections.commanders, ...sections.deck], lookup);
    const cmd = new Set(sections.commanders.map(normalizeName));
    const commanders = cards.filter((c) => cmd.has(normalizeName(c.name))).map((c) => c.name);
    const report = analyzeDeckStructured(await buildDeckCards(cards, lookup, tags), commanders, undefined, undefined, new ComboIndex(combos), undefined, tokenTags);
    perDeck.push((report.edges as { reasons: { tag: string }[] }[]).flatMap((e) => e.reasons.map((r) => r.tag)));
  }
  await store.close();
  const stats = computeRelationStats(perDeck, DERIVE_VERSION);
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "relation-stats.json");
  writeFileSync(path, JSON.stringify(stats) + "\n");
  console.log(`wrote ${Object.keys(stats.counts).length} relation tags over ${stats.N} decks (DERIVE ${DERIVE_VERSION}) to ${path}`);
}

main().catch((err) => { console.error("gen-relation-stats failed:", err); process.exit(1); });
