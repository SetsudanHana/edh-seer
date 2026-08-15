/** THE BIN THAT SPENDS MONEY, over the `tokens` collection instead of `cards`. One LLM call per
 *  token, writing `cardClauses` rows keyed on the token's own `_id`, with `isToken: true`.
 *
 *  Mirrors `normalize-corpus.ts` exactly — same segment/prompt path, same free-inert-clause carve
 *  out, same persist-gate-refuses-rather-than-banks behaviour, same `--run` gate. The only things
 *  that differ are the SOURCE collection and the SELECTOR: a token qualifies when it is the EXACT
 *  resolution of some clause-corpus card's `allParts` token part — joined on `printingId` against
 *  `TokenDoc.printingIds` (Task 4a, c90e708), not on (name, typeLine), which is ambiguous (four
 *  "Wizard" / "Token Creature — Wizard" rows differ only in oracle text). A printing id that
 *  resolves to zero or more than one token row is a REFUSAL — logged, not guessed at — because a
 *  wrong pick here is a wrong ability normalized for money. Vanilla tokens (a bare 1/1 Soldier) have
 *  no text to normalize and are excluded by the same oracleText check.
 *
 *  Deliberately NOT mirrored: `--refresh-other` and the keyword-exemplar scope widening. Both exist
 *  in the corpus bin to keep a ~2,650-card corpus current against a moving vocabulary without a full
 *  re-buy; this bin's scope is small enough that a vocabulary change just re-runs the whole file, and
 *  `needsNormalize` (segmentHash + version) already skips whatever hasn't changed.
 *
 *  Usage:
 *    tsx src/bin/normalize-tokens.ts                    # dry run, prints the bill
 *    tsx src/bin/normalize-tokens.ts --run              # spends
 *    tsx src/bin/normalize-tokens.ts --run --limit 3    # smallest useful end-to-end check
 *
 *  Needs `set -a && source .env && set +a` and TAGGER_PROVIDER=anthropic, or it silently falls back
 *  to Ollama and every token returns `ERROR: fetch failed`. */
import { connect, loadConfig } from "@mtg/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { buildRequest, normalizeCard } from "../normalize-card.js";
import { NORMALIZE_VERSION, NORMALIZE_MIN_COMPATIBLE } from "../normalize-prompt.js";
import { segment } from "../segment.js";
import {
  CLAUSES_COLLECTION, ensureClauseIndexes, needsNormalize, segmentHash, type CardClausesDoc,
} from "../clause-store.js";

/** Haiku 4.5 list price, same figures as normalize-corpus.ts. */
const USD_PER_M_INPUT = 1;
const USD_PER_M_OUTPUT = 5;
const EST_OUTPUT_TOKENS = 400;

