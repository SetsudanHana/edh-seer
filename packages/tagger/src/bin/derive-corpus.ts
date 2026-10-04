/** FREE. Reads `cardClauses`, derives, writes `cardTagsDerived`. No API key, no model, no cost.
 *
 *  This is the bin that makes the architecture's claim real: change the taxonomy, bump
 *  DERIVE_VERSION, re-run this, and the whole derived corpus is rebuilt without buying a single
 *  token. If this ever needs the network, the layering has been broken.
 *
 *  Usage: tsx src/bin/derive-corpus.ts [--force] */
import { connect, isStickerCard, loadConfig } from "@edh-seer/data";
import { charsFrom, deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveDiff, lostClaims } from "../grammar/derive-diff.js";
import triage from "../../grammar-only-triage.json" with { type: "json" };
import { DERIVE_VERSION } from "../derive/derive.js";
import { deriveCardTags } from "../derive/derive.js";
import {
  CLAUSES_COLLECTION, DERIVED_COLLECTION, ensureClauseIndexes, needsDerive, segmentHash,
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
// A STICKER CARD IS OUTSIDE THE ENGINE (owner 2026-10-02, `isStickerCard`): no tags, and any row an
// earlier derive wrote is removed so nothing downstream reads it.
const stickers = new Set((await store.cards.find({ oracleText: /sticker/i } as never, { projection: { _id: 1, oracleText: 1, faces: 1 } }).toArray())
  .filter((c) => isStickerCard(c as never)).map((c) => c._id as string));
const removed = (await derivedCol.deleteMany({ oracleId: { $in: [...stickers] } })).deletedCount;
console.log(`sticker cards excluded: ${stickers.size} (${removed} derived row(s) removed)`);

// A CARD WITH NO ANSWER FOR ITS TEXT THAT THE GRAMMAR READS COMPLETELY (G-T1): normalize-corpus no
// longer buys one, so it has no clause doc, or only one bought for text it no longer prints (an
// erratum). It derives from its printed text here, and the stored loop below leaves it alone. Same
// scope as `normalize-corpus --commander-legal`. A card the grammar does not read stays as before:
// derived from its stored answer if it has one, absent until bought if not.
const answeredHash = new Map(clauseDocs.filter((d) => !(d as { isToken?: boolean }).isToken).map((d) => [d.oracleId, d.segmentHash] as const));
const grammarOnly = new Set<string>();
let grammarOnlyWritten = 0;
for await (const card of store.cards.find({ "legalities.commander": "legal" } as never).project({ _id: 1, oracleText: 1, keywords: 1, typeLine: 1 })) {
  const c = card as unknown as { _id: string; oracleText?: string; keywords?: string[]; typeLine?: string };
  if (stickers.has(c._id)) continue;
  const hash = segmentHash(c.oracleText ?? "", c.typeLine ?? "", c.keywords ?? []);
  if (answeredHash.get(c._id) === hash) continue;
  const source = await store.cards.findOne({ _id: c._id } as never) as unknown as { _id: string; name: string } | null;
  if (!source) continue;
  const g = grammarClauseRecords(source as never);
  if (!g.complete) continue;
  grammarOnly.add(c._id);
  const existing = await derivedCol.findOne({ oracleId: c._id });
  if (!FORCE && existing?.deriveVersion === DERIVE_VERSION && existing.segmentHash === hash && existing.clauseSource === "grammar") continue;
  const tags = deriveCardTags(deriveInputOf(source as never, c._id, source.name, g.records));
  // normalizeVersion 0: no answer was bought, so a later bought one always reads as new.
  await derivedCol.updateOne({ oracleId: c._id }, { $set: { ...tags, deriveVersion: DERIVE_VERSION, normalizeVersion: 0, segmentHash: hash, clauseSource: "grammar" } }, { upsert: true });
  grammarOnlyWritten++;
}
console.log(`no answer for the printed text, read completely by the grammar: ${grammarOnly.size} card(s), ${grammarOnlyWritten} derived this run`);

for (const doc of clauseDocs) {
  if (stickers.has(doc.oracleId) || grammarOnly.has(doc.oracleId)) continue;
  const existing = await derivedCol.findOne({ oracleId: doc.oracleId });
  if (!FORCE && !needsDerive(existing, doc, DERIVE_VERSION)) { skipped++; continue; }

  // Task 4 wrote 94 token rows into this same collection, keyed on the token's own oracle id and
  // flagged `isToken: true` — they have no entry in `cards` at all, so their characteristics must
  // come from `tokens` instead. `CardClausesDoc` doesn't declare the field because ordinary cards
  // never carry it; only `normalize-tokens.ts`'s writes do.
  const isToken = (doc as CardClausesDoc & { isToken?: boolean }).isToken === true;
  const source = isToken
    ? await store.db.collection(TOKENS_COLLECTION).findOne({ _id: doc.oracleId } as never)
    : await store.cards.findOne({ _id: doc.oracleId } as never);
  if (!source) { console.log(`SKIP ${doc.name}: ${isToken ? "token" : "card"} doc missing`); continue; }

  // Always re-read printed characteristics from the card/token document. Reusing the existing
  // derived doc's copy would carry stale colours or a stale type line forward through every
  // re-derive, which is the opposite of what a free rebuild is for.
  let tags = deriveCardTags(deriveInputOf(source as never, doc.oracleId, doc.name, doc.canonical, isToken ? tokenCharsFrom(source as never) : undefined));
  // THE CARD-BY-CARD SWITCH (#896 task 7, owner 2026-10-02, option 1): a card the grammar reads
  // completely derives from its printed text alone -- no model answer in the loop -- when that gives
  // the same abilities as the stored answer, or a difference whose group is labelled "grammar right"
  // in grammar-only-triage.json. Every other card keeps its stored answer until its group is labelled.
  let fromGrammar = false;
  if (!isToken) {
    const g = grammarClauseRecords(source as never);
    if (g.complete) {
      const grammarTags = deriveCardTags(deriveInputOf(source as never, doc.oracleId, doc.name, g.records));
      const key = deriveDiff(tags.abilities, grammarTags.abilities);
      // A labelled difference switches only when the grammar claims at least what the stored answer
      // claims (`lostClaims`): the label was judged on a few cards, the guard holds for every card.
      const right = key !== null && (triage.groups as Record<string, { label: string }>)[key]?.label === "grammar right"
        && lostClaims(tags.abilities, grammarTags.abilities).length === 0;
      if (key === null || right) { tags = grammarTags; fromGrammar = true; grammarSwitched++; }
    }
  }
  // A card with real rules text deriving zero abilities is the Bitterblossom shape -- worth
  // counting out loud rather than silently writing a doc that reads as a vanilla bear.
  if (tags.abilities.length === 0 && (doc.canonical.length > 0)) empty++;

  await derivedCol.updateOne(
    { oracleId: doc.oracleId },
    {
      $set: {
        ...tags,
        deriveVersion: DERIVE_VERSION,
        normalizeVersion: doc.normalizeVersion,
        segmentHash: doc.segmentHash,
        ...(isToken ? { isToken: true } : {}),
        // Which answer the abilities came from: the printed text alone, or the stored model answer.
        clauseSource: fromGrammar ? "grammar" : "model",
      },
    },
    { upsert: true },
  );
  written++;
  if (isToken) tokenWritten++;
}

console.log(`derived ${written} (${tokenWritten} token), up-to-date ${skipped}, wrote ${empty} card(s)/token(s) with clauses but zero abilities`);
console.log(`from the printed text alone (task 7): ${grammarSwitched} of ${written - tokenWritten} cards derived this run`);
await store.close();

/** Same shape as `charsFrom`, plus `token: true` -- or, for a layout-`emblem` row, `emblem: true`
 *  and `token: false`. `extractCharacteristics` hardcodes `token: false` (right for every card,
 *  which is all it has ever seen) so this is the one place that flips it. Load-bearing in both
 *  directions per `subject.ts`'s asymmetric tri-state check: it is what lets a token satisfy a
 *  consumer demanding `token: true`, and what stops it satisfying one demanding `token: false`.
 *
 *  AN EMBLEM IS NOT A TOKEN (CR 114.1 vs 111.1): "whenever a token enters" must never match one,
 *  so `token` stays false and `emblem` says what it is. `splitTypeLine` already reads
 *  "Emblem — Chandra" as types `["emblem"]`, subtypes `["chandra"]`, which is what the node wants.
 *  A token document carries no `manaValue` -- `charsFrom` already defaults an absent one to 0. */
function tokenCharsFrom(doc: Parameters<typeof charsFrom>[0] & { layout?: string }): DerivedTagsDoc["characteristics"] {
  if (doc.layout === "emblem") return { ...charsFrom(doc), token: false, emblem: true };
  return { ...charsFrom(doc), token: true };
}
