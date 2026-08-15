/** THE BIN THAT SPENDS MONEY, over the `tokens` collection instead of `cards`. One LLM call per
 *  token, writing `cardClauses` rows keyed on the token's own `_id`, with `isToken: true`.
 *
 *  Mirrors `normalize-corpus.ts` exactly — same segment/prompt path, same free-inert-clause carve
 *  out, same persist-gate-refuses-rather-than-banks behaviour, same `--run` gate. The only things
 *  that differ are the SOURCE collection and the SELECTOR: a token qualifies when some card in the
 *  clause corpus references it via `allParts` (`component: "token"`) and the token carries non-empty
 *  `oracleText`. Vanilla tokens (a bare 1/1 Soldier) have no text to normalize and are excluded by
 *  that same oracleText check — they were never going to ask the model anything.
 *
 *  Deliberately NOT mirrored: `--refresh-other` and the keyword-exemplar scope widening. Both exist
 *  in the corpus bin to keep a 2,500-card corpus current against a moving vocabulary without a full
 *  re-buy; 87 tokens is small enough that a vocabulary change just re-runs this file with `--run`,
 *  and `needsNormalize` (segmentHash + version) already skips whatever hasn't changed.
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
    { projection: { allParts: 1 } },
  )
  .toArray() as unknown as { allParts: { component?: string; name: string; typeLine?: string }[] }[];

const tokenKey = (name: string, typeLine?: string): string => `${name.toLowerCase()}|${(typeLine ?? "").toLowerCase()}`;
const wanted = new Set<string>();
for (const c of referencingCards) {
  for (const p of c.allParts) if (p.component === "token") wanted.add(tokenKey(p.name, p.typeLine));
}

// `allParts` (Scryfall's RelatedPart) carries only name + typeLine, never the printing id, so a
// referenced token is a KEY, not a row: name+typeLine is the only identity the corpus can give us.
// The `tokens` collection is NOT unique on that key — measured: of the 127 keys the corpus
// references, 50 resolve to more than one token doc (different specific tokens genuinely share a
// name and type line, e.g. "Rat" is printed plain, Deathtouch, Lifelink and "can't block" across
// different cards). Normalizing every candidate row overcounts 127 identities into 336 doc matches;
// deduping to one row per key is what gets back to a per-IDENTITY count. Where more than one
// candidate carries text and they DISAGREE (31 of the 127 keys), there is no signal in `allParts`
// that says which one a given card actually makes, so the choice below is an arbitrary, deterministic
// tie-break (lowest `_id`) — not a claim that it is the right one. Flagged in the dry-run output
// rather than silently resolved, because a wrong pick here is a wrong ability normalized for money.
const byKey = new Map<string, TokenRow[]>();
const allTokens = await store.db.collection<TokenRow>("tokens").find({}).toArray();
for (const t of allTokens) {
  const k = tokenKey(t.name, t.typeLine);
  const bucket = byKey.get(k);
  if (bucket) bucket.push(t); else byKey.set(k, [t]);
}

let ambiguousKeys = 0;
let disagreeingKeys = 0;
const tokens: TokenRow[] = [];
for (const key of wanted) {
  const candidates = (byKey.get(key) ?? []).filter((t) => (t.oracleText ?? "").trim() !== "");
  if (candidates.length === 0) continue;
  if (candidates.length > 1) {
    ambiguousKeys++;
    if (new Set(candidates.map((c) => c.oracleText?.trim())).size > 1) disagreeingKeys++;
  }
  tokens.push([...candidates].sort((a, b) => a._id.localeCompare(b._id))[0]);
}

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
console.log(`wanted token identities (name+typeLine) referenced by the clause corpus: ${wanted.size}`);
console.log(`  of those, with >=1 textful token doc: ${tokens.length}`);
console.log(`  ambiguous (>1 candidate doc for the key): ${ambiguousKeys}, of which disagree on text: ${disagreeingKeys} — see comment above, tie-break is lowest _id`);
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
