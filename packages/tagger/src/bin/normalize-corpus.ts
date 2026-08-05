/** THE BIN THAT SPENDS MONEY. One LLM call per card, writing `cardClauses`.
 *
 *  Defaults to a DRY RUN: it prints how many cards need normalizing and what that costs, calls
 *  nothing and writes nothing. `--run` is the only thing that spends.
 *
 *  ONE CARD PER CALL, N calls in flight. Not negotiable, and not a style preference:
 *  `bin/tag-batch-api.ts` puts 40 cards in one prompt, and that batching is the documented cause of
 *  the old pipeline's dropped and duplicated clauses (32 clauses vs 39-41 for the same cards sent
 *  singly). Do not "optimise" this into batches.
 *
 *  Every card is written the moment it passes the gate. Never buffer and flush at the end: a run
 *  killed at card 2000 of 2544 must lose nothing already paid for.
 *
 *  Usage:
 *    tsx src/bin/normalize-corpus.ts                    # dry run, prints the bill
 *    tsx src/bin/normalize-corpus.ts --run              # spends
 *    tsx src/bin/normalize-corpus.ts --run --limit 3    # smallest useful end-to-end check
 *    tsx src/bin/normalize-corpus.ts --refresh-other    # re-ask only the cards stuck on `other`
 *
 *  Needs `set -a && source .env && set +a` and TAGGER_PROVIDER=anthropic, or it silently falls back
 *  to Ollama and every card returns `ERROR: fetch failed`. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistText } from "@mtg/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { buildRequest, normalizeCard } from "../normalize-card.js";
import { NORMALIZE_VERSION, NORMALIZE_MIN_COMPATIBLE } from "../normalize-prompt.js";
import { segment } from "../segment.js";
import {
  CLAUSES_COLLECTION, ensureClauseIndexes, needsNormalize, carriesOther, missesASplit,
  segmentHash, type CardClausesDoc,
} from "../clause-store.js";

const CALIBRATION = new URL("../../../cli/decks/calibration/", import.meta.url);

/** Haiku 4.5 list price. Recorded here because the estimate is the whole point of the dry run. */
const USD_PER_M_INPUT = 1;
const USD_PER_M_OUTPUT = 5;
/** Output is not knowable in advance; 400 is the per-card average measured on the gold fixture. */
const EST_OUTPUT_TOKENS = 400;

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const RUN = process.argv.includes("--run");
const LIMIT = Number(arg("--limit") ?? 0);
const CONCURRENCY = Number(arg("--concurrency") ?? 6);
/** Pick up an ADDITIVE vocabulary change without re-buying the corpus. NORMALIZE_MIN_COMPATIBLE is
 *  unchanged by such a change, so nothing re-queues on its own — deliberately. The cards that can
 *  answer differently under a wider vocabulary are exactly those whose stored answer used the
 *  `other` escape hatch, plus the ones that have no doc at all. 340 + 88 of 2,453 is ~$1.50 against
 *  ~$8.50, and whatever still says `other` afterwards is the next punch list.
 *
 *  Whether a change needs its OWN selector is a measurement, not a guess. The two segmenter fixes
 *  needed none: 0 persisted docs disagreed with the fixed segmenter, because the cards they
 *  reclassify are exactly the ones the gate had been refusing, so they carry no doc at all and
 *  `needsNormalize` already queues them. The two-condition split DID need one — 27 of the 46 such
 *  cards are persisted with one of the clause's two events silently dropped, and none of them
 *  carries `other` — hence `missesASplit`. */
const REFRESH_OTHER = process.argv.includes("--refresh-other");

/** The calibration corpus: 2,544 distinct cards over 71 labelled decks. */
function calibrationNames(): string[] {
  const dir = new URL(".", CALIBRATION).pathname;
  const names = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".txt"))) {
    for (const n of parseDecklistText(readFileSync(join(dir, f), "utf8"))) names.add(normalizeName(n));
  }
  return [...names];
}

const store = await connect(loadConfig());
await ensureClauseIndexes(store.db);
const lookup = mongoLookup(store);
const clausesCol = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);

interface Job {
  oracleId: string;
  name: string;
  oracleText?: string;
  keywords?: string[];
  typeLine?: string;
  hash: string;
}

const jobs: Job[] = [];
const unresolved: string[] = [];
for (const name of calibrationNames()) {
  const doc = (await lookup.findByName(name)) as
    { _id: string; name: string; oracleText?: string; keywords?: string[]; typeLine?: string } | null;
  if (!doc) { unresolved.push(name); continue; }
  const hash = segmentHash(doc.oracleText ?? "", doc.typeLine ?? "", doc.keywords ?? []);
  const existing = await clausesCol.findOne({ oracleId: doc._id });
  const segmented = segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "");
  const refreshable = REFRESH_OTHER
    && (carriesOther(existing) || missesASplit(existing, segmented));
  if (!needsNormalize(existing, hash, NORMALIZE_MIN_COMPATIBLE) && !refreshable) continue;
  jobs.push({ oracleId: doc._id, name: doc.name, oracleText: doc.oracleText, keywords: doc.keywords, typeLine: doc.typeLine, hash });
}

