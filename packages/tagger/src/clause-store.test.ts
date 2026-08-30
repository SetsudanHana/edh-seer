import { expect, test } from "vitest";
import { triggerHasCue } from "./clause-store.js";
import type { Clause } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";
import {
  segmentHash, needsNormalize, needsDerive, carriesOther, missesASplit, disagreesOnType,
  dropsOriginZone, worthReasking, dropsTriggerObject, hasPhantomTrigger, carriesOtherTrigger,
  type CardClausesDoc, type DerivedTagsDoc,
} from "./clause-store.js";
import {
  NORMALIZE_VERSION, NORMALIZE_MIN_COMPATIBLE, VOCAB_VERSION, TRIGGER_VOCAB_VERSION,
} from "./normalize-prompt.js";

const HASH = segmentHash("Flying", "Creature — Faerie", ["Flying"]);

const clauseDoc = (over: Partial<CardClausesDoc> = {}): CardClausesDoc => ({
  oracleId: "abc", name: "Bitterblossom",
  clauses: [], canonical: [],
  segmentHash: HASH, normalizeVersion: 1,
  model: "claude-haiku-4-5", updatedAt: new Date(), warnings: [],
  ...over,
});

const derivedDoc = (over: Partial<DerivedTagsDoc> = {}): DerivedTagsDoc => ({
  oracleId: "abc", schemaVersion: 1, promptVersion: 0, model: "derived",
  characteristics: {
    types: ["creature"], subtypes: ["faerie"], colors: ["B"], identity: ["B"],
    cmc: 2, power: "0", toughness: "1", token: false, keywords: ["Flying"],
  },
  abilities: [],
  deriveVersion: 1, normalizeVersion: 1, segmentHash: HASH,
  ...over,
});

test("the hash covers every input segment() actually reads", () => {
  // segment(oracleText, keywords, typeLine) -- hashing oracle text alone means a typeLine or
  // keywords correction re-segments the card while the staleness check keeps serving the stale doc.
  expect(segmentHash("a", "T", ["k"])).toBe(segmentHash("a", "T", ["k"]));
  expect(segmentHash("a", "T", ["k"])).not.toBe(segmentHash("b", "T", ["k"]));
  expect(segmentHash("a", "T", ["k"])).not.toBe(segmentHash("a", "U", ["k"]));
  expect(segmentHash("a", "T", ["k"])).not.toBe(segmentHash("a", "T", ["j"]));
});

test("keyword ORDER is not a fact, so it must not change the hash", () => {
  // Scryfall does not promise a stable keyword order; re-paying for a re-ordered array would be
  // spending money on nothing.
  expect(segmentHash("a", "T", ["flying", "haste"])).toBe(segmentHash("a", "T", ["haste", "flying"]));
});

test("field boundaries are unambiguous even when a field contains the separator", () => {
  // Naive concatenation makes ("ab", "c") and ("a", "bc") collide, which would silently skip a
  // re-normalize the card needed. A SPACE separator is not enough -- oracle text and type lines are
  // full of spaces, so ("a b", "c") and ("a", "b c") would hash identically.
  expect(segmentHash("ab", "c", [])).not.toBe(segmentHash("a", "bc", []));
  expect(segmentHash("a b", "c", [])).not.toBe(segmentHash("a", "b c", []));
  expect(segmentHash("a", "b", ["c"])).not.toBe(segmentHash("a", "b c", []));
});

test("normalizing is skipped only when the card AND the vocabulary are unchanged", () => {
  expect(needsNormalize(null, HASH, 1)).toBe(true);
  expect(needsNormalize(clauseDoc(), HASH, 1)).toBe(false);
  // Oracle/typeLine/keywords changed under us.
  expect(needsNormalize(clauseDoc(), segmentHash("other", "T", []), 1)).toBe(true);
  // Min-compatible raised: the vocabulary changed in a way that invalidates old answers.
  expect(needsNormalize(clauseDoc(), HASH, 2)).toBe(true);
});

/** THIS IS THE TEST THAT PROTECTS THE MONEY. An ADDITIVE vocabulary change — a new verb the model
 *  MAY now use — cannot make an old answer wrong, because the old answer never had the option. So
 *  the queue is gated on NORMALIZE_MIN_COMPATIBLE, not on NORMALIZE_VERSION: bumping the latter
 *  alone must re-queue nothing, or every one-line vocabulary fix re-buys the whole corpus. */
