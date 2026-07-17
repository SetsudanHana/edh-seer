import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadConfig, connect, docToCard } from "@mtg/data";
import { extractTags } from "../src/tags.js";
import type { TagStats } from "../src/weights.js";

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  try {
    const counts: Record<string, number> = {};
    let N = 0;
    for await (const doc of store.cards.find()) {
      const card = docToCard(doc);
      N += 1;
      const { produces, cares } = extractTags(card);
      for (const t of new Set<string>([...produces, ...cares])) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    const stats: TagStats = { N, counts };
    const out = fileURLToPath(new URL("../src/tag-weights.json", import.meta.url));
    writeFileSync(out, JSON.stringify(stats) + "\n");
    console.log(`wrote ${out}: N=${N}, ${Object.keys(counts).length} tags`);
  } finally {
    await store.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
