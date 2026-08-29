/** THE BIN THAT SPENDS MONEY. One LLM call per card, writing `cardClauses`.
 *
 *  Defaults to a DRY RUN: it prints how many cards need normalizing and what that costs, calls
 *  nothing and writes nothing. `--run` is the only thing that spends.
 *
 *  ONE CARD PER CALL. Not negotiable, and not a style preference: `bin/tag-batch-api.ts` puts 40
 *  cards in ONE PROMPT, and that prompt-stuffing is the documented cause of the old pipeline's
 *  dropped and duplicated clauses (32 clauses vs 39-41 for the same cards sent singly). Do not
 *  "optimise" this by putting several cards in a request.
 *
 *  THE ANTHROPIC BATCH API IS A DIFFERENT THING AND IS FINE, which is why `--batch` exists. It
 *  sends the SAME one-card request, byte-identical (`anthropicBody` is shared with the live path) --
 *  it batches the TRANSPORT, not the prompt. The failure above came from asking one question about
 *  40 cards; here each card still gets its own question, its own answer and its own gate. It is
 *  half price, and it returns within 24h instead of immediately, which is the whole trade.
 *
 *  Every card is written the moment it passes the gate. Never buffer and flush at the end: a run
 *  killed at card 2000 of 2544 must lose nothing already paid for.
 *
 *  Usage:
 *    tsx src/bin/normalize-corpus.ts                    # dry run, prints the bill
 *    tsx src/bin/normalize-corpus.ts --run              # spends
 *    tsx src/bin/normalize-corpus.ts --run --limit 3    # smallest useful end-to-end check
 *    tsx src/bin/normalize-corpus.ts --refresh-other    # re-ask only the cards stuck on `other`
 *    tsx src/bin/normalize-corpus.ts --commander-legal  # scope every commander-legal card, not the 71 decks
 *    tsx src/bin/normalize-corpus.ts --commander-legal --max-rank 20000
 *                                                       # ... but only the ones EDHREC ranks that high
 *    tsx src/bin/normalize-corpus.ts --run --batch      # submit to the Batch API at HALF PRICE
 *    tsx src/bin/normalize-corpus.ts --collect <file>   # poll + persist a submitted batch
 *    tsx src/bin/normalize-corpus.ts --card "Isshin, Two Heavens as One" --run
 *                                                       # pull one named card into the corpus
 *
 *  Needs `set -a && source .env && set +a` and TAGGER_PROVIDER=anthropic, or it silently falls back
 *  to Ollama and every card returns `ERROR: fetch failed`. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { connect, loadConfig, mongoLookup, normalizeName, parseDecklistText } from "@edh-seer/data";
import { loadTaggerConfig } from "../config.js";
import { createProvider } from "../llm/factory.js";
import { buildRequest, codeAnsweredCard, needsModel, normalizeCard, parseNormalizedCard, type NormalizedCard } from "../normalize-card.js";
import { anthropicText, type AnthropicResponse } from "../llm/anthropic.js";
import { batchResults, batchStatus, safeBatchId, submitBatch } from "../llm/anthropic-batch.js";
import { NORMALIZE_VERSION, NORMALIZE_MIN_COMPATIBLE, VOCAB_VERSION, TRIGGER_VOCAB_VERSION, TRIGGERS, EXEMPLAR_TERMS } from "../normalize-prompt.js";
import { segment } from "../segment.js";
import {
  CLAUSES_COLLECTION, ensureClauseIndexes, needsNormalize, carriesOther, missesASplit,
  disagreesOnType, dropsOriginZone, dropsTriggerObject, hasPhantomTrigger, carriesOtherTrigger, worthReasking, segmentHash, type CardClausesDoc,
} from "../clause-store.js";

const CALIBRATION = new URL("../../../cli/decks/calibration/", import.meta.url);

/** Haiku 4.5 list price. Recorded here because the estimate is the whole point of the dry run. */
const USD_PER_M_INPUT = 1;
const USD_PER_M_OUTPUT = 5;
/** Output is not knowable in advance. 226 is the per-card average MEASURED on the 2026-08-29
 *  top-20,000 batch — 16,949 cards, a broad draw of the real corpus — replacing a 400 taken from the
 *  gold fixture, which overpriced every dry run by ~77%%. Read off the results' own usage blocks
 *  (they are retained 29 days), so it is the billed figure rather than an estimate of it. The
 *  2026-08-22 refresh-other batch reads 254, and it is NOT the number to use: cards stuck on the
 *  `other` escape hatch are not a sample of the corpus. */
