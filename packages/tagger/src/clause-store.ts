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
import type { Clause } from "./segment.js";
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

/** COSTS MONEY. Only skipped when the card and the closed vocabularies are both unchanged.
 *
 *  The version argument is NORMALIZE_MIN_COMPATIBLE — the oldest prompt whose answers are still
 *  valid — and the comparison is an ORDERING, deliberately. An equality check against
 *  NORMALIZE_VERSION re-buys all 2,453 cards on any bump at all, so a one-line vocabulary addition
 *  costs $8.50 and the fixes queue up behind the toll gate instead of shipping. An ADDITIVE change
 *  cannot invalidate an old answer: the new verb only widens what the model MAY say, and the old
 *  answer never had the option. A BREAKING change (prompt prose, a changed rule, a segmenter change
 *  that moves clause ids) raises min-compatible as well, and pays for the corpus visibly. */
export function needsNormalize(
  existing: CardClausesDoc | null,
  hash: string,
  minCompatibleVersion: number,
): boolean {
  if (!existing) return true;
  return existing.segmentHash !== hash || existing.normalizeVersion < minCompatibleVersion;
}

/** Did this card's stored answer reach for the escape hatch? Those are exactly the cards an
 *  ADDITIVE vocabulary change can improve — a card that named every action with a real verb will
 *  answer the same way under a wider vocabulary, so re-asking it buys nothing.
 *
 *  Reads `canonical`, which is what derivation consumes; a card whose raw answer said `other`
 *  somewhere canonicalisation resolved is not stuck. */
export function carriesOther(doc: CardClausesDoc | null): boolean {
  return (doc?.canonical ?? []).some((c) => (c.actions ?? []).some((a) => a.verb === "other"));
}

/** Was this card answered before the prompt asked for a record per trigger condition? Such a doc
 *  recorded ONE of the clause's two events and silently dropped the other — Ichor Wellspring
 *  remembered as an ETB payoff and not as a death payoff, which is half the card.
 *
 *  `segmentHash` cannot see this: it covers the card's inputs, not the prompt, so these docs look
 *  fresh forever. 27 of the 46 two-condition cards in the calibration corpus are in that state and
 *  none of them carries `other`, so `carriesOther` does not reach them either.
 *
 *  Counts records against clauses rather than matching each overflow to its parent: a card with two
 *  two-condition clauses and only one split reads as answered. That undercounts, never overcounts,
 *  and the finer check costs more code than the remaining cards are worth. */
export function missesASplit(doc: CardClausesDoc | null, segmented: Clause[]): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  return segmented.some((c) => c.multiTrigger) && doc.clauses.length <= segmented.length;
}

/** Does the persisted answer disagree with the CURRENT segmenter about what kind of ability a clause
 *  is? The segmenter decides this mechanically, from a cost prefix or a trigger cue, and the model is
 *  handed the answer — so a disagreement means the model was handed a different one than it would be
 *  handed today, on a card whose clause ids never moved. `segmentHash` cannot see that: it covers the
 *  card's inputs, not the segmenter.
 *
 *  It matters because the type travels with the TEXT. A clause retyped from static to activated has
 *  its cost split off, so the model that answered under the old typing saw "{1}, Exile two creature
 *  cards from your graveyard: ..." as one undivided sentence and recorded the exile as an effect, or
 *  as nothing at all. That is the aristocrats signal, silently absent.
 *
 *  Measured before it was written: across all 2,538 persisted docs the ONLY disagreements are the 34
 *  the ACTIVATED-cap fix creates. So the general check costs no more cards than a check aimed at
 *  `activated` alone, and it will catch the next segmenter fix without being rewritten. Clauses the
 *  segmenter leaves untyped are inert and answered in code; they are not evidence of anything. */
export function disagreesOnType(doc: CardClausesDoc | null, segmented: Clause[]): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  return segmented.some((c) => {
    if (!c.abilityType) return false;
    const rec = doc.canonical.find((r) => r.id === c.id);
    return rec !== undefined && rec.abilityType !== undefined && rec.abilityType !== c.abilityType;
  });
}

/** The ORIGIN zone a trigger names, when the verb does not already carry it. "Whenever a player casts
 *  a spell FROM A GRAVEYARD" (River Kelpie), "whenever you cast a legendary spell FROM YOUR HAND"
 *  (Jodah) — the origin is the whole card, and the prompt never asked for it, so the model dropped it
 *  and the trigger matched every cast in the deck.
 *
 *  `battlefield` and `library` are deliberately absent. "Is put into a graveyard from the battlefield"
 *  already normalizes to `dies` on all 20 corpus cards that say it, and "from your library" to
 *  `milled`; re-asking those spends money to be told what the event already says. "From anywhere"
 *  widens rather than narrows, and an unset origin already means any. */
const TRIGGER_ORIGIN = /\bfrom (?:a|an|your|their|the)?\s*(graveyard|exile|hand)\b/i;

/** The head of a trigger line: everything up to the comma that ends it. An origin AFTER that comma
 *  belongs to the effect ("return target creature card from your graveyard to your hand") and is
 *  already recorded as the action's `fromZone` — 50 of the corpus's 119 origin mentions are that
 *  shape, and re-asking them buys nothing. */
const TRIGGER_LINE = /^(?:whenever|when|at)\b.*/gim;

/** Did the model throw away an origin zone this card's trigger states? Neither `segmentHash` (which
 *  covers the card's inputs, not the prompt) nor `carriesOther` nor `missesASplit` can see it, so
 *  these docs look fresh forever. The selector for `--refresh-other` after the prompt learned to keep
 *  the phrase. */
export function dropsOriginZone(doc: CardClausesDoc | null, oracleText: string): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  const wanted = (oracleText.match(TRIGGER_LINE) ?? [])
    .filter((line) => TRIGGER_ORIGIN.test(line.slice(0, line.includes(", ") ? line.indexOf(", ") : line.length)));
  if (wanted.length === 0) return false;
  const kept = doc.canonical.filter((c) => TRIGGER_ORIGIN.test(c.trigger?.subject ?? "")).length;
  return kept < wanted.length;
}

/** Can re-asking this card's clauses actually change the answer? Only if the doc was answered by an
 *  OLDER prompt than the one that would be sent now.
 *
 *  Without this `--refresh-other` is a treadmill. `carriesOther` cannot tell a card STUCK on the
 *  escape hatch from one for which `other` is the right answer, so on the second run of 2026-08-06 it
 *  selected 157 cards of which 147 had been bought minutes earlier and came back flagged identically.
 *  Re-asking the same prompt for the same card buys the same answer; the only thing that changes is
 *  the bill.
 *
 *  A doc REFUSED by the persist gate keeps its old version and stays selectable, which is exactly
 *  what a prompt or segmenter fix needs in order to reach it. */
export function worthReasking(doc: CardClausesDoc | null, currentVersion: number): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  return doc.normalizeVersion !== currentVersion;
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