test("an additive vocabulary bump re-queues nothing; raising min-compatible re-queues everything", () => {
  const doc = clauseDoc({ normalizeVersion: 3 });
  // NORMALIZE_VERSION 3 -> 4 with NORMALIZE_MIN_COMPATIBLE still 3.
  expect(needsNormalize(doc, HASH, 3)).toBe(false);
  // And a doc written under the NEWER prompt is not stale either -- the comparison is an ordering,
  // not an equality. An equality check re-queues the whole corpus on any bump, which is the toll
  // gate this split exists to remove.
  expect(needsNormalize(clauseDoc({ normalizeVersion: 4 }), HASH, 3)).toBe(false);
  // A doc from BEFORE the oldest compatible prompt.
  expect(needsNormalize(clauseDoc({ normalizeVersion: 2 }), HASH, 3)).toBe(true);
  // A breaking change raises min-compatible to the new version.
  expect(needsNormalize(doc, HASH, 4)).toBe(true);
});

test("deriving is free, so it re-runs on any drift at all", () => {
  const clauses = clauseDoc();
  expect(needsDerive(null, clauses, 1)).toBe(true);
  expect(needsDerive(derivedDoc(), clauses, 1)).toBe(false);
  // Derivation code changed.
  expect(needsDerive(derivedDoc(), clauses, 2)).toBe(true);
  // The clause doc was re-normalized under a newer vocabulary.
  expect(needsDerive(derivedDoc({ normalizeVersion: 0 }), clauses, 1)).toBe(true);
  // The card itself changed, so the clause doc was rebuilt.
  expect(needsDerive(derivedDoc({ segmentHash: "stale" }), clauses, 1)).toBe(true);
});

test("a derived doc never re-queues into the FLAT grind", () => {
  // deriveCardTags sets promptVersion 0, which needsRetag would read as permanently stale. The two
  // never meet because derived docs live in their own collection and dump-untagged reads cardTags.
  expect(derivedDoc().promptVersion).toBe(0);
  expect(derivedDoc().model).toBe("derived");
});

test("--refresh-other selects exactly the cards whose stored answer used the escape hatch", () => {
  // The cheap way to pick up an additive verb: re-ask only the cards that could answer differently.
  // A card that named every action with a real verb answers the same under a wider vocabulary.
  expect(carriesOther(null)).toBe(false);
  expect(carriesOther(clauseDoc())).toBe(false);
  expect(carriesOther(clauseDoc({
    canonical: [{ id: 1, abilityType: "static", actions: [{ verb: "draw", object: "a card" }] }],
  }))).toBe(false);
  expect(carriesOther(clauseDoc({
    canonical: [{ id: 1, abilityType: "static", actions: [{ verb: "other", object: "Artifact spells you cast cost {1} less" }] }],
  }))).toBe(true);
  // One `other` among several real actions still makes the card worth re-asking.
  expect(carriesOther(clauseDoc({
    canonical: [{
      id: 1, abilityType: "triggered",
      actions: [{ verb: "draw", object: "a card" }, { verb: "other", object: "you have no maximum hand size" }],
    }],
  }))).toBe(true);
});

test("a two-condition clause answered without its split is stale", () => {
  // The prompt now asks for one record per condition, so a doc persisted before that rule recorded
  // ONE of the two events and dropped the other. 27 of the 46 such cards in the calibration corpus
  // are in that state, and none of them carries `other`, so nothing re-queues them: `segmentHash`
  // covers the card's inputs, not the prompt. Measured, not assumed -- the two earlier segmenter
  // fixes needed no selector because their cards had all been refused and carried no doc at all.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "When this artifact enters or is put into a graveyard, draw a card." },
  ];
  const rec = (id: number, event: string): ClauseRecord =>
    ({ id, abilityType: "triggered", trigger: { event, subject: "this", control: "you" }, actions: [{ verb: "draw" }] });

  expect(missesASplit(clauseDoc({ clauses: [rec(1, "enters")] }), segmented)).toBe(true);
  expect(missesASplit(clauseDoc({ clauses: [rec(1, "enters"), rec(2, "dies")] }), segmented)).toBe(false);
  // A card with no two-condition clause has nothing to split.
  expect(missesASplit(clauseDoc({ clauses: [rec(1, "enters")] }),
    [{ id: 1, kind: "ability", abilityType: "triggered", text: "When this enters, draw a card." }])).toBe(false);
  expect(missesASplit(null, segmented)).toBe(false);
});