const EST_OUTPUT_TOKENS = 226;

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
 *  carries `other` — hence `missesASplit`. The ACTIVATED-cap fix needed one too: it retypes 459
 *  clauses corpus-wide without moving a single clause id, so 34 persisted docs carry an answer given
 *  under the wrong typing — hence `disagreesOnType`. */
const REFRESH_OTHER = process.argv.includes("--refresh-other");
/** Re-ask every doc answered under a prompt older than N. NOT `NORMALIZE_MIN_COMPATIBLE`, which is a
 *  claim that older answers are INVALID and re-buys the whole corpus the moment it moves -- this is
 *  a refresh you can point at part of the corpus and stop. Measured 2026-08-21: 1,985 of the 2,756
 *  clause docs (72%) were answered under v3, the original calibration buy, and the prompt has since
 *  gained the CR keyword-action triggers, origin zones, trigger objects and the one-record-per-
 *  condition rule that `missesASplit` exists to catch. */
const BELOW_VERSION = Number(arg("--below-version") ?? 0);
/** Submit the selection to the Anthropic Batch API instead of calling it live: same one-card
 *  requests, half price, results within 24h. Writes a state file naming the batch and its jobs so
 *  `--collect` can persist the answers in a LATER process -- the whole point, since the results are
 *  not there when the submitting process exits. */
/** Pull a NAMED card into scope even though no calibration deck runs it (owner's ruling,
 *  2026-08-22: "if you need a card, we can always bring it in the corpus even if it is not covered
 *  by 71 decks"). Repeatable.
 *
 *  WHEN GIVEN, THESE ARE THE WHOLE SCOPE rather than an addition to it. Bringing in a witness is a
 *  targeted act — you want the bill to be one card, and you want the dry run to say so. The
 *  calibration corpus is still there on the next run without the flag.
 *
 *  This is the same need `EXEMPLAR_TERMS` serves for a VOCABULARY addition, one rung more general:
 *  there the witness is chosen by the word it exercises, here by name, because the reason you want
 *  a card is often a DEFECT rather than a word — 14 of the 15 trigger-doublers derive no subject,
 *  and checking whether Isshin joins them should not require it to be in someone's deck first. */
const CARDS = process.argv.reduce<string[]>((acc, a, i) => (a === "--card" && process.argv[i + 1] ? [...acc, process.argv[i + 1]] : acc), []);
/** EVERY COMMANDER-LEGAL CARD, not the 71 calibration decks. The static-hosting plan needs whatever
 *  ships to BE the whole answer -- no server means no lazy normalization, so a card outside the
 *  bought scope is one a stranger's deck can never read.
 *
 *  SCOPED ON LEGALITY, which is the same ruling the vocabulary work took: no plane, scheme,
 *  Attraction, conspiracy or un-card is ever in an EDH decklist, so buying one is money spent on a
 *  card the product cannot be handed. 31,829 of the corpus's 34,433 are commander-legal.
 *
 *  Cards with no printed oracle text are IN, deliberately, and they are free: an all-inert card is
 *  answered in code, and the doc it gets is what stops the report calling a vanilla bear "unread". */
const COMMANDER_LEGAL = process.argv.includes("--commander-legal");
/** Buy the corpus by how often the format actually plays a card. EDHREC's rank is the only
 *  popularity signal on the documents, and it is dense here: only 56 of the 27,529 unbought
 *  commander-legal cards carry no rank at all, so a cutoff drops PLAYED cards rather than junk —
 *  it buys a tranche, it does not filter noise. Priced at the batch rate: <=20,000 is 16,948 cards
 *  and $38.93 against $63.17 for the lot.
 *
 *  A CARD ANSWERED IN CODE IGNORES THE CUTOFF, because it is free and because the doc it gets is
 *  what stops the report calling a vanilla creature "unread". Buying the tranche should not leave a
 *  Grizzly Bears looking unanalysed when analysing it costs nothing. */
const MAX_RANK = Number(arg("--max-rank") ?? 0);
const BATCH = process.argv.includes("--batch");
const COLLECT = arg("--collect");

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

/** A few real cards per newly-added vocabulary term, so the addition is exercised instead of sitting
 *  untested. DETERMINISTIC — sorted by oracle-text length then name — so the same cards are chosen on
 *  every run and the scope does not drift card by card. Shortest text first on purpose: the simplest
 *  printing of a keyword is the clearest test of it, and the cheapest to normalize. */
