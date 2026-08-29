import { expect, test } from "vitest";
import type { Clause } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";
import { validateClauses, rejections } from "./validate-clauses.js";

/** A two-clause card: a keyword line answered in code, and a triggered ability. */
const SEGMENTED: Clause[] = [
  { id: 1, kind: "keyword", text: "Flying" },
  {
    id: 2, kind: "ability", abilityType: "triggered",
    text: "Whenever this creature deals combat damage to a player, draw a card.",
    effectActions: ["draw=1"],
  },
];

const GOOD: ClauseRecord[] = [
  { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] },
  {
    id: 2, abilityType: "triggered",
    trigger: { event: "damage-dealt", subject: "this creature", control: "you" },
    actions: [{ verb: "draw", object: "you", amount: "1" }],
  },
];

const kinds = (v: { kind: string }[]): string[] => v.map((x) => x.kind).sort();

test("a well-formed response has no violations", () => {
  expect(validateClauses(SEGMENTED, GOOD)).toEqual([]);
});

test("clause ids must be answered exactly once, none invented, none dropped", () => {
  // Mirkwood Bats: the segmenter emits 2 clauses and the model answered 3, inventing an id to
  // split "create or sacrifice" into two triggers. That shipped into the gold fixture unnoticed.
  const invented = [...GOOD, { id: 3, abilityType: "triggered", actions: [{ verb: "lose-life" }] }];
  expect(kinds(validateClauses(SEGMENTED, invented))).toContain("invented-id");

  const dropped = [GOOD[0]];
  expect(kinds(validateClauses(SEGMENTED, dropped))).toContain("missing-id");

  const duplicated = [...GOOD, GOOD[1]];
  expect(kinds(validateClauses(SEGMENTED, duplicated))).toContain("duplicate-id");
});

test("every verb, zone and trigger event must be in the closed vocabulary", () => {
  // A hallucinated verb currently reaches derive.ts as `unclaimed` -- silently, after the spend.
  const badVerb = [GOOD[0], { ...GOOD[1], actions: [{ verb: "proliferat" }] }];
  expect(kinds(validateClauses(SEGMENTED, badVerb))).toContain("unknown-verb");

  const badZone = [GOOD[0], { ...GOOD[1], actions: [{ verb: "put", toZone: "sideboard" }] }];
  expect(kinds(validateClauses(SEGMENTED, badZone))).toContain("unknown-zone");

  const badEvent = [GOOD[0], { ...GOOD[1], trigger: { event: "combat-damage" } }];
  expect(kinds(validateClauses(SEGMENTED, badEvent))).toContain("unknown-trigger-event");
});

test("abilityType must be copied from the segmenter, not re-decided", () => {
  // normalize-prompt.ts tells the model to copy type= verbatim, so this is literal equality
  // against a value the harness already holds.
  const rewritten = [GOOD[0], { ...GOOD[1], abilityType: "static" }];
  expect(kinds(validateClauses(SEGMENTED, rewritten))).toContain("ability-type-mismatch");
});

test("a trigger belongs on a triggered clause and nowhere else", () => {
  const missing = [GOOD[0], { ...GOOD[1], trigger: undefined }];
  expect(kinds(validateClauses(SEGMENTED, missing))).toContain("missing-trigger");

  // A trigger on a clause the segmenter did not call triggered.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "static", text: "Creatures you control get +1/+1." }];
  const stray: ClauseRecord[] = [
    { id: 1, abilityType: "static", trigger: { event: "enters" }, actions: [{ verb: "modify-pt" }] },
  ];
  expect(kinds(validateClauses(seg, stray))).toContain("unexpected-trigger");

  // `event: "none"` is the vocabulary's way of saying no trigger -- not a violation.
  const noneEvent: ClauseRecord[] = [
    { id: 1, abilityType: "static", trigger: { event: "none" }, actions: [{ verb: "modify-pt" }] },
  ];
  expect(validateClauses(seg, noneEvent)).toEqual([]);
});

