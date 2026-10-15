/** FREE. Reads `cardClauses`, derives, writes `cardTagsDerived`. No API key, no model, no cost.
 *
 *  This is the bin that makes the architecture's claim real: change the taxonomy, bump
 *  DERIVE_VERSION, re-run this, and the whole derived corpus is rebuilt without buying a single
 *  token. If this ever needs the network, the layering has been broken.
 *
 *  Usage: tsx src/bin/derive-corpus.ts [--force] */
import { connect, loadConfig } from "@edh-seer/data";
import { deriveInputOf } from "../derive-input.js";
import { createPool } from "@edh-seer/data/parallel";
import type { DeriveItem, DeriveResult } from "../derive-worker.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { DERIVE_VERSION } from "../derive/derive.js";
import { deriveCardTags } from "../derive/derive.js";
import { unpricedLoyaltyLines } from "../derive/mana-lines.js";
import {
  CLAUSES_COLLECTION, DERIVED_COLLECTION, derivedRow, ensureClauseIndexes, needsDerive, segmentHash,
  type CardClausesDoc, type DerivedTagsDoc,
} from "../clause-store.js";

const FORCE = process.argv.includes("--force");
/** Token characteristics live outside `cards` -- see `packages/data/src/bin/ingest-tokens-core.ts`. */
const TOKENS_COLLECTION = "tokens";

const store = await connect(loadConfig());
await ensureClauseIndexes(store.db);
const clausesCol = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);
const derivedCol = store.db.collection<DerivedTagsDoc>(DERIVED_COLLECTION);

const clauseDocs = await clausesCol.find({}).toArray();
console.log(`clause docs: ${clauseDocs.length} | DERIVE_VERSION ${DERIVE_VERSION}`);

let written = 0, skipped = 0, empty = 0, tokenWritten = 0, grammarSwitched = 0;
// STICKER CARDS ARE NOT IN `cards` (owner 2026-10-14): ingest skips them and `purge-sticker-cards`
// removed the existing ones, with their clause and derived rows, so there is nothing to exclude here.

// A CARD WITH NO ANSWER FOR ITS TEXT THAT THE GRAMMAR READS COMPLETELY (G-T1): normalize-corpus no
// longer buys one, so it has no clause doc, or only one bought for text it no longer prints (an
// erratum). It derives from its printed text here, and the stored loop below leaves it alone. Same
// scope as `normalize-corpus --commander-legal`. A card the grammar does not read stays as before:
// derived from its stored answer if it has one, absent until bought if not.
const answeredHash = new Map(clauseDocs.filter((d) => !(d as { isToken?: boolean }).isToken).map((d) => [d.oracleId, d.segmentHash] as const));
const grammarOnly = new Set<string>();
let grammarOnlyWritten = 0;
// A loyalty-cost mana line whose card document gave no starting loyalty is a source silently dropped downstream (owner 2026-10-13: loyalty comes from ingest): counted and named.
const unpricedLoyalty: string[] = [];
for await (const card of store.cards.find({ "legalities.commander": "legal" } as never).project({ _id: 1, oracleText: 1, keywords: 1, typeLine: 1 })) {
  const c = card as unknown as { _id: string; oracleText?: string; keywords?: string[]; typeLine?: string };
  const hash = segmentHash(c.oracleText ?? "", c.typeLine ?? "", c.keywords ?? []);
  if (answeredHash.get(c._id) === hash) continue;
  const source = await store.cards.findOne({ _id: c._id } as never) as unknown as { _id: string; name: string } | null;
  if (!source) continue;
  const g = grammarClauseRecords(source as never);
  if (!g.complete) continue;
  grammarOnly.add(c._id);
  const existing = await derivedCol.findOne({ oracleId: c._id });
  if (!FORCE && existing?.deriveVersion === DERIVE_VERSION && existing.segmentHash === hash && existing.clauseSource === "grammar") continue;
  const tags = deriveCardTags(deriveInputOf(source as never, c._id, source.name, g.records, undefined, g.readings));
  // normalizeVersion 0: no answer was bought, so a later bought one always reads as new.
  // replaceOne, not $set: the stored row is exactly the fresh one, so a key derive stopped producing goes (#1181).
  await derivedCol.replaceOne({ oracleId: c._id }, derivedRow(tags, { deriveVersion: DERIVE_VERSION, normalizeVersion: 0, segmentHash: hash, clauseSource: "grammar" }), { upsert: true });
  grammarOnlyWritten++;
  unpricedLoyaltyLines(tags.manaLines).forEach(() => unpricedLoyalty.push(source.name));
}
console.log(`no answer for the printed text, read completely by the grammar: ${grammarOnly.size} card(s), ${grammarOnlyWritten} derived this run`);

