/** WHAT DERIVATION IS FED, from a card document -- one implementation for the corpus bin and the
 *  offline compass gate (owner 2026-09-28: the offline gate derived from a thinner input than
 *  production -- no oracle text, no costs -- so three pairs that pass live failed offline, and a gate
 *  that is not production's own path measures something else). Moved verbatim from
 *  `bin/derive-corpus.ts`. */
import { extractCharacteristics } from "./characteristics.js";
import { clauseRequiresOf } from "./derive/markers.js";
import { modalHeaderIds } from "./derive/modal.js";
import type { Requirement } from "./schema.js";
import { grantedToOwnEmblem, grantedToOwnToken, segment } from "./segment.js";
import { hasEmblemPart } from "./emblem.js";
import type { DerivedTagsDoc } from "./clause-store.js";
import type { ClauseRecord } from "./canonicalize.js";
import type { Clause } from "./segment.js";
import type { DeriveInput } from "./derive/derive.js";
import type { MeldParts } from "./derive/meld-pair.js";
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

/** THE CLAUSE A TEXTLESS TWIN WAS PRINTED IN (#1577 part 4). The model splits one printed clause that fires on two events ("dies or is put into a graveyard": Dreadhound, "enters or attacks": Visage of Dread's back face) into two records and numbers the second
 *  past the segmenter's last id; derive reads such a record as a textless twin of its neighbour (`textless` in derive.ts: no id-keyed map has an entry for it) and folds it, so its id must stay one the segmenter lacks. But every map keyed by clause id is empty for it, and the
 *  FACE is the one that moves a pair: a back-face twin read as a front-face ability (Visage of Dread's "Whenever this creature attacks" fed the front face's pairs). This maps each such id to the clause whose text holds the most of the record's trigger event, subject, verbs
 *  and objects (the earlier clause on a tie), so `clauseFaces` can stamp the twin with that clause's face.
 *  CEILING: the face only. The twin's cost (10 corpus cards), text and grant stay unread, because stamping them would move it out of the textless fold (derive 395, 401: 226 cards). A record whose id the segmenter HAS is never moved: a content match for an in-range id was
 *  tried and read 5 of 5 sampled aligned records as misplaced (Supernatural Stamina, Urza's Saga, Dain Ironfoot, Abnormal Endurance, Caesar), because a granted clause echoes its granter's words. Census (cardClauses vs segment(), 2026-11-09): 557 of 32,008 stored answers
 *  number their clauses unlike the segmenter, 222 of them the answer a card is derived from (7,035 model-sourced cards: 185 hold an id the segmenter lacks, 37 a shared id; the other 335 are read as the grammar's own records). Of the 185, 6 sit beside a back-face clause. */
