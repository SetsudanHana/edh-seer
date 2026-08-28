import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Collection } from "mongodb";
import { connect, loadConfig } from "@edh-seer/data";
import type { CardTags } from "@edh-seer/tagger";
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
  // THE SAME POPULATION THE ENGINE REASONS OVER. `TAGS_SOURCE` has defaulted to `derived` since
  // 2026-08-06, but this generator read the FLAT `cardTags` collection, so the committed artifact
  // described a corpus the matcher no longer uses -- N=20,410 flat-era cards against 2,541 derived
  // ones, with a different tag vocabulary. `globalIDF` scores an ABSENT tag `log(N+1)`, the maximum,
  // so every tag the derived layer invented after the artifact was built looked maximally rare and
  // dominated the axis: `lose-life:opp` was absent, and orzhov-spellslinger themed as "lose life".
  const source = process.env.TAGS_SOURCE === "flat" ? "cardTags" : "cardTagsDerived";
  const docs = await fetchTagDocs(store.db.collection<CardTags>(source));
  const stats = computeThemeStats(docs);
  await store.close();
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "theme-stats.json");
  writeFileSync(path, JSON.stringify(stats, null, 0) + "\n");
  console.log(`wrote ${Object.keys(stats.counts).length} theme tags from ${stats.N} cards to ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error("gen-theme-stats failed:", err); process.exit(1); });
}