const EXEMPLARS_PER_TERM = 3;
async function exemplarNames(): Promise<string[]> {
  const out = new Set<string>();
  for (const term of EXEMPLAR_TERMS) {
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = await store.cards
      .find({ oracleText: new RegExp(`\\b${safe}`, "i") } as never)
      .project({ name: 1, oracleText: 1 })
      .toArray() as unknown as { name: string; oracleText?: string }[];
    found
      .sort((a, b) => (a.oracleText ?? "").length - (b.oracleText ?? "").length || a.name.localeCompare(b.name))
      .slice(0, EXEMPLARS_PER_TERM)
      .forEach((c) => out.add(normalizeName(c.name)));
  }
  return [...out];
}
const lookup = mongoLookup(store);
const clausesCol = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);

let ok = 0, refused = 0, failed = 0, warned = 0;

/** The ONLY writer. Live and batch share it so a half-price answer cannot be banked under looser
 *  rules than a full-price one — the gate, the version stamp and the refusal semantics are the same
 *  sentence for both. A refused card is NOT persisted, so it simply re-queues on the next run. */
async function persistCard(job: { oracleId: string; name: string; hash: string }, res: NormalizedCard, model: string): Promise<void> {
  if (res.rejected.length) {
    refused++;
    console.log(`REFUSED ${job.name}: ${res.rejected.map((v) => `${v.kind} — ${v.detail}`).join(" | ")}`);
    return;
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
        model, updatedAt: new Date(), warnings: res.violations,
      },
    },
    { upsert: true },
  );
  ok++;
}

/** What `--batch` writes and `--collect` reads. The jobs ride along because a batch outlives the
 *  process that sent it: by collection time the SELECTION may no longer reproduce (another run may
 *  have persisted some of these cards), and a card must be written back under the hash it was
 *  actually asked about, not under whatever it hashes to hours later. */
interface BatchState {
  batchId: string;
  model: string;
  prefill: boolean;
  submittedAt: string;
  jobs: { oracleId: string; name: string; hash: string }[];
}
const BATCH_DIR = new URL("../../.batches/", import.meta.url).pathname;

/** Anthropic caps a batch at 100,000 requests OR 256 MB of request body. 200 MB leaves room for the
 *  count of a JSON estimate that is close rather than exact, and for the envelope around the
 *  requests array; the whole corpus needs ~2 batches either way, so a tighter bound costs nothing. */
const CHUNK_BYTES = 200 * 1024 * 1024;

if (COLLECT) {
  const state = JSON.parse(readFileSync(COLLECT, "utf8")) as BatchState;
  const bcfg = loadTaggerConfig();
  const client = { apiKey: bcfg.anthropicApiKey ?? "", baseUrl: bcfg.anthropicBaseUrl, model: state.model, maxTokens: 3000 };
  const status = await batchStatus(client, state.batchId);
  console.log(`batch ${state.batchId}: ${status.processingStatus} ${JSON.stringify(status.counts)}`);
  if (status.processingStatus !== "ended") {
    console.log(`\nNOT READY — results appear only when processing_status is "ended". Re-run --collect later.`);
    await store.close();
    process.exit(0);
  }

  const byId = new Map(state.jobs.map((j) => [j.oracleId, j]));
  const results = await batchResults(client, state.batchId);
  let missing = 0;
  for (const r of results) {
    const job = byId.get(r.customId);
    // Keyed on custom_id, never on position: the API returns results in ANY order.
    if (!job) { missing++; continue; }
    if (r.type !== "succeeded") {
      failed++;
      console.log(`FAILED  ${job.name}: batch result ${r.type}${r.error ? ` — ${r.error}` : ""}`);
      continue;
    }
    try {
      const doc = await lookup.findByName(normalizeName(job.name)) as
        { oracleText?: string; keywords?: string[]; typeLine?: string } | null;
      const segmented = segment(doc?.oracleText ?? "", doc?.keywords ?? [], doc?.typeLine ?? "");
      const raw = anthropicText(r.body as AnthropicResponse, state.prefill, 3000);
      await persistCard(job, parseNormalizedCard(segmented, raw), state.model);
    } catch (e) {
      failed++;
      console.log(`FAILED  ${job.name}: ${(e as Error).message.slice(0, 160)}`);
    }
  }
  const unreturned = state.jobs.length - results.length;
  console.log(`\npersisted ${ok}, refused ${refused} (re-queue), failed ${failed}, persisted-with-warnings ${warned}`);
  if (missing) console.log(`${missing} results had no matching job in the state file (ignored)`);
  if (unreturned > 0) console.log(`${unreturned} submitted cards returned no result at all — they re-queue on the next run`);
  await store.close();
  process.exit(0);
}

interface Job {
  oracleId: string;
  name: string;
  oracleText?: string;
  keywords?: string[];
  typeLine?: string;
  hash: string;
}

type ScopeDoc = { _id: string; name: string; oracleText?: string; keywords?: string[]; typeLine?: string; edhrecRank?: number };