// Price the ACTUAL prompts rather than a remembered average, so the bill cannot drift from the
// request. ~4 chars per token is the usual rough conversion; this is an estimate, not a promise.
let inputTokens = 0;
let freeCards = 0;
const INERT_KINDS = new Set(["keyword", "reminder", "level", "modal"]);
for (const j of jobs) {
  const segmented = segment(j.oracleText ?? "", j.keywords ?? [], j.typeLine ?? "");
  // All-inert cards are answered in code and never reach the model, so they must not be billed.
  if (!segmented.some((c) => !INERT_KINDS.has(c.kind))) { freeCards++; continue; }
  const { system, user } = buildRequest(j.name, segmented);
  inputTokens += Math.ceil((system.length + user.length) / 4);
}
const billable = jobs.length - freeCards;
const outputTokens = billable * EST_OUTPUT_TOKENS;
const usd = (inputTokens / 1e6) * USD_PER_M_INPUT + (outputTokens / 1e6) * USD_PER_M_OUTPUT;

const cfg = loadTaggerConfig();
console.log(`scope: calibration corpus`);
console.log(`  cards needing normalization: ${jobs.length}${LIMIT ? ` (limited to ${LIMIT})` : ""}`);
console.log(`  of those, answered in code (no model call): ${freeCards}`);
if (unresolved.length) console.log(`  unresolved names: ${unresolved.length} (${unresolved.slice(0, 3).join(", ")}...)`);
console.log(`  model: ${cfg.model} | provider: ${cfg.provider}`);
console.log(`  est. input ${inputTokens.toLocaleString()} tok, output ~${outputTokens.toLocaleString()} tok`);
console.log(`  ESTIMATED COST: $${usd.toFixed(2)} (priced at claude-haiku-4-5 list rates)`);

if (!RUN) {
  console.log(`\nDRY RUN — nothing called, nothing written. Re-run with --run to spend.`);
  if (cfg.provider !== "anthropic") {
    console.log(`NOTE: provider is "${cfg.provider}"; --run would refuse until you source .env.`);
  }
  await store.close();
  process.exit(0);
}

// The .env is not auto-loaded by anything but grind.sh, so the default config is Ollama. Two ways
// that costs you: a run that returns `ERROR: fetch failed` for every card, or -- worse -- a local
// model's output persisted as if it were the measured one. `needsNormalize` compares hash and
// version, NOT model, so such a corpus would look fresh forever and never re-queue. Same shape of
// fence as ALLOW_DEPRECATED_GRIND, for the same reason.
if (cfg.provider !== "anthropic" && !process.argv.includes("--allow-provider")) {
  console.log(`
REFUSING TO RUN: provider is "${cfg.provider}" (model ${cfg.model}), not anthropic.

Every measurement backing this pipeline was taken on claude-haiku-4-5. Persisting another model's
output would look identical to a fresh corpus -- staleness compares segmentHash and
NORMALIZE_VERSION, never the model -- so it would never re-queue and the mistake would be permanent.

  set -a && source .env && set +a && TAGGER_PROVIDER=anthropic npx tsx src/bin/normalize-corpus.ts --run

Pass --allow-provider only if you genuinely mean to normalize with ${cfg.model}.`);
  await store.close();
  process.exit(1);
}

const queue = LIMIT ? jobs.slice(0, LIMIT) : jobs;
const provider = createProvider({ ...cfg, maxTokens: 3000 });
let ok = 0, refused = 0, failed = 0, warned = 0;

async function work(job: Job): Promise<void> {
  try {
    const res = await normalizeCard(provider, job);
    if (res.rejected.length) {
      refused++;
      console.log(`REFUSED ${job.name}: ${res.rejected.map((v) => `${v.kind} — ${v.detail}`).join(" | ")}`);
      return; // not persisted, so it re-queues on the next run
    }
    if (res.violations.length) warned++;
    // Persisted the moment it validates. A kill mid-run must not lose paid work.
    await clausesCol.updateOne(
      { oracleId: job.oracleId },
      {
        $set: {
          oracleId: job.oracleId, name: job.name,
          clauses: res.clauses, canonical: res.canonical,
          segmentHash: job.hash, normalizeVersion: NORMALIZE_VERSION,
          model: provider.model, updatedAt: new Date(), warnings: res.violations,
        },
      },
      { upsert: true },
    );
    ok++;
  } catch (e) {
    failed++;
    console.log(`FAILED  ${job.name}: ${(e as Error).message.slice(0, 160)}`);
  }
}

console.log(`\nnormalizing ${queue.length} cards, ${CONCURRENCY} in flight...`);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (next < queue.length) await work(queue[next++]);
  }),
);

console.log(`\npersisted ${ok}, refused ${refused} (re-queue), failed ${failed}, persisted-with-warnings ${warned}`);
await store.close();
