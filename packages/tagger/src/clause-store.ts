/** The two collections behind the derived-tag pipeline, and the staleness rules that decide which
 *  work is free and which costs money.
 *
 *  `cardClauses` is the PAID layer — one LLM call per card. `cardTagsDerived` is regenerated from it
 *  for nothing. Keeping them apart is what makes the architecture's own claim true: change the
 *  taxonomy, re-derive, never re-tag. Storing only the derived abilities would mean every derivation
 *  change costs another full pass.
 *
 *  Raw AND canonical clauses are both stored. `canonicalize.ts` has already shipped one wrong rule
 *  (the fromZone collapse that erased Scavenging Ooze and Bojuka Bog, fixed in 8995018); with
 *  canonical-only, the next one would be unrecoverable without re-paying for every call. A few
 *  hundred bytes per card protects the one artifact this pipeline promises never to re-buy. */
import { createHash } from "node:crypto";
import type { Db } from "mongodb";
import type { CardTags } from "./schema.js";
import type { ClauseRecord } from "./canonicalize.js";
import type { ClauseViolation } from "./validate-clauses.js";

export const CLAUSES_COLLECTION = "cardClauses";
export const DERIVED_COLLECTION = "cardTagsDerived";

export interface CardClausesDoc {
  oracleId: string;
  name: string;
  /** Exactly what the model answered, after the persist gate and before canonicalisation. */
  clauses: ClauseRecord[];
  /** What derivation consumes: one encoding per fact. */
  canonical: ClauseRecord[];
  segmentHash: string;
  normalizeVersion: number;
  model: string;
  updatedAt: Date;
  /** Warn-severity gate findings, kept so a rising rate is visible without re-running the corpus. */
  warnings: ClauseViolation[];
}

export interface DerivedTagsDoc extends CardTags {
  deriveVersion: number;
  /** Copied from the clause doc, so a re-normalize invalidates the derived doc. */
  normalizeVersion: number;
  segmentHash: string;
}

/** A separator that cannot occur in oracle text, a type line or a keyword. Written as an escape
 *  rather than a literal control byte: a raw NUL is invisible in an editor, makes `grep` treat the
 *  file as binary, and turns into a plain space on one careless copy-paste -- at which point
 *  ("a b","c") and ("a","b c") hash identically and a card silently never re-normalizes. */
const SEP = "\u0000";

/** Every input `segment()` reads — `segment(oracleText, keywords, typeLine)`.
 *
 *  Hashing oracle text alone was the draft position and it is wrong: `typeLine` drives
 *  `isSpellCard`, and `keywords` drives the keyword-line and keyword-cost branches, so a corpus
 *  correction to either re-segments the card while a text-only hash keeps serving the stale doc
 *  forever. Keywords are sorted because their order is not a fact and re-paying for a re-ordered
 *  array would be spending money on nothing. */
export function segmentHash(oracleText: string, typeLine: string, keywords: string[]): string {
  const parts = [oracleText, typeLine, [...keywords].sort().join(",")];
  return createHash("sha256").update(parts.join(SEP)).digest("hex");
}

/** COSTS MONEY. Only skipped when the card and the closed vocabularies are both unchanged. */
export function needsNormalize(
  existing: CardClausesDoc | null,
  hash: string,
  normalizeVersion: number,
): boolean {
  if (!existing) return true;
  return existing.segmentHash !== hash || existing.normalizeVersion !== normalizeVersion;
}

/** FREE, so it re-runs on any drift: newer derivation code, a re-normalized clause doc, or a
 *  rebuilt clause doc for a card whose text changed. */
export function needsDerive(
  existing: DerivedTagsDoc | null,
  clauses: CardClausesDoc,
  deriveVersion: number,
): boolean {
  if (!existing) return true;
  return existing.deriveVersion !== deriveVersion
    || existing.normalizeVersion !== clauses.normalizeVersion
    || existing.segmentHash !== clauses.segmentHash;
}

/** Unique on `oracleId` for both collections, because nothing else enforces it.
 *  `packages/data/src/db.ts` only indexes `cards.searchNames`, so two concurrent runs racing an
 *  `upsert` have no constraint stopping them from writing duplicate docs for one card. Called by
 *  the bins rather than by `connect()`, which should not pay for indexes it never uses. */
export async function ensureClauseIndexes(db: Db): Promise<void> {
  await db.collection(CLAUSES_COLLECTION).createIndex({ oracleId: 1 }, { unique: true });
  await db.collection(DERIVED_COLLECTION).createIndex({ oracleId: 1 }, { unique: true });
}