test("a sequentially-renumbered twoConditions overflow is accepted", () => {
  // Carrot Cake, verbatim. Clause 1 states two events; clause 2 is an activated ability. The model
  // answers the split correctly but numbers the second half id 2 IN TEXT ORDER, shifting the real
  // clause 2 to id 3. The gate only accepted the overflow at max+1, so it absorbed the wrong record
  // and refused three ways: two type mismatches and a missing trigger.
  const seg: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "When this artifact enters and when you sacrifice it, create a Rabbit and scry 1." },
    { id: 2, kind: "ability", abilityType: "activated", cost: "{2}, {T}, Sacrifice this artifact", text: "You gain 3 life." },
  ];
  const got: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters" }, actions: [{ verb: "draw" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "sacrificed" }, actions: [{ verb: "draw" }] },
    { id: 3, abilityType: "activated", actions: [{ verb: "gain-life" }] },
  ];
  expect(rejections(validateClauses(seg, got))).toEqual([]);
});

test("realignment is CHECKED, not assumed -- a genuinely wrong answer still refuses", () => {
  // The bound, and the whole reason this is not banking a guess. Same shape, but the third record
  // contradicts clause 2's type. The alternate pairing does not validate cleanly, so it is
  // discarded and the card is refused exactly as before.
  const seg: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "When this enters and when you sacrifice it, draw a card." },
    { id: 2, kind: "ability", abilityType: "activated", cost: "{T}", text: "You gain 3 life." },
  ];
  const got: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters" }, actions: [{ verb: "draw" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "sacrificed" }, actions: [{ verb: "draw" }] },
    { id: 3, abilityType: "static", actions: [{ verb: "gain-life" }] },
  ];
  expect(rejections(validateClauses(seg, got)).length).toBeGreaterThan(0);
});

test("realignment does not fire without exactly one marked clause and one extra record", () => {
  // Two marked clauses make the pairing ambiguous; more than one extra record is hallucination.
  const seg: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "a" },
    { id: 2, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "b" },
  ];
  const got: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters" }, actions: [] },
    { id: 2, abilityType: "triggered", trigger: { event: "dies" }, actions: [] },
    { id: 3, abilityType: "triggered", trigger: { event: "leaves" }, actions: [] },
  ];
  // Falls through to the incumbent path rather than realigning; it must not throw or silently pass.
  expect(() => validateClauses(seg, got)).not.toThrow();
});

test("a REDUNDANT implied zone warns instead of refusing the card", () => {
  // 10 of the 15 zone violations in the 2026-08-29 tranche were fromZone/toZone on `draw`, and
  // drawing really does move a card library -> hand. The model was being more explicit than the
  // schema wants and the whole card was thrown away for it; canonicalize nulls implied zones one
  // step later anyway.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "spell", text: "Draw a card." }];
  const redundant: ClauseRecord[] = [{ id: 1, abilityType: "spell", actions: [{ verb: "draw", fromZone: "library", toZone: "hand" }] }];
  const v = validateClauses(seg, redundant);
  expect(kinds(v)).toContain("zone-on-unzoned-verb");
  expect(rejections(v)).toEqual([]);            // recorded, but the card persists
});

test("a WRONG zone on the same verb still refuses the card", () => {
  // The bound. Downgrading redundancy must not downgrade a disagreement: a draw from the GRAVEYARD
  // is not a draw, and reading it as one would bank a false zone.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "spell", text: "Draw a card." }];
  const wrong: ClauseRecord[] = [{ id: 1, abilityType: "spell", actions: [{ verb: "draw", fromZone: "graveyard" }] }];
  expect(rejections(validateClauses(seg, wrong))).toHaveLength(1);
});

test("zones are legal only on the verbs whose zones actually vary", () => {
  // Every other verb already fixes its own zones, and recording them twice is what made two runs
  // disagree over a fact neither of them chose.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "spell", text: "Draw a card." }];
  const zoned: ClauseRecord[] = [{ id: 1, abilityType: "spell", actions: [{ verb: "draw", fromZone: "library" }] }];
  expect(kinds(validateClauses(seg, zoned))).toContain("zone-on-unzoned-verb");
});

