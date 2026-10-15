/** WHAT DERIVATION IS FED, from a card document -- one implementation for the corpus bin and the
 *  offline compass gate (owner 2026-09-28: the offline gate derived from a thinner input than
 *  production -- no oracle text, no costs -- so three pairs that pass live failed offline, and a gate
 *  that is not production's own path measures something else). Moved verbatim from
 *  `bin/derive-corpus.ts`. */
import { extractCharacteristics } from "./characteristics.js";
import { clauseRequiresOf } from "./derive/markers.js";
import type { Requirement } from "./schema.js";
import { grantedToOwnEmblem, grantedToOwnToken, segment } from "./segment.js";
import { hasEmblemPart } from "./emblem.js";
import type { DerivedTagsDoc } from "./clause-store.js";
import type { ClauseRecord } from "./canonicalize.js";
import type { DeriveInput } from "./derive/derive.js";
import { missedCost } from "./grammar/preamble.js";

/** Clause id -> clause text, recomputed rather than stored. `segment()` is deterministic over the
 *  same three inputs the clause doc was built from, so this reproduces exactly the clauses the model
 *  was asked about — and it stays free, which is the whole reason the actor recovery in
 *  `recipient.ts` lives on this side of the money line rather than in the prompt. */
export function clauseTexts(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }, activated?: ReadonlySet<number>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) {
    // A cost the segmenter missed, for a clause the caller says is activated, is split off, as `clauseCosts` and the grammar's
    // own record do: the text is the effect, as it would be had the label been stripped.
    const split = !c.cost && (c.abilityType ?? "static") === "static" && (activated?.has(c.id) ?? false) ? missedCost(c.text) : null;
    out[c.id] = split ? split.effect : c.text;
  }
  return out;
}

/** Clause id -> the face it is printed on, from the SAME deterministic `segment()` the maps above
 *  use. `segment.ts` has always tracked the face in order to classify each clause against its own
 *  face's type line; this carries the number forward instead of dropping it. */
export function clauseFaces(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, number> {
  const out: Record<number, number> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) {
    if (c.face) out[c.id] = c.face;
  }
  return out;
}

/** The clause ids whose ability was granted to a token the clause itself creates, or to an emblem
 *  the clause grants, from the same deterministic `segment()` the two maps above use. Both cues
 *  need the `kind`/`parentId` structure, which `ClauseRecord` does not carry -- the persisted clause
 *  doc is the model's answer, and this is a fact about the SEGMENTATION, so it is recomputed here
 *  rather than stored.
 *
 *  THE EMBLEM CUE ONLY WHEN THE NODE EXISTS: Scryfall lists the emblem in `allParts` for 139 of the
 *  140 corpus cards that grant one; Karn, Living Legacy is the exception and keeps his clause. */
export function grantedTokenClauses(doc: { oracleText?: string; keywords?: string[]; typeLine?: string; allParts?: { component?: string; typeLine?: string }[] }): ReadonlySet<number> {
  const clauses = segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "");
  const out = new Set(grantedToOwnToken(clauses));
  if (hasEmblemPart(doc.allParts)) for (const id of grantedToOwnEmblem(clauses)) out.add(id);
  return out;
}

/** Granted clause id -> the clause that grants it, from the same `segment()` call: a `granted` clause carries `parentId`.
 *  Chromatic Lantern's quoted "{T}: Add one mana of any color" is granted by "Lands you control have that ability". */
export function clauseGrants(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, number> {
  const out: Record<number, number> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) if (c.kind === "granted" && c.parentId !== undefined) out[c.id] = c.parentId;
  return out;
}

/** The printed mana cost of each face (index = face), "" for a face that prints none. */
export function faceManaCosts(doc: { manaCost?: string; faces?: { manaCost?: string }[] }): string[] {
  return doc.faces && doc.faces.length > 0 ? doc.faces.map((f) => f.manaCost ?? "") : [doc.manaCost ?? ""];
}

/** Clause id -> the game-state requirement its ability word carries ("Max speed —"), from the same
 *  `segment()` call, matched by line tail because the segmenter strips the word (roadmap W18). */
export function clauseRequires(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, Requirement> {
  return clauseRequiresOf(doc.oracleText ?? "", segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? ""));
}

/** Clause id -> the clause's activation cost, from the SAME `segment()` call `clauseTexts` uses --
 *  `segment.ts`'s `classify()` splits an activated ability's cost out of the body text, so it never
 *  rides along in `clauseTexts`. `repeatsFor` needs both: the cost for the self-sacrifice/tap rules,
 *  the body text for the "once each turn" rule. */
