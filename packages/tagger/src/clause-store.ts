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
export function carriesOther(doc: CardClausesDoc | null, vocabVersion?: number): boolean {
  // A doc answered under the CURRENT vocabulary already had every verb available; re-asking it under
  // a prompt whose only change is prose gets the same `other` back. See VOCAB_VERSION. Omitting the
  // argument asks the plain question -- does this doc carry the escape hatch -- with no gate.
  if (doc && vocabVersion !== undefined && doc.normalizeVersion >= vocabVersion) return false;
  return (doc?.canonical ?? []).some((c) => (c.actions ?? []).some((a) => a.verb === "other"));
}

/** Is this card stuck on the escape hatch for its TRIGGER, rather than for an action?
 *
 *  `carriesOther` reads `actions` only, so a card whose actions are all fine and whose TRIGGER
 *  answered `other` is invisible to it — and those are exactly the cards an additive TRIGGERS change
 *  can improve. 38 trigger clauses in the calibration corpus answered `other`, none of which
 *  `carriesOther` selects. Same VOCAB_VERSION gate and same reason: a doc answered under the current
 *  vocabulary already had every word available, so re-asking buys the same answer and only a bill.
 *
 *  Also selects a trigger event that is NOT a legal TRIGGERS member — the model inventing a word
 *  ("copy" before it was one) is the same "no word fit" signal as reaching for `other` explicitly. */
export function carriesOtherTrigger(doc: CardClausesDoc | null, legalTriggers: readonly string[], vocabVersion?: number): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  if (vocabVersion !== undefined && doc.normalizeVersion >= vocabVersion) return false;
  const legal = new Set(legalTriggers);
  return doc.canonical.some((c) => {
    const e = c.trigger?.event;
    return e !== undefined && e !== "none" && (e === "other" || !legal.has(e));
  });
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

/** A trigger subject that names only a PLAYER. Legitimate for most triggers — "whenever you cast a
 *  spell", "whenever you draw a card", "whenever you attack" name no thing beyond the bare umbrella,
 *  and 62 of the corpus's 72 player-only trigger subjects are exactly that. */
const PLAYER_ONLY =
  /^(?:you|a player|each player|an opponent|target opponent|your opponents?|players?|opponents?)$/i;

/** Events whose subject SHOULD be a thing, not a person. A phase trigger ("at the beginning of your
 *  upkeep") names a player and is right to. */
const THING_EVENTS: ReadonlySet<string> = new Set([
  "cast", "enters", "dies", "draw", "mill", "discard", "sacrifice", "attacks", "leaves",
  "counter-added", "create-token", "land-play", "untaps", "taps",
]);

/** A word in a trigger clause that says WHAT, beyond the bare umbrella. */
const NAMES_A_FILTER =
  /\b(?:non-?creature|non-?land|non-?artifact|non-?enchantment|creature|artifact|enchantment|instant|sorcery|land|planeswalker|battle|permanent|historic|legendary|token|colorless|multicolored|equipment|aura|saga)\b/i;

/** Did the model record WHO performed a trigger's event instead of WHAT it happened to?
 *
 *  The prompt never said what a trigger `subject` is, so "Whenever you cast a NONCREATURE spell"
 *  (Valley Floodcaller, The Destined Black Mage) came back as subject `"you"` and the filter never
 *  reached the matcher. Their triggers then matched every spell in the deck — and once
 *  `castSelfSupplied` began gating unconstrained cast watchers, that cost them 7 real claims on the
 *  frozen panel, because the engine could not hear them narrow.
 *
 *  Card-level and deliberately loose: it asks whether the card has a player-only subject on a
 *  thing-event AND any trigger head that names a filter, without matching each clause to its line.
 *  Pairing them exactly needs a line-to-clause map the doc does not carry, and over-selecting costs
 *  pennies while a missed card stays wrong. Only the trigger HEAD counts — a filter after the comma
 *  belongs to the effect, which records its own subject. */
export function dropsTriggerObject(doc: CardClausesDoc | null, oracleText: string): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  const playerOnly = doc.canonical.some((c) =>
    THING_EVENTS.has(c.trigger?.event ?? "") && PLAYER_ONLY.test((c.trigger?.subject ?? "").trim()));
  if (!playerOnly) return false;
  return (oracleText.match(TRIGGER_LINE) ?? []).some((line) =>
    NAMES_A_FILTER.test(line.slice(0, line.includes(", ") ? line.indexOf(", ") : line.length)));
}

/** A PRINTED CUE for each trigger event — a word the card must contain somewhere if it really has
 *  that trigger. Events whose cue is unwritable are absent on purpose and therefore never checked:
 *  `cast` is implied for every nonland, and the phase triggers are structural, not textual.
 *
 *  Deliberately generous — one cue ANYWHERE in the card's text clears the whole card, and each
 *  alternative below was widened after reading the card it cleared. Card text conjugates freely
 *  ("artifacts you control LEAVE the battlefield", "put into YOUR graveyard", "is attackED"), and a
 *  narrow cue would report a defect that is really a missing verb form. Under-reporting is the
 *  correct failure direction for something that decides a spend. */