test("`play` carries zones even though the prompt's five do not include it", () => {
  // Measured against the gold fixture: this gate rejected Muldrotha, and the gate was wrong.
  // effect-kind.ts:24 consumes { verb: "play", from: "graveyard" } as graveyard-recursion -- it IS
  // Muldrotha's whole card. Rejecting it would re-queue the card forever, paying every time.
  const seg: Clause[] = [{
    id: 1, kind: "ability", abilityType: "static",
    text: "During each of your turns, you may play a land and cast a permanent spell from your graveyard.",
  }];
  const rec: ClauseRecord[] = [{
    id: 1, abilityType: "static", actions: [{ verb: "play", fromZone: "graveyard", toZone: "battlefield" }],
  }];
  expect(validateClauses(seg, rec)).toEqual([]);
});

test("a dropped pre-filled action WARNS, it does not reject", () => {
  // Measured: the pre-fill table is ~97% precise, so hard-rejecting on it would re-queue ~3% of the
  // corpus forever. Syr Konrad is the case -- its trigger has three comma-separated limbs, so
  // effectBody's single-comma split leaves trigger text in the body and pre-fills `put` from it.
  // The model correctly reports no `put` action; the pre-fill is what is wrong.
  const seg: Clause[] = [{
    id: 1, kind: "ability", abilityType: "activated", text: "{T}, Sacrifice a creature: Draw a card.",
    cost: "{T}, Sacrifice a creature", costActions: ["sacrifice"], effectActions: ["draw=1"],
  }];
  const dropped: ClauseRecord[] = [{ id: 1, abilityType: "activated", actions: [{ verb: "draw" }] }];
  const v = validateClauses(seg, dropped);
  expect(kinds(v)).toContain("dropped-prefilled-action");
  expect(v.every((x) => x.severity === "warn")).toBe(true);
  expect(rejections(v)).toEqual([]);

  const kept: ClauseRecord[] = [{
    id: 1, abilityType: "activated",
    actions: [{ verb: "sacrifice", object: "a creature" }, { verb: "draw", amount: "1" }],
  }];
  expect(validateClauses(seg, kept)).toEqual([]);
});

test("vocabulary and id defects DO reject", () => {
  const badVerb = [GOOD[0], { ...GOOD[1], actions: [{ verb: "nonsense" }] }];
  expect(rejections(validateClauses(SEGMENTED, badVerb))).toHaveLength(1);
});

test("violations name the clause they came from, so a reject is debuggable", () => {
  const bad = [GOOD[0], { ...GOOD[1], actions: [{ verb: "nonsense" }] }];
  const v = validateClauses(SEGMENTED, bad);
  expect(v[0].clauseId).toBe(2);
  expect(v[0].detail).toContain("nonsense");
});

test("a stray trigger warns on a spell clause but rejects on a static one", () => {
  // Eerie Interlude: an instant whose creatures return "at the beginning of the next end step".
  // That delayed timing is real and `end-step` is a legal verb, so refusing it just burned two paid
  // retries and blocked a fixture build.
  const spellSeg: Clause[] = [{ id: 1, kind: "ability", abilityType: "spell", text: "Exile any number of target creatures you control." }];
  const spellRec: ClauseRecord[] = [{ id: 1, abilityType: "spell", trigger: { event: "end-step" }, actions: [{ verb: "exile" }] }];
  const v = validateClauses(spellSeg, spellRec);
  expect(kinds(v)).toContain("unexpected-trigger");
  expect(rejections(v)).toEqual([]);

  // On a static clause the same shape is the wildcard mesh, and stays fatal.
  const staticSeg: Clause[] = [{ id: 1, kind: "ability", abilityType: "static", text: "Creatures you control get +1/+1." }];
  const staticRec: ClauseRecord[] = [{ id: 1, abilityType: "static", trigger: { event: "end-step" }, actions: [{ verb: "modify-pt" }] }];
  expect(rejections(validateClauses(staticSeg, staticRec))).toHaveLength(1);
});

