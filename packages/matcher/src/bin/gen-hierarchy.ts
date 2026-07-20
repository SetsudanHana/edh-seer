import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { Collection } from "mongodb";
import { connect, loadConfig } from "@mtg/data";
import { buildHierarchy } from "../hierarchy.js";

/** Pull every non-empty typeLine out of the cards collection. Exported for testing against a fake collection. */
export async function fetchTypeLines(
  cards: Pick<Collection, "find">,
): Promise<string[]> {
  const docs = cards.find({}, { projection: { typeLine: 1 } }) as unknown as AsyncIterable<{
    typeLine?: string;
  }>;
  const lines: string[] = [];
  for await (const d of docs) if (d.typeLine) lines.push(d.typeLine);
  return lines;
}

async function main(): Promise<void> {
  const store = await connect(loadConfig());
  const lines = await fetchTypeLines(store.db.collection("cards"));
  const h = buildHierarchy(lines);
  await store.close();
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "hierarchy.json");
  writeFileSync(path, JSON.stringify(h, null, 0) + "\n");
  console.log(`wrote ${Object.keys(h).length} subtypes from ${lines.length} type-lines to ${path}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("gen-hierarchy failed:", err);
    process.exit(1);
  });
}