const jobs: Job[] = [];
const unresolved: string[] = [];
const exemplars = COMMANDER_LEGAL ? [] : await exemplarNames();
const scope = CARDS.length
  ? [...new Set(CARDS.map(normalizeName))]
  : COMMANDER_LEGAL
    ? []
    : [...new Set([...calibrationNames(), ...exemplars])];

/** The scope as CARDS rather than as names. `--commander-legal` reads the collection directly: at
 *  31,829 cards a per-name `findByName` is 31,829 round trips to answer a question one query
 *  answers, and there is no name to be unresolved in the first place. */
async function* scopeDocs(): AsyncGenerator<ScopeDoc> {
  if (COMMANDER_LEGAL) {
    const cursor = store.cards
      .find({ "legalities.commander": "legal" } as never)
      .project({ name: 1, oracleText: 1, keywords: 1, typeLine: 1, edhrecRank: 1 });
    for await (const doc of cursor) yield doc as unknown as ScopeDoc;
    return;
  }
  for (const name of scope) {
    const doc = (await lookup.findByName(name)) as ScopeDoc | null;
    if (!doc) { unresolved.push(name); continue; }
    yield doc;
  }
}
/** THE SCOPE IS DEDUPED BY NAME AND THAT IS NOT THE SAME AS DEDUPED BY CARD. A card reachable by
 *  two names — its real one and a flavor name, since `searchNames` merged those on 2026-07-12 —
 *  arrives twice. Measured: 2,544 scope names resolve to 2,541 distinct cards, the three being
 *  Rampant Growth, Reanimate and Exsanguinate, each also listed under a Universes Beyond name.
 *
 *  The live path never noticed because normalizing the same card twice is merely wasteful (last
 *  write wins). `--batch` DID notice: Anthropic rejects a batch whose `custom_id`s are not unique,
 *  and the custom_id is the oracle id. Fixed here rather than in the batch submitter so the live
 *  path stops paying for three cards twice as well. */
const seenIds = new Set<string>();
for await (const doc of scopeDocs()) {
  if (seenIds.has(doc._id)) continue;
  seenIds.add(doc._id);
  const hash = segmentHash(doc.oracleText ?? "", doc.typeLine ?? "", doc.keywords ?? []);
  const existing = await clausesCol.findOne({ oracleId: doc._id });
  const segmented = segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "");
  const refreshable = REFRESH_OTHER
    && worthReasking(existing, NORMALIZE_VERSION)
    && (carriesOther(existing, VOCAB_VERSION) || missesASplit(existing, segmented) || disagreesOnType(existing, segmented)
      || dropsOriginZone(existing, doc.oracleText ?? "")
      || dropsTriggerObject(existing, doc.oracleText ?? "")
      || hasPhantomTrigger(existing, doc.oracleText ?? "")
      || carriesOtherTrigger(existing, TRIGGERS, TRIGGER_VOCAB_VERSION));
  const stale = BELOW_VERSION > 0 && existing !== null && existing.normalizeVersion < BELOW_VERSION;
  if (!needsNormalize(existing, hash, NORMALIZE_MIN_COMPATIBLE) && !refreshable && !stale) continue;
  // Tested AFTER `needsModel`, never before it: an all-inert card costs nothing, so excluding it
  // would buy no money back and would leave it reading as unread. An UNRANKED card is out — EDHREC
  // has no record of the format playing it, which is the same claim the cutoff makes.
  if (MAX_RANK > 0 && needsModel(segmented) && !(doc.edhrecRank !== undefined && doc.edhrecRank <= MAX_RANK)) continue;
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
console.log(CARDS.length
  ? `scope: ${scope.length} named card(s) — ${CARDS.join(", ")}`
  : COMMANDER_LEGAL
    ? `scope: every commander-legal card (${seenIds.size} cards)${MAX_RANK ? `, model calls capped at EDHREC rank ${MAX_RANK.toLocaleString()}` : ""}`
    : `scope: calibration corpus + ${exemplars.length} keyword exemplars (${scope.length} cards)`);
console.log(`  cards needing normalization: ${jobs.length}${LIMIT ? ` (limited to ${LIMIT})` : ""}`);
console.log(`  of those, answered in code (no model call): ${freeCards}`);
if (unresolved.length) console.log(`  unresolved names: ${unresolved.length} (${unresolved.slice(0, 3).join(", ")}...)`);
console.log(`  model: ${cfg.model} | provider: ${cfg.provider}`);
console.log(`  est. input ${inputTokens.toLocaleString()} tok, output ~${outputTokens.toLocaleString()} tok`);
console.log(`  ESTIMATED COST: $${usd.toFixed(2)} (priced at claude-haiku-4-5 list rates)`);
// The Batch API is half price for a byte-identical request; the trade is up to 24h of latency.
if (BATCH) console.log(`  VIA --batch: $${(usd / 2).toFixed(2)} (Batch API, 50% off, results within 24h)`);