test("a doc answered under a stale ability type is refreshable", () => {
  // The ACTIVATED cap fix retypes 459 clauses corpus-wide, 34 of them already persisted. Their ids
  // do not move, so `segmentHash` and `missesASplit` both keep serving the stale answer -- and the
  // answer is stale in the way that matters: the model was handed `type=static` with the cost still
  // inline, so the sacrifice or return it pays is recorded as an effect or not at all.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "activated", cost: "{1}, Exile two creature cards from your graveyard", text: "Draw a card." },
  ];
  const rec = (abilityType: string): ClauseRecord => ({ id: 1, abilityType, actions: [{ verb: "draw" }] });

  expect(disagreesOnType(clauseDoc({ canonical: [rec("static")] }), segmented)).toBe(true);
  expect(disagreesOnType(clauseDoc({ canonical: [rec("activated")] }), segmented)).toBe(false);
  // Inert clauses are answered in code as "none" against a segmenter that types them not at all.
  expect(disagreesOnType(
    clauseDoc({ canonical: [{ id: 1, abilityType: "none", actions: [{ verb: "none" }] }] }),
    [{ id: 1, kind: "keyword", text: "Flying" }],
  )).toBe(false);
  expect(disagreesOnType(null, segmented)).toBe(false);
});

test("dropsOriginZone finds a card whose trigger origin the model threw away", () => {
  // River Kelpie: "Whenever this creature or another permanent enters FROM A GRAVEYARD, draw a card."
  // The persisted trigger subject is "this creature or another permanent" -- the origin, which is the
  // entire card, is gone. `segmentHash` cannot see this (it covers the card's inputs, not the prompt)
  // and neither `carriesOther` nor `missesASplit` reaches it, so the doc looks fresh forever.
  const kelpie = "Whenever this creature or another permanent enters from a graveyard, draw a card.";
  expect(dropsOriginZone(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this creature or another permanent" }, actions: [] }],
  }), kelpie)).toBe(true);
  // Kept: nothing to re-ask.
  expect(dropsOriginZone(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "another permanent from a graveyard" }, actions: [] }],
  }), kelpie)).toBe(false);
});

test("dropsOriginZone leaves alone the origins the VERB already encodes", () => {
  // "Put into a graveyard from the battlefield" IS `dies`, on all 20 corpus cards that say it, and
  // "from your library" IS `milled`. Re-asking those spends money to be told what the event already
  // says. "From anywhere" widens rather than narrows and needs nothing recorded at all.
  for (const oracle of [
    "Whenever an artifact is put into a graveyard from the battlefield, each opponent loses 1 life.",
    "Whenever one or more creature cards are put into your graveyard from your library, investigate.",
    "Whenever a card is put into an opponent's graveyard from anywhere, that player loses 2 life.",
  ]) {
    expect(dropsOriginZone(clauseDoc({
      canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "an artifact" }, actions: [] }],
    }), oracle), oracle).toBe(false);
  }
});

test("dropsOriginZone ignores an origin that belongs to the EFFECT, not the trigger", () => {
  // "When this enchantment enters, return target creature card FROM YOUR GRAVEYARD to your hand"
  // (Omen of the Dead). That origin is already recorded as the action's `fromZone`; the trigger has
  // none. 50 of the corpus's 119 origin mentions are this shape, and re-asking them buys nothing.
  expect(dropsOriginZone(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this enchantment" }, actions: [] }],
  }), "When this enchantment enters, return target creature card from your graveyard to your hand.")).toBe(false);
});

test("a doc already answered by the CURRENT prompt is not worth re-asking", () => {
  // `--refresh-other` was a treadmill: of the 157 cards it selected on the second run, 147 had been
  // bought minutes earlier and came back flagged, because `other` is a LEGITIMATE answer for them
  // and `carriesOther` cannot tell "stuck" from "correctly answered". Re-asking the same prompt for
  // the same card gets the same answer, so the only thing that changes is the bill.
  //
  // A doc refused by the persist gate keeps its OLD version and so stays selectable, which is the
  // whole point: those are the ones a prompt or segmenter fix is meant to reach.
  expect(worthReasking(clauseDoc({ normalizeVersion: 8 }), 8)).toBe(false);
  expect(worthReasking(clauseDoc({ normalizeVersion: 7 }), 8)).toBe(true);
  expect(worthReasking(null, 8)).toBe(false); // no doc at all is `needsNormalize`'s business
});