test("a modal clause carries no trigger of its own -- the parent has it", () => {
  // Pip-Boy 3000: "Whenever equipped creature attacks, choose one —" then three modes. Modes
  // inherit abilityType "triggered" from the parent, so demanding a trigger on each one refused the
  // whole card. The model is right to omit it; the trigger genuinely lives on the parent clause.
  const seg: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", text: "Whenever equipped creature attacks, choose one —" },
    { id: 2, kind: "mode", abilityType: "triggered", parentId: 1, text: "Draw a card, then discard a card." },
  ];
  const rec: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "equipped creature" }, actions: [{ verb: "none" }] },
    { id: 2, abilityType: "triggered", actions: [{ verb: "draw" }, { verb: "discard" }] },
  ];
  expect(validateClauses(seg, rec)).toEqual([]);
});

test("a Saga chapter carries no trigger of its own -- the lore counter is it", () => {
  // Summon: Fenrir. classify() types a chapter "triggered" because it is, but what fires it is the
  // lore counter, not an event in TRIGGERS.
  const seg: Clause[] = [
    { id: 1, kind: "chapter", abilityType: "triggered", marker: "I", text: "Search your library for a basic land card." },
  ];
  const rec: ClauseRecord[] = [{ id: 1, abilityType: "triggered", actions: [{ verb: "search", object: "your library" }] }];
  expect(validateClauses(seg, rec)).toEqual([]);
});

test("`shuffle` carries zones -- it moves cards between two of them", () => {
  // Perpetual Timepiece: "Shuffle your graveyard into your library." Both zones are the card.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "activated", text: "Shuffle your graveyard into your library." }];
  const rec: ClauseRecord[] = [{
    id: 1, abilityType: "activated",
    actions: [{ verb: "shuffle", object: "your graveyard", fromZone: "graveyard", toZone: "library" }],
  }];
  expect(validateClauses(seg, rec)).toEqual([]);
});

test("an ordinary triggered clause still must carry its trigger", () => {
  // The exemptions above are for clauses whose trigger lives elsewhere -- they must not become a
  // blanket hole, or a real triggered ability could silently lose its event.
  const seg: Clause[] = [{ id: 1, kind: "ability", abilityType: "triggered", text: "When this creature enters, draw a card." }];
  const rec: ClauseRecord[] = [{ id: 1, abilityType: "triggered", actions: [{ verb: "draw" }] }];
  expect(kinds(validateClauses(seg, rec))).toContain("missing-trigger");
});

test("a trigger event the vocabulary cannot name is answered honestly, not refused", () => {
  // 16 of 83 refusals on the --refresh-other run were `unknown-trigger-event`, and 9 of those were
  // the model reaching for "other" -- which VERBS offers and TRIGGERS did not. The asymmetry threw
  // away the WHOLE card (Sauron, the Dark Lord, Call of the Ring, Magda) over one clause the closed
  // set genuinely cannot name. `other` forms no edges: it is not in the engine's VERB_VOCAB, so
  // derivation drops it into unknownTriggers rather than picking a near-miss.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", text: "Whenever you choose a creature as your Ring-bearer, you may pay 2 life." },
  ];
  const got: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "other", subject: "Ring-bearer chosen", control: "you" }, actions: [{ verb: "lose-life", amount: "2" }] },
  ];
  expect(rejections(validateClauses(segmented, got))).toEqual([]);
});