export function clauseCosts(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }, activated?: ReadonlySet<number>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) {
    if (c.cost) { out[c.id] = c.cost; continue; }
    const split = (c.abilityType ?? "static") === "static" && (activated?.has(c.id) ?? false) ? missedCost(c.text) : null;
    if (split) out[c.id] = split.cost;
  }
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
export function charsFrom(doc: {
  name?: string; typeLine?: string; oracleText?: string; colors?: string[]; colorIdentity?: string[]; manaValue?: number;
  power?: string | null; toughness?: string | null; keywords?: string[]; layout?: string;
}): DerivedTagsDoc["characteristics"] {
  return extractCharacteristics({
    // THE NAME, because "Burakos is also a Cleric ..." is anchored on it (W14, CodeQL): without it
    // every derive crashed on the first card, found on the first re-derive after that anchor.
    name: doc.name ?? "",
    typeLine: doc.typeLine ?? "",
    // THE TEXT BOX IS PART OF THE TYPE LINE for "X is also a Cleric, Rogue, Warrior, and Wizard":
    // `extractCharacteristics` reads it, and this projection had never handed it over, so the
    // corpus re-derived at 103 with Burakos still an Orc alone (2026-09-05).
    oracleText: doc.oracleText ?? "",
    layout: doc.layout,
    colors: doc.colors ?? [],
    colorIdentity: doc.colorIdentity ?? [],
    manaValue: doc.manaValue ?? 0,
    power: doc.power ?? null,
    toughness: doc.toughness ?? null,
    keywords: doc.keywords ?? [],
  } as never) as DerivedTagsDoc["characteristics"];
}

/** The printed starting loyalty of each face (index = face), a NUMBER where one is printed and null where a face has none or prints "X" / "*" (no counter
 *  count a loyalty cost can be compared with; CEILING: the corpus holds four, Nissa, Steward of Elements "X", B.O.B. and Personal Decoy "*", Dungeon Master "1d4+1", and none has a
 *  loyalty-cost mana line, so none is read; one that gains one shows in `derive-corpus`'s count of loyalty-cost lines with no starting loyalty). Undefined for a card with no loyalty at all. From the card document, as ingested from Scryfall (owner 2026-10-13);
 *  a loyalty cost reads it as `ManaLine.startLoyalty`. */
export function faceLoyalties(doc: { loyalty?: string; faces?: { loyalty?: string }[] }): (number | null)[] | undefined {
  const one = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);
  const per = doc.faces && doc.faces.length > 0 ? doc.faces.map((f) => f.loyalty) : [doc.loyalty];
  return per.some((s) => s !== undefined) ? per.map(one) : undefined;
}

type CardDocLike = Parameters<typeof charsFrom>[0] & { oracleText?: string; keywords?: string[]; typeLine?: string; allParts?: { component?: string; typeLine?: string }[]; manaCost?: string; loyalty?: string; faces?: { manaCost?: string; loyalty?: string }[] };

/** EVERYTHING DERIVE READS BESIDE THE CLAUSES, from the card document: the one construction
 *  `derive-corpus` and the grammar-only measurement (#896 task 7) share, so the two derive the same
 *  way. `characteristics` is passed for a token, whose come from the token document.
 *
 *  `readings`, when given (G-T3), is `grammarClauseRecords`'s own `GrammarRecords.readings` -- pass
 *  it ONLY alongside that same call's `records` as `clauses`: the ids line up by construction, and a
 *  model-path `clauses` (the stored answer) can number and split its clauses differently. */
export function deriveInputOf(card: CardDocLike, oracleId: string, name: string, clauses: ClauseRecord[], characteristics?: DerivedTagsDoc["characteristics"], readings?: DeriveInput["readings"]): DeriveInput {
  // A cost the segmenter missed is split off only for a clause the RECORDS call activated: a stored answer
  // that called it static keeps the text it was derived against (Wall of Roots' "this creature").
  const activatedIds = new Set(clauses.filter((c) => c.abilityType === "activated").map((c) => c.id));
  return {
    oracleId,
    name,
    clauses,
    characteristics: characteristics ?? charsFrom(card),
    clauseTexts: clauseTexts(card, activatedIds),
    clauseRequires: clauseRequires(card),
    clauseCosts: clauseCosts(card, activatedIds),
    clauseFaces: clauseFaces(card),
    clauseGrants: clauseGrants(card),
    manaCosts: faceManaCosts(card),
    ...(faceLoyalties(card) ? { startLoyalty: faceLoyalties(card)! } : {}),
    oracleText: card.oracleText,
    grantedToken: grantedTokenClauses(card),
    ...(readings ? { readings } : {}),
  };
}