test("carriesOther only earns a re-ask when the VOCABULARY moved, not the prose", () => {
  // A doc answered under the current vocabulary already had every verb available; it said `other`
  // because no verb covers its action, and it will say `other` again. Keying the refresh on
  // NORMALIZE_VERSION alone made a one-line prose rule reopen 148 cards bought hours earlier.
  const stuck = clauseDoc({
    normalizeVersion: 8,
    canonical: [{ id: 1, abilityType: "static", actions: [{ verb: "other", object: "something odd" }] }],
  });
  expect(carriesOther(stuck, 8)).toBe(false);
  // Answered under an OLDER vocabulary: a verb it needed may exist now.
  expect(carriesOther({ ...stuck, normalizeVersion: 3 }, 8)).toBe(true);
});

test("dropsTriggerObject finds a trigger that recorded WHO instead of WHAT", () => {
  // Valley Floodcaller and The Destined Black Mage: "Whenever you cast a NONCREATURE spell". The
  // prompt never said what a trigger `subject` is, so the model recorded the player -- "you" -- and
  // the noncreature filter never reached the matcher. Their triggers then matched every spell in the
  // deck, and when `castSelfSupplied` started gating unconstrained cast watchers they lost 7 real
  // claims between them, because the engine could not hear them narrow.
  const floodcaller = "Flash\nYou may cast noncreature spells as though they had flash.\nWhenever you cast a noncreature spell, Birds you control get +1/+1 until end of turn.";
  expect(dropsTriggerObject(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "you" }, actions: [] }],
  }), floodcaller)).toBe(true);

  // Recorded properly: nothing to re-ask.
  expect(dropsTriggerObject(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a noncreature spell" }, actions: [] }],
  }), floodcaller)).toBe(false);
});

test("dropsTriggerObject leaves alone a trigger whose subject really is a player", () => {
  // "Whenever you cast a spell" (Aetherflux Reservoir, Birgi, Managorger Hydra) names no thing beyond
  // the bare umbrella, so "you" is the honest answer and re-asking buys nothing. 62 of the corpus's
  // 72 player-only trigger subjects are this, and spending on them would be the treadmill again.
  expect(dropsTriggerObject(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "you" }, actions: [] }],
  }), "Whenever you cast a spell, you gain 1 life for each spell you've cast this turn.")).toBe(false);
  // A filter that sits in the EFFECT, after the comma, is not the trigger's.
  expect(dropsTriggerObject(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "draw", subject: "you" }, actions: [] }],
  }), "Whenever you draw a card, put a +1/+1 counter on target creature you control.")).toBe(false);
});

test("hasPhantomTrigger catches a trigger the card does not have", () => {
  // Grim Guardian prints ONE trigger, a constellation ETB. Its stored clauses carry a second
  // ability triggering on `dies`, which then claimed every enchantment death in its deck. Three
  // Constellation cards and Risen Reef share this exact shape: a real `enters` plus a phantom
  // `dies`; Butcher of Malakir is the mirror image.
  const grimGuardian = "Constellation — Whenever this creature or another enchantment you control enters, each opponent loses 1 life.";
  expect(hasPhantomTrigger(clauseDoc({
    canonical: [
      { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "another enchantment you control" }, actions: [] },
      { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "another enchantment you control" }, actions: [] },
    ],
  }), grimGuardian)).toBe(true);

  // The real trigger alone is clean.
  expect(hasPhantomTrigger(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "another enchantment you control" }, actions: [] }],
  }), grimGuardian)).toBe(false);
});

test("hasPhantomTrigger takes the card's own verb FORMS, and refuses to judge what it cannot check", () => {
  // Card text conjugates: "artifacts you control LEAVE the battlefield" is a leaves trigger, and a
  // cue demanding "leaves" would report 6 defects that are really a missing verb form.
  expect(hasPhantomTrigger(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "leaves", subject: "artifacts you control" }, actions: [] }],
  }), "Whenever one or more artifacts you control leave the battlefield during your turn, create a 1/1 token.")).toBe(false);
  // `cast` has no writable cue — every nonland implies one — so it is absent from the table and a
  // cast trigger is never judged, rather than judged wrongly.
  expect(hasPhantomTrigger(clauseDoc({
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "cast", subject: "a spell" }, actions: [] }],
  }), "Some text mentioning nothing at all.")).toBe(false);
});

