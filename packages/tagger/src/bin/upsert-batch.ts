import { readFileSync } from "node:fs";
import { connect, loadConfig, docToCard } from "@mtg/data";
import { upsertCardTags, type TagCollection } from "../store.js";
import { cardTagsFromRawAbilities } from "./corpus-core.js";

const MODEL = "claude-haiku-4-5-subagent";

// Usage: upsert-batch <batch-file.json> <subagent-out.json>
// batch file: [{ oracleId, name, oracleText }]; out file: [{ oracleId, abilities }]
async function main(): Promise<void> {
  const [batchFile, outFile] = process.argv.slice(2);
  if (!batchFile || !outFile) throw new Error("usage: upsert-batch <batch-file> <out-file>");
  const results = JSON.parse(readFileSync(outFile, "utf8")) as { oracleId: string; abilities: unknown[] }[];

  const store = await connect(loadConfig());
  const cardTags = store.db.collection("cardTags") as unknown as TagCollection;
  let ok = 0; const failed: string[] = [];
  for (const r of results) {
    const doc = await store.cards.findOne({ _id: r.oracleId });
    if (!doc) { failed.push(`${r.oracleId} (card doc missing)`); continue; }
    try {
      await upsertCardTags(cardTags, cardTagsFromRawAbilities(r.oracleId, docToCard(doc), r.abilities ?? [], MODEL));
      ok++;
    } catch (e) { failed.push(`${doc.name}: ${(e as Error).message}`); }
  }
  console.log(`upserted ${ok}/${results.length}; ${failed.length} failed (left untagged, will re-queue).`);
  for (const f of failed) console.log(`  FAILED ${f}`);
  await store.close();
}

main().catch((e) => { console.error("upsert-batch failed:", e); process.exit(1); });