test("the real events the corpus named are members, not escapes", () => {
  // Each was a refusal with a card behind it: Archivist of Oghma (an opponent searching), Unsettled
  // Mariner (becoming a target), Matoya (scry or surveil), Mirror Room (a Room unlocking). They are
  // real, repeatable events -- `other` would record them as unnameable, which is a lie the next
  // vocabulary pass would have to undo.
  for (const event of ["search", "becomes-target", "scry", "surveil", "unlocked"]) {
    const segmented: Clause[] = [{ id: 1, kind: "ability", abilityType: "triggered", text: "Whenever ..." }];
    const got: ClauseRecord[] = [{ id: 1, abilityType: "triggered", trigger: { event, subject: "x", control: "you" }, actions: [{ verb: "draw" }] }];
    expect(rejections(validateClauses(segmented, got)), event).toEqual([]);
  }
});

test("a two-condition clause may be answered with one record per condition", () => {
  // Ichor Wellspring: "When this artifact enters OR is put into a graveyard from the battlefield,
  // draw a card." One clause, two events, and one `trigger` field to put them in. The model splits
  // it and numbers the overflow itself, which the gate read as a hallucinated clause and refused --
  // 16 refusals over two runs. Both records are true, and derivation consumes them id-agnostically,
  // so the card is better recorded WITH the split than without it.
  const segmented: Clause[] = [
    {
      id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true,
      text: "When this artifact enters or is put into a graveyard from the battlefield, draw a card.",
    },
  ];
  const split: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this artifact", control: "you" }, actions: [{ verb: "draw", amount: "1" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "dies", subject: "this artifact", control: "you" }, actions: [{ verb: "draw", amount: "1" }] },
  ];
  expect(rejections(validateClauses(segmented, split))).toEqual([]);
});

test("the overflow allowance is bounded by the number of two-condition clauses", () => {
  // Without a bound this is a hole rather than a fix: a card with one two-condition clause buys one
  // extra record, not a licence to invent. The THIRD record has no clause left to belong to.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "When this enters or attacks, draw a card." },
  ];
  const tooMany: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [{ verb: "draw" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this", control: "you" }, actions: [{ verb: "draw" }] },
    { id: 3, abilityType: "triggered", trigger: { event: "dies", subject: "this", control: "you" }, actions: [{ verb: "draw" }] },
  ];
  expect(kinds(validateClauses(segmented, tooMany))).toContain("invented-id");
});

test("an accepted overflow record is still checked for what it says", () => {
  // Accepting the id must not stop the content check: the extra record is persisted and derived
  // like any other, so an illegal verb in it would be banked as fact.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "When this enters or attacks, draw a card." },
  ];
  const bad: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [{ verb: "draw" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "attacks", subject: "this", control: "you" }, actions: [{ verb: "teleport" }] },
  ];
  expect(kinds(validateClauses(segmented, bad))).toContain("unknown-verb");
});

test("a two-condition clause may reuse its own id for the second record", () => {
  // Kefka, Brinelin and Titans' Vanguard all answered the two-condition clause TWICE under the SAME
  // id rather than taking the next unused one, and the gate called that a duplicate and threw the
  // card away. The prompt asks for a new id, but which id the overflow carries is bookkeeping: both
  // records are true, and canonicalize/derive consume them id-agnostically.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "Whenever Kefka enters or attacks, each player discards a card." },
  ];
  const reused: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "Kefka", control: "you" }, actions: [{ verb: "discard" }] },
    { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "Kefka", control: "you" }, actions: [{ verb: "discard" }] },
  ];
  expect(rejections(validateClauses(segmented, reused))).toEqual([]);
});

test("a repeated id on an ORDINARY clause is still a duplicate", () => {
  // The bound: without multiTrigger, answering the same clause twice is the defect it always was.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", text: "When this creature enters, draw a card." },
  ];
  const twice: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [{ verb: "draw" }] },
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "this", control: "you" }, actions: [{ verb: "draw" }] },
  ];
  expect(kinds(validateClauses(segmented, twice))).toContain("duplicate-id");
});