test("carriesOtherTrigger finds a card stuck on its TRIGGER, which carriesOther cannot see", () => {
  // Parnesse, the Subtle Brush: its ACTIONS are all fine, its trigger had no word. 38 trigger
  // clauses in the corpus answered `other` and `carriesOther` selects none of them, because it
  // reads `actions` only.
  const legal = ["enters", "dies", "copy"];
  const stuck = clauseDoc({
    normalizeVersion: 3,
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "other", subject: "you copy a spell" }, actions: [{ verb: "copy", object: "that spell" }] }],
  });
  expect(carriesOtherTrigger(stuck, legal, 10)).toBe(true);
  expect(carriesOther(stuck, 10)).toBe(false);

  // An event the model INVENTED is the same "no word fit" signal as saying `other` outright.
  expect(carriesOtherTrigger(clauseDoc({
    normalizeVersion: 3,
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "becomes-blocked", subject: "this creature" }, actions: [] }],
  }), legal, 10)).toBe(true);

  // Answered under the CURRENT trigger vocabulary: every word was already available, so re-asking
  // buys the same answer and a bill. Same gate, same reason, as carriesOther.
  expect(carriesOtherTrigger({ ...stuck, normalizeVersion: 10 }, legal, 10)).toBe(false);

  // A legal trigger is not a gap.
  expect(carriesOtherTrigger(clauseDoc({
    normalizeVersion: 3,
    canonical: [{ id: 1, abilityType: "triggered", trigger: { event: "dies", subject: "a creature" }, actions: [] }],
  }), legal, 10)).toBe(false);
});

/** THE GATE CONSTANTS MUST SIT AT OR BELOW THE PROMPT VERSION, or they gate nothing.
 *
 *  `carriesOther` and `carriesOtherTrigger` both skip a doc when `doc.normalizeVersion >= <gate>`.
 *  A gate ABOVE the current NORMALIZE_VERSION can therefore never be reached by any doc that has
 *  ever been written, so it selects the whole `other` population on every run, forever — the
 *  `--refresh-other` treadmill arriving through the guard built to prevent it.
 *
 *  This is not hypothetical: TRIGGER_VOCAB_VERSION sat at 14 against a NORMALIZE_VERSION of 12 from
 *  the `reveal` addition (2026-08-21) until 2026-08-22, because it was being incremented as a plain
 *  counter rather than set to the prompt version its list changed at. Every doc in the corpus
 *  topped out at v12, so nothing was ever gated out. */
test("vocabulary gate versions cannot exceed the prompt version", () => {
  expect(VOCAB_VERSION).toBeLessThanOrEqual(NORMALIZE_VERSION);
  expect(TRIGGER_VOCAB_VERSION).toBeLessThanOrEqual(NORMALIZE_VERSION);
  // And a gate below MIN_COMPATIBLE is dead the other way: every live doc is at or above it, so the
  // selector can never fire at all.
  expect(VOCAB_VERSION).toBeGreaterThanOrEqual(NORMALIZE_MIN_COMPATIBLE);
  expect(TRIGGER_VOCAB_VERSION).toBeGreaterThanOrEqual(NORMALIZE_MIN_COMPATIBLE);
});

/** `damage-dealt` is what the clause layer spells; `combat-damage` and `non-combat-damage` are what
 *  derive turns it into. With no row of its own the cue answered TRUE for every text, which made
 *  `textForClause`'s disambiguating fallback useless — a clause orphaned by the model renumbering
 *  its siblings matched every sentence, "exactly one" never held, and the clause got no text at all.
 *  Nine clauses lost their trigger outright that way, The Rani's among them, because the
 *  `damage-dealt` branch refuses rather than guess a direction it cannot read. */
test("damage-dealt has a cue, so an orphaned clause can be matched to its own sentence", () => {
  const rani = "Whenever The Rani enters or attacks, create a red Aura enchantment token.";
  const damage = "Whenever a goaded creature deals combat damage to one of your opponents, investigate.";
  expect(triggerHasCue("damage-dealt", damage)).toBe(true);
  expect(triggerHasCue("damage-dealt", rani)).toBe(false);
});

/** THE CUE IS THE WORD, IN EITHER VOICE, because its only job is to say WHICH SENTENCE — the
 *  direction is decided afterwards against that sentence. A cue demanding "deals ... damage" would
 *  have marked ten real cards phantom, every one of which prints the word and means it. */
test("the damage cue reads the passive voice too", () => {
  expect(triggerHasCue("damage-dealt", "Whenever your opponents are dealt combat damage, ...")).toBe(true);
  expect(triggerHasCue("damage-dealt", "Whenever you're dealt damage, you may create that many tokens.")).toBe(true);
  expect(triggerHasCue("damage-dealt", "Whenever combat damage is dealt to you or a planeswalker you control, ...")).toBe(true);
});