if (!RUN) {
  console.log(`\nDRY RUN — nothing called, nothing written. Re-run with --run${BATCH ? " --batch" : ""} to spend.`);
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

if (BATCH) {
  // Cards answerable in code never reach the model, so they are written now rather than being sent
  // and waited on for 24 hours. Same helper the live path uses.
  const send: { customId: string; messages: { role: "system" | "user"; content: string }[] }[] = [];
  for (const job of queue) {
    const segmented = segment(job.oracleText ?? "", job.keywords ?? [], job.typeLine ?? "");
    if (!needsModel(segmented)) { await persistCard(job, codeAnsweredCard(segmented), provider.model); continue; }
    const { system, user } = buildRequest(job.name, segmented);
    send.push({ customId: job.oracleId, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
  }

  // PROBE FIRST, because a batch cannot do the live path's per-call prefill fallback: it detects an
  // unsupported assistant prefill from the ERROR of a real call, and by the time a batch errors it
  // has already cost the whole run. One cheap live call settles the request shape for all of them.
  // Carries a system message on purpose: `anthropicBody` marks the system block cache_control, and
  // the API rejects that on an EMPTY text block ("system.0: cache_control cannot be set for empty
  // text blocks"). A probe shaped unlike a real request tests the wrong thing anyway.
  await provider.chat([
    { role: "system", content: "You reply with a JSON object and nothing else." },
    { role: "user", content: "Reply with {\"ok\":true}." },
  ]);
  const prefill = (provider as { prefill?: boolean }).prefill ?? false;

  const client = { apiKey: cfg.anthropicApiKey ?? "", baseUrl: cfg.anthropicBaseUrl, model: provider.model, maxTokens: 3000 };

  // ONE POST PER CHUNK, because a batch has a SIZE limit as well as a count one and the whole
  // corpus blows through it: 27,529 cards is ~285 MB of request JSON against Anthropic's 256 MB,
  // and the system prompt is 97.6% of that (2,531 tokens, repeated once per card, against a 59-token
  // card). Sized against the BYTES it will serialize to rather than a card count, so a future prompt
  // that grows re-chunks itself instead of silently crossing the line.
  const chunks: typeof send[] = [];
  let chunk: typeof send = [];
  let bytes = 0;
  for (const r of send) {
    // `send` already carries the system block as a message, so the stringified request IS the
    // payload; `anthropicBody` only re-shapes it. Measured, not assumed: ~10.4 KB per card.
    const size = JSON.stringify(r).length;
    if (chunk.length && bytes + size > CHUNK_BYTES) { chunks.push(chunk); chunk = []; bytes = 0; }
    chunk.push(r); bytes += size;
  }
  if (chunk.length) chunks.push(chunk);

  const byId = new Map(queue.map((j) => [j.oracleId, j] as const));
  mkdirSync(BATCH_DIR, { recursive: true });
  const statePaths: string[] = [];
  for (const [i, part] of chunks.entries()) {
    const batchId = await submitBatch(client, part, prefill);
    const state: BatchState = {
      batchId, model: provider.model, prefill, submittedAt: new Date().toISOString(),
      // ONLY this chunk's jobs. A state file naming cards another chunk answered would have
      // `--collect` report them as never returned, every time, forever.
      jobs: part.map((r) => byId.get(r.customId)!).map((j) => ({ oracleId: j.oracleId, name: j.name, hash: j.hash })),
    };
    const statePath = join(BATCH_DIR, `${safeBatchId(batchId)}.json`);
    writeFileSync(statePath, JSON.stringify(state, null, 2));
    statePaths.push(statePath);
    console.log(`SUBMITTED batch ${i + 1}/${chunks.length} ${batchId}: ${part.length} cards -> ${statePath}`);
  }

  console.log(`\n${send.length} cards sent to the model over ${chunks.length} batch(es); ${ok} answered in code and already written.`);
  console.log(`\nResults are ready within 24h and are kept for 29 days. Collect EACH with:`);
  for (const sp of statePaths) console.log(`  npx tsx packages/tagger/src/bin/normalize-corpus.ts --collect ${sp}`);
  await store.close();
  process.exit(0);
}

async function work(job: Job): Promise<void> {
  try {
    await persistCard(job, await normalizeCard(provider, job), provider.model);
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
