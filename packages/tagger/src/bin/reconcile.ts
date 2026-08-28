import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig } from "@edh-seer/data";
import { needsRetag, type TagCollection } from "../store.js";
import { SCHEMA_VERSION } from "../schema.js";
import { PROMPT_VERSION } from "../llm/prompt.js";
import { missingOracleIds } from "./corpus-core.js";

// Usage: reconcile [--dir DIR]  — reports batch cards still untagged (drops that will re-queue).
async function main(): Promise<void> {
  const idx = process.argv.indexOf("--dir");
  const dir = idx >= 0 ? process.argv[idx + 1] : "/tmp/mtg-tag-batches";
  const dispatched: string[] = [];
  for (const f of readdirSync(dir).filter((f) => f.startsWith("batch-") && f.endsWith(".json"))) {
    for (const c of JSON.parse(readFileSync(join(dir, f), "utf8")) as { oracleId: string }[]) dispatched.push(c.oracleId);
  }
  const store = await connect(loadConfig());
  const resulted: string[] = [];
  for (const t of await store.db.collection("cardTags").find({}).toArray()) {
    if (!needsRetag(t as never, SCHEMA_VERSION, PROMPT_VERSION)) resulted.push((t as unknown as { oracleId: string }).oracleId);
  }
  const missing = missingOracleIds(dispatched, resulted);
  console.log(`reconcile: ${dispatched.length} dispatched, ${missing.length} still untagged (will re-queue next dump).`);
  await store.close();
}

main().catch((e) => { console.error("reconcile failed:", e); process.exit(1); });