test("a delayed trigger inside an ACTIVATED ability warns rather than refusing the card", () => {
  // Chandra, the Firebrand's +1 reads "When you next cast an instant or sorcery spell this turn,
  // copy that spell" -- a delayed trigger living inside a loyalty ability. The same shape was
  // already forgiven on SPELL clauses (Eerie Interlude); on an activated clause it was still fatal,
  // and it kept Chandra and Jace, Cunning Castaway out of the corpus on every run.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "activated", cost: "+1", text: "When you next cast an instant or sorcery spell this turn, copy that spell." },
  ];
  const got: ClauseRecord[] = [
    { id: 1, abilityType: "activated", trigger: { event: "cast", subject: "instant or sorcery", control: "you" }, actions: [{ verb: "copy", object: "that spell" }] },
  ];
  expect(rejections(validateClauses(segmented, got))).toEqual([]);
  expect(kinds(validateClauses(segmented, got))).toContain("unexpected-trigger");
});

test("a stray trigger on a STATIC clause is still fatal", () => {
  // The bound: static is where the wildcard-mesh shape lives, and it stays a reject.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "static", text: "Untap this artifact during each other player's untap step." },
  ];
  const got: ClauseRecord[] = [
    { id: 1, abilityType: "static", trigger: { event: "untaps", subject: "this", control: "any" }, actions: [{ verb: "untap", object: "this" }] },
  ];
  expect(kinds(rejections(validateClauses(segmented, got)))).toContain("unexpected-trigger");
});

test("an overflow numbered onto a NEIGHBOURING clause is attributed to its real parent", () => {
  // Brinelin, Wand of Orcus, Lumbering Worldwagon, Threefold Thunderhulk, Titans' Vanguard: the
  // two-condition clause is followed by a printed keyword, and the model numbers its overflow as the
  // next sequential id — which is that keyword's. The gate then saw a trigger on a non-triggered
  // clause AND a duplicate id, and refused the whole card.
  //
  // The prompt has asked for "an id LARGER THAN EVERY id in the list" for two versions now, naming
  // Brinelin and Titans' Vanguard explicitly, and they still do it. WHICH id the overflow carries is
  // bookkeeping the harness can do itself: there is exactly one unconsumed two-condition parent, the
  // record's content is validated against it, and derivation consumes records id-agnostically.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", multiTrigger: true, text: "When Brinelin enters and whenever you cast a spell with mana value 6 or greater, you may return target creature to its owner's hand." },
    { id: 2, kind: "keyword", text: "Partner" },
  ];
  const misnumbered: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "Brinelin", control: "you" }, actions: [{ verb: "return", object: "target creature", toZone: "hand" }] },
    { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Partner" }] },
    { id: 2, abilityType: "triggered", trigger: { event: "cast", subject: "a spell with mana value 6 or greater", control: "you" }, actions: [{ verb: "return", object: "target creature", toZone: "hand" }] },
  ];
  expect(rejections(validateClauses(segmented, misnumbered))).toEqual([]);

  // ...and in the order the model actually used on the re-run: the overflow FIRST, so the record
  // that grabs the slot is the wrong one. Assignment cannot be positional; it has to pick, out of
  // the records claiming an id, the one that FITS the clause, and overflow the rest.
  const overflowFirst: ClauseRecord[] = [misnumbered[0], misnumbered[2], misnumbered[1]];
  expect(rejections(validateClauses(segmented, overflowFirst))).toEqual([]);
});

test("a duplicate id is still a defect when no two-condition clause is owed a record", () => {
  // The repair must not become a licence. With nothing marked twoConditions there is no parent to
  // attribute a second record to, and answering a clause twice is the defect it always was.
  const segmented: Clause[] = [
    { id: 1, kind: "ability", abilityType: "triggered", text: "Whenever this creature attacks, draw a card." },
    { id: 2, kind: "keyword", text: "Flying" },
  ];
  const doubled: ClauseRecord[] = [
    { id: 1, abilityType: "triggered", trigger: { event: "attacks", subject: "this creature", control: "you" }, actions: [{ verb: "draw" }] },
    { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] },
    { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] },
  ];
  expect(kinds(validateClauses(segmented, doubled))).toContain("duplicate-id");
});