const TRIGGER_CUES: Record<string, RegExp> = {
  dies: /\bdies?\b|put into (a|your|their|its owner's) graveyard|\bsacrific/i,
  enters: /\benter(s|ing|ed)?\b|put onto the battlefield|returns? .* to the battlefield/i,
  "enters-graveyard": /graveyard|\bdies?\b|\bmill|\bdiscard/i,
  leaves: /\bleaves?\b|\bleave\b|\bdies?\b|put into (a|your|their|its owner's) graveyard|\bexile|returns? .* to (its|their) owner|lose(s)? control/i,
  attacks: /\battack(s|ed|ing)?\b/i,
  taps: /\btap(s|ped|ping)?\b/i,
  untaps: /\buntap/i,
  draw: /\bdraws?\b|\bdrew\b/i,
  discard: /\bdiscard/i,
  "gain-life": /\bgains? \d|\bgain(s)? life|lifelink/i,
  "lose-life": /\bloses? \d|\blose(s)? life|life total/i,
  // The clause layer spells this `sacrificed`, but cards print the EVENT, not the word: Yuna, Grand
  // Summoner says "whenever another permanent you control is put into a graveyard from the
  // battlefield". Demanding the literal word refused 6 real triggers (Yuna, Lynde, Ratchet) — and
  // Yuna is the headline witness of the Saga work, so the strict cue would have deleted the very
  // claim that motivated all of this.
  sacrifice: /\bsacrific|put into (a|your|their|its owner's|an opponent's) graveyard/i,
  // Same shape: Bloodchief Ascension and Tamiyo's emblem both say "whenever a card is put into
  // [someone]'s graveyard from anywhere", which the clause layer records as `milled`.
  mill: /\bmill|put into (a|your|their|its owner's|an opponent's) graveyard|from (your|their) library/i,
  "create-token": /\btoken/i,
  "counter-added": /\bcounter/i,
  "land-play": /\bland\b/i,
  proliferate: /\bproliferate/i,
  "combat-damage": /\bcombat damage|\bdeals? damage/i,
  // THE EVENT THE CLAUSE LAYER SPELLS, as distinct from the two verbs derive turns it into. Without
  // a row here `triggerHasCue` answered TRUE for every text, which made `textForClause`'s
  // disambiguating fallback useless: a clause orphaned by the model renumbering its siblings
  // matched every sentence on the card, so "exactly one" never held and the clause got no text at
  // all. Nine clauses were losing their trigger outright that way -- The Rani's "whenever a goaded
  // creature deals combat damage to one of your opponents", Millicent, Tomebound Lich -- because
  // the `damage-dealt` branch refuses rather than guess a direction it cannot read.
  //
  // DELIBERATELY JUST THE WORD, IN EITHER VOICE. This cue's only job is to say WHICH SENTENCE a
  // clause came from; the direction is decided afterwards by `DAMAGE_RECEIVED` and `COMBAT_DAMAGE`
  // against that sentence. A first cut demanded "deals ... damage" and would have marked ten real
  // cards phantom -- Mindblade Render ("your opponents ARE DEALT combat damage"), Darien, Sun
  // Droplet ("whenever YOU'RE DEALT damage"), Vengeful Pharaoh ("combat damage IS DEALT to you") --
  // every one of which prints the word and means it. Measured against the corpus: the loose cue
  // recovers all 9 orphans with none ambiguous, and marks ZERO additional cards phantom.
  "damage-dealt": /\bdamage\b/i,
  "non-combat-damage": /\bdamage/i,
};

/** Did the model INVENT a trigger the card does not have?
 *
 *  The worst thing this pipeline can produce: everything downstream of the clause layer is
 *  deterministic and will faithfully propagate a hallucination forever. Grim Guardian's printed text
 *  is a single constellation ETB trigger, and its stored clauses carry a SECOND ability triggering on
 *  `dies` — which then claimed every enchantment death in its deck as a synergy.
 *
 *  Measured corpus-wide when this was written: **12 clauses over 11 cards, of 940 checkable trigger
 *  clauses (1.3%)**, in two families. **A phantom DUPLICATE of a real trigger with the event flipped**
 *  — Risen Reef and three Constellation cards (Grim Guardian, Doomwake Giant, Agent of Erebos) all
 *  have a real `enters` plus a phantom `dies`, and Butcher of Malakir is the mirror image. And
 *  **`proliferate` used as a dumping ground** for events the vocabulary cannot spell — "you expend 4",
 *  "you expend 8", "while scrying" — which is precisely what `unknownTriggers` exists to prevent.
 *
 *  Shares its cue table with `bin/phantom-trigger-audit.ts`, which is free and prints the witnesses. */
export function hasPhantomTrigger(doc: CardClausesDoc | null, oracleText: string): boolean {
  if (!doc) return false; // no doc at all is `needsNormalize`'s business
  if (!oracleText) return false;
  return doc.canonical.some((c) => !triggerHasCue(c.trigger?.event, oracleText));
}

/** Does this trigger event have a printed cue in the given text? False ONLY when the event is
 *  checkable and the cue is absent — an unknown or uncheckable event answers true, since refusing
 *  what we cannot judge would delete real triggers.
 *
 *  CARD-SCOPED, ALWAYS. Pass the whole card's text, never one clause's. Measured 2026-08-15: scoping
 *  this to the clause the trigger sits in flags **19 clauses instead of 1, and 18 of the extra are
 *  REAL** — every one a modal ability whose modes `segment()` split into their own clauses, so the
 *  mode text no longer repeats the trigger. "When Kairi dies, choose one — • Return any number of
 *  target nonland permanents" leaves a mode clause with no `dies` in it, and the same shape covers
 *  Junji, Ayula, Satsuki, Jin Sakai, The Spear of Leonidas and Venser. Refusing 18 real triggers to
 *  catch 1 phantom is the trade this project keeps having to measure rather than assume. */
export function triggerHasCue(event: string | undefined, text: string): boolean {
  if (!text) return true;
  const cue = TRIGGER_CUES[event ?? ""];
  return cue === undefined || cue.test(text);
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
