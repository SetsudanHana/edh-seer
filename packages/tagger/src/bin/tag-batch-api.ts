import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { buildAbilityMessages } from "../llm/prompt.js";
import type { ChatMessage } from "../llm/provider.js";

interface BatchCard { oracleId: string; name: string; oracleText: string }
interface BatchResult { oracleId: string; abilities: unknown[] }

/** Shared system + few-shot turns (card-agnostic), taken from a throwaway card. */
function sharedPrefix(): ChatMessage[] {
  return buildAbilityMessages({ name: "", typeLine: "", oracleText: "" } as never).slice(0, -1);
}

const BATCH_INSTRUCTION = `For EACH card below, output the tagging JSON. Return ONLY a JSON object
{ "results": [{ "oracleId": string, "abilities": [...] }] } — one entry per card, "abilities"
being the array you would put in {"abilities":[...]}. No other text. Cards:\n\n`;

/** Direct Anthropic call for one batch file: same input/output contract as the subagent grind
 *  (batch-N.json in, batch-N-out.json out), so upsert-batch consumes it unchanged. */
async function tagBatch(batchFile: string, outFile: string): Promise<void> {
  const cards = JSON.parse(readFileSync(batchFile, "utf8")) as BatchCard[];
  const cfg = loadTaggerConfig();
  const provider = createProvider(cfg);

  const messages: ChatMessage[] = [
    ...sharedPrefix(),
    { role: "user", content: BATCH_INSTRUCTION + JSON.stringify(cards, null, 1) },
  ];
  const raw = await provider.chat(messages);
  const parsed = JSON.parse(raw) as { results: BatchResult[] };
  const results = parsed.results;
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(`${batchFile}: tagged ${results.length}/${cards.length} -> ${outFile}`);
}

// Usage: tag-batch-api [--dir DIR] [--batches N]
async function main(): Promise<void> {
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
  const dir = args.get("dir") ?? "/tmp/mtg-tag-batches";
  const batches = Number(args.get("batches") ?? 6);

  const files: [string, string][] = [];
  for (let i = 0; i < batches; i++) {
    files.push([join(dir, `batch-${i}.json`), join(dir, `batch-${i}-out.json`)]);
  }
  const results = await Promise.allSettled(files.map(([b, o]) => tagBatch(b, o)));
  const failed = results.filter((r) => r.status === "rejected");
  for (const f of failed) console.error("batch failed:", (f as PromiseRejectedResult).reason);
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => { console.error("tag-batch-api failed:", e); process.exit(1); });
