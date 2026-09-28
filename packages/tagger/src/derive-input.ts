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

/** Clause id -> clause text, recomputed rather than stored. `segment()` is deterministic over the
 *  same three inputs the clause doc was built from, so this reproduces exactly the clauses the model
 *  was asked about — and it stays free, which is the whole reason the actor recovery in
 *  `recipient.ts` lives on this side of the money line rather than in the prompt. */
export function clauseTexts(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "")) out[c.id] = c.text;
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

/** Clause id -> the game-state requirement its ability word carries ("Max speed —"), from the same
 *  `segment()` call, matched by line tail because the segmenter strips the word (roadmap W18). */
export function clauseRequires(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, Requirement> {
  return clauseRequiresOf(doc.oracleText ?? "", segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? ""));
}

/** Clause id -> the clause's activation cost, from the SAME `segment()` call `clauseTexts` uses --
 *  `segment.ts`'s `classify()` splits an activated ability's cost out of the body text, so it never
 *  rides along in `clauseTexts`. `repeatsFor` needs both: the cost for the self-sacrifice/tap rules,
 *  the body text for the "once each turn" rule. */
export function clauseCosts(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): Record<number, string> {
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