const arg = (flag: string): string | undefined => {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const RUN = process.argv.includes("--run");
const LIMIT = Number(arg("--limit") ?? 0);
const CONCURRENCY = Number(arg("--concurrency") ?? 6);

interface TokenClausesDoc extends CardClausesDoc {
  isToken: true;
}

interface TokenRow {
  _id: string;
  name: string;
  typeLine?: string;
  oracleText?: string;
  keywords?: string[];
  printingIds: string[];
}

const store = await connect(loadConfig());
await ensureClauseIndexes(store.db);
const clausesCol = store.db.collection<TokenClausesDoc>(CLAUSES_COLLECTION);

/** Cards already normalized (the clause corpus) that reference a token via `allParts`. `component`
 *  can also be `meld_part` or `combo_piece`, which are real cards and must be excluded — only
 *  `"token"` is a token. */
const corpusOracleIds = await clausesCol.distinct("oracleId", { isToken: { $ne: true } });
const referencingCards = await store.db.collection("cards")
  .find(
    { _id: { $in: corpusOracleIds } as never, allParts: { $exists: true } },
    { projection: { allParts: 1, name: 1 } },
  )
  .toArray() as unknown as { name: string; allParts: { component?: string; name: string; typeLine?: string; printingId?: string }[] }[];

// THE EXACT JOIN (Task 4a, c90e708). `allParts[].id` is a PRINTING id, joinable against
// `TokenDoc.printingIds` — the set of printing ids Scryfall collapses onto one token oracle_id.
// (name, typeLine) alone is NOT a key: 4 "Wizard" / "Token Creature — Wizard" rows differ only in
// oracle text, and Kuja, Genome Sorcerer's own part was one of the ambiguous ones. No tie-break: a
// printing id that resolves to zero or more than one token row is a REFUSAL, reported below, never
// guessed at.
const allTokens = await store.db.collection<TokenRow>("tokens").find({}).toArray();
const byPrintingId = new Map<string, TokenRow[]>();
for (const t of allTokens) {
  for (const pid of t.printingIds) {
    const bucket = byPrintingId.get(pid);
    if (bucket) bucket.push(t); else byPrintingId.set(pid, [t]);
  }
}

let tokenPartEntries = 0;
const resolvedIds = new Set<string>();
const unresolved: { card: string; part: string; reason: string }[] = [];
for (const c of referencingCards) {
  for (const p of c.allParts) {
    if (p.component !== "token") continue;
    tokenPartEntries++;
    if (!p.printingId) { unresolved.push({ card: c.name, part: p.name, reason: "no printingId on this allParts entry" }); continue; }
    const rows = byPrintingId.get(p.printingId) ?? [];
    if (rows.length === 0) { unresolved.push({ card: c.name, part: p.name, reason: `printingId ${p.printingId} matches no token row` }); continue; }
    if (rows.length > 1) { unresolved.push({ card: c.name, part: p.name, reason: `printingId ${p.printingId} matches ${rows.length} token rows` }); continue; }
    resolvedIds.add(rows[0]._id);
  }
}
const tokens = allTokens.filter((t) => resolvedIds.has(t._id) && (t.oracleText ?? "").trim() !== "");

interface Job {
  oracleId: string;
  name: string;
  oracleText?: string;
  keywords?: string[];
  typeLine?: string;
  hash: string;
}

const jobs: Job[] = [];
for (const t of tokens) {
  const hash = segmentHash(t.oracleText ?? "", t.typeLine ?? "", t.keywords ?? []);
  const existing = await clausesCol.findOne({ oracleId: t._id });
  if (!needsNormalize(existing, hash, NORMALIZE_MIN_COMPATIBLE)) continue;
  jobs.push({ oracleId: t._id, name: t.name, oracleText: t.oracleText, keywords: t.keywords, typeLine: t.typeLine, hash });
}

// Price the ACTUAL prompts, same method as normalize-corpus.ts.
let inputTokens = 0;
let freeCards = 0;
const INERT_KINDS = new Set(["keyword", "reminder", "level", "modal"]);
for (const j of jobs) {
  const segmented = segment(j.oracleText ?? "", j.keywords ?? [], j.typeLine ?? "");
  if (!segmented.some((c) => !INERT_KINDS.has(c.kind))) { freeCards++; continue; }
  const { system, user } = buildRequest(j.name, segmented);
  inputTokens += Math.ceil((system.length + user.length) / 4);
}
const billable = jobs.length - freeCards;
const outputTokens = billable * EST_OUTPUT_TOKENS;
const usd = (inputTokens / 1e6) * USD_PER_M_INPUT + (outputTokens / 1e6) * USD_PER_M_OUTPUT;

const cfg = loadTaggerConfig();
console.log(`token allParts entries (component=token) on clause-corpus cards: ${tokenPartEntries}`);
console.log(`  resolved to exactly one token row via printingId: ${resolvedIds.size} distinct token(s)`);
console.log(`  UNRESOLVED (refused, not guessed): ${unresolved.length}`);
if (unresolved.length) {
  for (const u of unresolved.slice(0, 10)) console.log(`    ${u.card} -> "${u.part}": ${u.reason}`);
  if (unresolved.length > 10) console.log(`    ...and ${unresolved.length - 10} more`);
}
console.log(`  of the resolved tokens, with non-empty oracleText: ${tokens.length}`);
console.log(`  tokens needing normalization: ${jobs.length}${LIMIT ? ` (limited to ${LIMIT})` : ""}`);
console.log(`  of those, answered in code (no model call): ${freeCards}`);
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

if (cfg.provider !== "anthropic" && !process.argv.includes("--allow-provider")) {
  console.log(`
REFUSING TO RUN: provider is "${cfg.provider}" (model ${cfg.model}), not anthropic.

Every measurement backing this pipeline was taken on claude-haiku-4-5. Persisting another model's
output would look identical to a fresh corpus -- staleness compares segmentHash and
NORMALIZE_VERSION, never the model -- so it would never re-queue and the mistake would be permanent.

  set -a && source .env && set +a && TAGGER_PROVIDER=anthropic npx tsx src/bin/normalize-tokens.ts --run

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
          isToken: true,
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

console.log(`\nnormalizing ${queue.length} token(s), ${CONCURRENCY} in flight...`);
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (next < queue.length) await work(queue[next++]);
  }),
);

console.log(`\npersisted ${ok}, refused ${refused} (re-queue), failed ${failed}, persisted-with-warnings ${warned}`);
await store.close();