// ONE READ OF EVERY DERIVED ROW'S BOOKKEEPING, THEN BATCHES (G-T2, docs/plans/2026-10-04-grammar-derive-review.md
// F9): this was three round trips per card (the derived row, the card, the write), serial, ~136 s for a
// --force. Now: one find for the staleness check, then per batch one find for the sources, the derive
// spread over worker threads, one bulkWrite. Results come back in input order, so the writes are the
// sequential run's.
const existingById = new Map((await derivedCol.find({}, { projection: { oracleId: 1, deriveVersion: 1, normalizeVersion: 1, segmentHash: 1 } }).toArray())
  .map((e) => [e.oracleId, e as DerivedTagsDoc] as const));
const due = clauseDocs.filter((doc) => {
  if (grammarOnly.has(doc.oracleId)) return false;
  if (!FORCE && !needsDerive(existingById.get(doc.oracleId) ?? null, doc, DERIVE_VERSION)) { skipped++; return false; }
  return true;
});
const workersArg = Number(process.argv[process.argv.indexOf("--workers") + 1]);
const pool = createPool<DeriveItem, DeriveResult>(new URL("../derive-worker.ts", import.meta.url), {
  ...(process.argv.includes("--workers") && Number.isFinite(workersArg) ? { workers: workersArg } : {}),
});
const BATCH = 2000;
try {
  for (let b = 0; b < due.length; b += BATCH) {
    const batch = due.slice(b, b + BATCH);
    // Task 4 wrote 94 token rows into this same collection, keyed on the token's own oracle id and
    // flagged `isToken: true` — they have no entry in `cards` at all, so their characteristics must
    // come from `tokens` instead. `CardClausesDoc` doesn't declare the field because ordinary cards
    // never carry it; only `normalize-tokens.ts`'s writes do.
    const isToken = (doc: CardClausesDoc) => (doc as CardClausesDoc & { isToken?: boolean }).isToken === true;
    const ids = (tokens: boolean) => batch.filter((d) => isToken(d) === tokens).map((d) => d.oracleId);
    const sources = new Map<string, Record<string, unknown>>();
    for (const d of await store.cards.find({ _id: { $in: ids(false) } } as never).toArray()) sources.set(d._id as string, d as never);
    for (const d of await store.db.collection(TOKENS_COLLECTION).find({ _id: { $in: ids(true) } } as never).toArray()) sources.set(d._id as unknown as string, d as never);
    const items: DeriveItem[] = [];
    for (const doc of batch) {
      const source = sources.get(doc.oracleId);
      if (!source) { console.log(`SKIP ${doc.name}: ${isToken(doc) ? "token" : "card"} doc missing`); continue; }
      items.push({ doc, source, isToken: isToken(doc) });
    }
    const results = await pool.map(items);
    await derivedCol.bulkWrite(items.map(({ doc, isToken: token }, i) => {
      const { tags, fromGrammar } = results[i]!;
      if (fromGrammar) grammarSwitched++;
      // A card with real rules text deriving zero abilities is the Bitterblossom shape -- worth
      // counting out loud rather than silently writing a doc that reads as a vanilla bear.
      if (tags.abilities.length === 0 && (doc.canonical.length > 0)) empty++;
      written++;
      unpricedLoyaltyLines(tags.manaLines).forEach(() => unpricedLoyalty.push(doc.name));
      if (token) tokenWritten++;
      return {
        replaceOne: {
          filter: { oracleId: doc.oracleId },
          // Which answer the abilities came from: the printed text alone, or the stored model answer.
          replacement: derivedRow(tags, { deriveVersion: DERIVE_VERSION, normalizeVersion: doc.normalizeVersion, segmentHash: doc.segmentHash, clauseSource: fromGrammar ? "grammar" : "model", isToken: token }),
          upsert: true,
        },
      };
    }), { ordered: false });
  }
} finally {
  await pool.close();
}

console.log(`derived ${written} (${tokenWritten} token), up-to-date ${skipped}, wrote ${empty} card(s)/token(s) with clauses but zero abilities`);
console.log(`from the printed text alone (task 7): ${grammarSwitched} of ${written - tokenWritten} cards derived this run`);
console.log(`loyalty-cost mana lines with no starting loyalty on the card document (rows derived this run; complete only under --force): ${unpricedLoyalty.length}${unpricedLoyalty.length ? ` (${[...new Set(unpricedLoyalty)].join(", ")})` : ""}`);
await store.close();
