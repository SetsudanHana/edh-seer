/** FREE. Reads `cardClauses`, derives, writes `cardTagsDerived`. No API key, no model, no cost.
 *
 *  This is the bin that makes the architecture's claim real: change the taxonomy, bump
 *  DERIVE_VERSION, re-run this, and the whole derived corpus is rebuilt without buying a single
 *  token. If this ever needs the network, the layering has been broken.
 *
 *  Usage: tsx src/bin/derive-corpus.ts [--force] */
import { connect, loadConfig } from "@mtg/data";
import { extractCharacteristics } from "../characteristics.js";
import { segment } from "../segment.js";
import { DERIVE_VERSION } from "../derive/derive.js";
import { deriveCardTags } from "../derive/derive.js";
import {
  CLAUSES_COLLECTION, DERIVED_COLLECTION, ensureClauseIndexes, needsDerive,
  type CardClausesDoc, type DerivedTagsDoc,
} from "../clause-store.js";

const FORCE = process.argv.includes("--force");

const store = await connect(loadConfig());
await ensureClauseIndexes(store.db);
const clausesCol = store.db.collection<CardClausesDoc>(CLAUSES_COLLECTION);
const derivedCol = store.db.collection<DerivedTagsDoc>(DERIVED_COLLECTION);

const clauseDocs = await clausesCol.find({}).toArray();
console.log(`clause docs: ${clauseDocs.length} | DERIVE_VERSION ${DERIVE_VERSION}`);

let written = 0, skipped = 0, empty = 0;
for (const doc of clauseDocs) {
  const existing = await derivedCol.findOne({ oracleId: doc.oracleId });
  if (!FORCE && !needsDerive(existing, doc, DERIVE_VERSION)) { skipped++; continue; }

  const cards = await store.cards.findOne({ _id: doc.oracleId } as never);
  if (!cards) { console.log(`SKIP ${doc.name}: card doc missing`); continue; }

  // Always re-read printed characteristics from the card document. Reusing the existing derived
  // doc's copy would carry stale colours or a stale type line forward through every re-derive,
  // which is the opposite of what a free rebuild is for.
  const tags = deriveCardTags({
    oracleId: doc.oracleId,
    name: doc.name,
    clauses: doc.canonical,
    characteristics: charsFrom(cards as never),
    clauseTexts: clauseTexts(cards as never),
    clauseCosts: clauseCosts(cards as never),
    oracleText: (cards as { oracleText?: string }).oracleText,
  });
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
      },
    },
    { upsert: true },
  );
  written++;
}

console.log(`derived ${written}, up-to-date ${skipped}, wrote ${empty} card(s) with clauses but zero abilities`);
await store.close();

/** Clause id -> clause text, recomputed rather than stored. `segment()` is deterministic over the
 *  same three inputs the clause doc was built from, so this reproduces exactly the clauses the model
 *  was asked about — and it stays free, which is the whole reason the actor recovery in
 *  `recipient.ts` lives on this side of the money line rather than in the prompt. */
function clauseTexts(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) out[c.id] = c.text;
  return out;
}

/** Clause id -> the clause's activation cost, from the SAME `segment()` call `clauseTexts` uses --
 *  `segment.ts`'s `classify()` splits an activated ability's cost out of the body text, so it never
 *  rides along in `clauseTexts`. `repeatsFor` needs both: the cost for the self-sacrifice/tap rules,
 *  the body text for the "once each turn" rule. */
function clauseCosts(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) if (c.cost) out[c.id] = c.cost;
  return out;
}

/** Printed characteristics, read from the card document — derivation never asks a model for what
 *  the database already knows.
 *
 *  DELEGATES to `extractCharacteristics` rather than rebuilding the shape. This function used to own
 *  a second copy of the logic, and the comment it carried already recorded what that costs: "a local
 *  copy of that split is what put '//' into 116 cards' subtypes". It cost the same thing twice — the
 *  changeling fix (2026-08-14) landed in `extractCharacteristics` and moved the population by
 *  exactly zero, because the corpus never called it. One implementation, one place to fix. */
function charsFrom(doc: {
  typeLine?: string; colors?: string[]; colorIdentity?: string[]; manaValue?: number;
  power?: string | null; toughness?: string | null; keywords?: string[]; layout?: string;
}): DerivedTagsDoc["characteristics"] {
  return extractCharacteristics({
    typeLine: doc.typeLine ?? "",
    layout: doc.layout,
    colors: doc.colors ?? [],
    colorIdentity: doc.colorIdentity ?? [],
    manaValue: doc.manaValue ?? 0,
    power: doc.power ?? null,
    toughness: doc.toughness ?? null,
    keywords: doc.keywords ?? [],
  } as never) as DerivedTagsDoc["characteristics"];
}
