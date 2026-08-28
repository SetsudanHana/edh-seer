import { connect, loadConfig } from "@edh-seer/data";
import { needsRetag } from "../store.js";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import { sample } from "./corpus-core.js";

// Usage: audit [--sample K]  — print K random current-version tagged cards for spot-check.
async function main(): Promise<void> {
  const idx = process.argv.indexOf("--sample");
  const k = idx >= 0 ? Number(process.argv[idx + 1]) : 15;
  const store = await connect(loadConfig());
  const tagged = (await store.db.collection("cardTags").find({}).toArray())
    .filter((t) => !needsRetag(t as never, SCHEMA_VERSION, PROMPT_VERSION)) as unknown as {
      oracleId: string; abilities: unknown[];
    }[];
  for (const t of sample(tagged, k, Math.random)) {
    const card = await store.cards.findOne({ _id: t.oracleId });
    console.log(`\n=== ${card?.name ?? t.oracleId} ===`);
    console.log(`oracle: ${card?.oracleText ?? ""}`);
    console.log(`abilities: ${JSON.stringify(t.abilities)}`);
  }
  console.log(`\naudited ${Math.min(k, tagged.length)} of ${tagged.length} tagged cards.`);
  await store.close();
}

main().catch((e) => { console.error("audit failed:", e); process.exit(1); });