const ALIGN_STOP = new Set(["the", "and", "your", "you", "this", "that", "its", "each", "with", "from", "into", "onto", "target", "card", "cards", "any", "all", "one", "than", "other", "for", "may", "unless", "creature", "none", "control"]);
function wordsOf(raw: string, drop: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  let w = "";
  const flush = (): void => { if (w.length >= 3 && !drop.has(w)) out.add(w); w = ""; };
  for (const ch of raw.toLowerCase()) { if ((ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9")) w += ch; else flush(); }
  flush();
  return out;
}
export function twinClauseOf(clauses: readonly ClauseRecord[], segmented: readonly Clause[]): Map<number, number> {
  const known = new Set(segmented.map((c) => c.id));
  const view = segmented.map((c) => { const words = wordsOf(`${c.text} ${c.cost ?? ""}`, new Set()); return { id: c.id, words, stems: new Set([...words].filter((x) => x.length >= 4).map((x) => x.slice(0, 4))) }; });
  const out = new Map<number, number>();
  for (const r of clauses) {
    if (!Number.isInteger(r.id) || r.id >= 100 || known.has(r.id) || out.has(r.id)) continue;
    const words = [...wordsOf([r.trigger?.event ?? "", r.trigger?.subject ?? "", ...(r.actions ?? []).flatMap((a) => [a.verb ?? "", String(a.object ?? "")])].join(" "), ALIGN_STOP)];
    // A word of the record is in the clause: whole for a short word, its first four letters for a longer one ("enters" / "enter", "exiled" / "exile").
    let best = -1, bestScore = 0;
    for (const v of view) {
      const sc = words.filter((x) => v.words.has(x) || (x.length >= 4 && v.stems.has(x.slice(0, 4)))).length;
      if (sc > bestScore) { best = v.id; bestScore = sc; }
    }
    if (best >= 0) out.set(r.id, best);
  }
  return out;
}

/** `clauseFaces`, with every textless twin on its printed clause's face (`twinClauseOf`). */
export function clauseFacesWithTwins(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }, clauses: readonly ClauseRecord[]): Record<number, number> {
  const out = clauseFaces(doc);
  const segmented = segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "");
  for (const [twin, printed] of twinClauseOf(clauses, segmented)) {
    const face = segmented.find((c) => c.id === printed)?.face;
    if (face) out[twin] = face;
  }
  return out;
}

/** Granted clause id -> the clause that grants it, from the same `segment()` call: a `granted` clause carries `parentId`.
 *  Chromatic Lantern's quoted "{T}: Add one mana of any color" is granted by "Lands you control have that ability".
 *
 *  A STORED ANSWER THAT NUMBERS ITS CLAUSES OTHERWISE (#1575). The model sometimes splits one printed clause in two ("Whenever you cast or copy ...": Elemental Expressionist stores the cast and the copy trigger as
 *  clauses 1 and 2 and the quoted token trigger as 3, where `segment()` has the granted clause as 2), so the quoted ability's id is one the segmenter never had, and it read as the card's own. A stored clause
 *  whose id the segmenter does not have, whose every action object is words of a granted clause's text, and whose trigger event (first four letters) is in that text, is that granted clause: it takes the same parent.
 *  CEILING: only a stored id the segmenter lacks is matched by content; a stored id the segmenter also has keeps the segmenter's answer even where the model moved a clause onto it (Goldspan Dragon's duplicate 2). */
export function clauseGrants(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }, clauses?: readonly ClauseRecord[]): Record<number, number> {
  const out: Record<number, number> = {};
  const segmented = segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? "");
  for (const c of segmented) if (c.kind === "granted" && c.parentId !== undefined) out[c.id] = c.parentId;
  if (clauses === undefined) return out;
  const known = new Set(segmented.map((c) => c.id));
  const granted = segmented.filter((c) => c.kind === "granted" && c.parentId !== undefined);
  for (const c of clauses) {
    if (known.has(c.id) || out[c.id] !== undefined) continue;
    const objects = (c.actions ?? []).map((a) => String(a.object ?? "").trim().toLowerCase()).filter((o) => o !== "");
    if (objects.length === 0) continue;
    // ...and a trigger's event word appears in it (its first four letters: "exiled" / "put into exile"), else "blocks | sacrifice it" is any clause with a pronoun (Dorothea's own block trigger).
    const stem = (c.trigger?.event ?? "").toLowerCase().slice(0, 4);
    const g = granted.find((x) => { const t = x.text.toLowerCase(); return objects.every((o) => t.includes(o) && (stem !== "" || o.length >= 4)) && (stem === "" || t.includes(stem)); });
    if (g !== undefined) out[c.id] = g.parentId!;
  }
  return out;
}

/** The clause ids that are a modal spell's or ability's header, from the same `segment()` call: the `face-a-dilemma` event is emitted from each (Star Trek, #1349). */
export function modalHeads(doc: { oracleText?: string; keywords?: string[]; typeLine?: string }): ReadonlySet<number> {
  return modalHeaderIds(segment(doc.oracleText ?? "", doc.keywords ?? [], doc.typeLine ?? ""));
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

type CardDocLike = Parameters<typeof charsFrom>[0] & { oracleText?: string; keywords?: string[]; typeLine?: string; allParts?: { component?: string; typeLine?: string; name?: string }[]; manaCost?: string; loyalty?: string; faces?: { manaCost?: string; loyalty?: string }[] };

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
    // A stored answer's textless twins sit on their printed clause's face (#1577); the grammar's own records line up by construction.
    clauseFaces: readings === undefined ? clauseFacesWithTwins(card, clauses) : clauseFaces(card),
    clauseGrants: clauseGrants(card, clauses),
    modalHeads: modalHeads(card),
    manaCosts: faceManaCosts(card),
    ...(faceLoyalties(card) ? { startLoyalty: faceLoyalties(card)! } : {}),
    oracleText: card.oracleText,
    grantedToken: grantedTokenClauses(card),
    ...(readings ? { readings } : {}),
    ...(meldPartsOf(card, name) ? { meld: meldPartsOf(card, name)! } : {}),
  };
}

/** The type lines of a meld card's result and partner, from `allParts` (#1582). Undefined for a card with no `meld_result`. */
export function meldPartsOf(card: { allParts?: { component?: string; typeLine?: string; name?: string }[] }, name: string): MeldParts | undefined {
  const parts = card.allParts ?? [];
  const result = parts.find((p) => p.component === "meld_result" && p.typeLine !== undefined);
  if (result === undefined) return undefined;
  const typesOf = (typeLine: string) => { const c = charsFrom({ typeLine }); return { types: c.types, subtypes: c.subtypes }; };
  const partners = parts.filter((p) => p.component === "meld_part" && p.typeLine !== undefined && p.name !== name);
  return { result: typesOf(result.typeLine!), partners: partners.map((p) => typesOf(p.typeLine!)) };
}
