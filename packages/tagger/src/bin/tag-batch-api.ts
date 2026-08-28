import { scratchDir } from "@edh-seer/data";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { buildAbilityMessages } from "../llm/prompt.js";
import type { ChatMessage } from "../llm/provider.js";

interface BatchCard { oracleId: string; name: string; oracleText: string }
interface BatchResult { oracleId: string; abilities: unknown[] }

/** Output-token headroom per card in a batch. */
const PER_CARD_TOKENS = 400;

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
  // ANTHROPIC_MAX_TOKENS defaults to a SINGLE card's extraction (1500). This path asks for a whole
  // batch in one response, so the default truncates every call at ~4k characters and the only
  // symptom is "Unterminated string in JSON". Scale the budget to the batch unless the operator
  // asked for more. ~400 output tokens per card is measured headroom for the largest real cards.
  const provider = createProvider({ ...cfg, maxTokens: Math.max(cfg.maxTokens, cards.length * PER_CARD_TOKENS) });

  const messages: ChatMessage[] = [
    ...sharedPrefix(),
    { role: "user", content: BATCH_INSTRUCTION + JSON.stringify(cards, null, 1) },
  ];
  const raw = await provider.chat(messages);
  let parsed: { results: BatchResult[] };
  try {
    parsed = JSON.parse(raw) as { results: BatchResult[] };
  } catch (e) {
    // Keep the response that failed to parse — otherwise the only evidence is a character offset.
    const dump = `${outFile}.raw.txt`;
    writeFileSync(dump, raw);
    throw new Error(`${batchFile}: could not parse model output (${(e as Error).message}). Raw response written to ${dump}`);
  }
  const results = parsed.results;
  writeFileSync(outFile, JSON.stringify(results, null, 1));
  console.log(`${batchFile}: tagged ${results.length}/${cards.length} -> ${outFile}`);
}

// Usage: tag-batch-api [--dir DIR] [--batches N]
/** This script is the only place the deprecated flat extractor spends money, so the guard lives
 *  here rather than in `dump-untagged` (which is free) or `grind.sh` (which just loops over this).
 *
 *  Why it exists: a 46-card hand audit measured this extractor at 43% correct / 43% partial / 13%
 *  wrong, and two identical runs agreed on only 30% of cards — so re-grinding rewrites most of the
 *  corpus regardless of the prompt. PROMPT_VERSION is 24, which marks all ~20,400 existing tag docs
 *  stale, so `dump-untagged` will happily re-queue the entire corpus and this script will spend
 *  roughly $70 reproducing those numbers. The replacement (mechanical segmentation, slot-filled
 *  extraction, derivation in code) is merged and measured; what it lacks is a persistence path.
 *
 *  The guard is an env var rather than a flag so it cannot be satisfied by muscle memory. */
export function deprecatedGrindAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ALLOW_DEPRECATED_GRIND === "1";
}

function assertDeprecatedGrindAllowed(): void {
  if (deprecatedGrindAllowed()) return;
  console.error(`
tag-batch-api is the DEPRECATED flat extractor. Refusing to spend money.

  Measured quality : 43% correct / 43% partial / 13% wrong (46-card hand audit)
  Reproducibility  : 30% of cards identical across two runs
  Cost if you run  : ~$70, because PROMPT_VERSION 24 marks all ~20,400 tag docs stale

The replacement is merged: segment.ts -> normalize-prompt.ts -> derive/. It has no
persistence path yet, which is the actual work item — see
docs/superpowers/specs/2026-08-05-derivation-layer-design.md.

If you genuinely mean to re-grind with the old extractor:

  ALLOW_DEPRECATED_GRIND=1 npx tsx src/bin/tag-batch-api.ts ...
`);
  process.exit(1);
}

async function main(): Promise<void> {
  assertDeprecatedGrindAllowed();
  const args = new Map<string, string>();
  for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
  const dir = args.get("dir") ?? scratchDir("mtg-tag-batches");
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

// Only run when executed directly. Importing this module (the guard's test does) must not fire the
// guard and exit the process — the same idiom matcher's eval-pairs.ts uses.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("tag-batch-api failed:", e); process.exit(1); });
}
