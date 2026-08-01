import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Collection } from "mongodb";
import { connect, loadConfig } from "@mtg/data";
import type { CardTags } from "@mtg/tagger";
import { computeThemeStats } from "../theme-stats.js";

/** Pull every cardTags document. Exported for testing against a fake collection. */
export async function fetchTagDocs(cardTags: Pick<Collection, "find">): Promise<CardTags[]> {
  const docs = cardTags.find({}) as unknown as AsyncIterable<CardTags>;
  const out: CardTags[] = [];
  for await (const d of docs) out.push(d);
  return out;
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const docs = await fetchTagDocs(store.db.collection<CardTags>("cardTags"));
  const stats = computeThemeStats(docs);
  await store.close();
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "theme-stats.json");
  writeFileSync(path, JSON.stringify(stats, null, 0) + "\n");
  console.log(`wrote ${Object.keys(stats.counts).length} theme tags from ${stats.N} cards to ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error("gen-theme-stats failed:", err); process.exit(1); });
}
