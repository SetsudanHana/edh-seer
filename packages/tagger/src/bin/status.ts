import { connect, loadConfig, type CardDoc } from "@edh-seer/data";
import { needsRetag, type TagCollection } from "../store.js";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import { coverageReport } from "./corpus-core.js";

// Usage: status [--cutoff N]   (default cutoff 20000 = "broadly playable")
async function main(): Promise<void> {
  const idx = process.argv.indexOf("--cutoff");
  const cutoff = idx >= 0 ? Number(process.argv[idx + 1]) : 20000;
  const store = await connect(loadConfig());
  const cards = (await store.db.collection("cards").find({}).toArray()) as unknown as CardDoc[];
  const doneIds = new Set<string>();
  for (const t of await store.db.collection("cardTags").find({}).toArray()) {
    if (!needsRetag(t as never, SCHEMA_VERSION, PROMPT_VERSION)) doneIds.add((t as unknown as { oracleId: string }).oracleId);
  }
  const r = coverageReport(cards, doneIds, cutoff);
  console.log(`corpus tagging status (schema ${SCHEMA_VERSION}, prompt ${PROMPT_VERSION}):`);
  console.log(`  tagged:    ${r.tagged}/${r.total} text cards`);
  console.log(`  remaining under edhrecRank ${cutoff}: ${r.remainingUnderCutoff}`);
  console.log(`  next untagged rank: ${r.nextRank ?? "none (all ranked cards tagged)"}`);
  await store.close();
}

main().catch((e) => { console.error("status failed:", e); process.exit(1); });
