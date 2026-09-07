import { expect, test } from "vitest";
import { claimKey, mergeVerdicts, ratchetLostPairs, scorePanel, type PanelVerdict } from "./panel-core.js";

const v = (p: string, c: string, t: string, verdict: PanelVerdict["verdict"]): PanelVerdict =>
  ({ producer: p, consumer: c, tag: t, verdict, cause: "", note: "" });

test("a claim's identity is the pair AND the tag, and it is directed", () => {
  // The panel is a fixed set of PAIRS, but a verdict belongs to one CLAIM. Defiler of Dreams' two
  // claims against the same consumer were judged opposite ways in the 2026-08-05 pass -- its
  // cost-reduction generic, its draw real -- so keying on the pair alone would collapse them.
  expect(claimKey("A", "B", "draw:any")).toBe("A|B|draw:any");
  expect(claimKey("A", "B", "draw:any")).not.toBe(claimKey("B", "A", "draw:any"));
});

test("verdicts accumulate across versions and later ones win", () => {
  // The cache is append-only across engine versions: a claim judged once keeps its verdict when the
  // engine changes, which is the whole point -- only NEW claims cost judging.
  const merged = mergeVerdicts(
    [v("A", "B", "t", "real"), v("C", "D", "t", "false")],
    [v("A", "B", "t", "false")],
  );
  expect(merged).toHaveLength(2);
  expect(merged.find((m) => m.producer === "A")?.verdict).toBe("false");
});

test("scoring reports precision AND the judging debt", () => {
  // The debt is what makes the panel honest: a change that ADDS claims cannot silently inflate
  // precision, because the new claims are unjudged and counted as owed rather than as real.
  const cache = [v("A", "B", "t1", "real"), v("A", "B", "t2", "false"), v("C", "D", "t1", "real")];
  const current = [
    { producer: "A", consumer: "B", tag: "t1" },
    { producer: "A", consumer: "B", tag: "t2" },
    { producer: "A", consumer: "B", tag: "t3" },
  ];
  const s = scorePanel(current, cache);
  expect(s.real).toBe(1);
  expect(s.false).toBe(1);
  expect(s.unjudged).toHaveLength(1);
  expect(s.unjudged[0].tag).toBe("t3");
  expect(s.precision).toBeCloseTo(0.5);
  // C/D is in the cache but the engine no longer claims it: dropped, not counted, not lost.
  expect(s.dropped).toBe(1);
});

test("uncertain is excluded from precision, as in the sampling instrument", () => {
  const s = scorePanel(
    [{ producer: "A", consumer: "B", tag: "t" }, { producer: "C", consumer: "D", tag: "t" }],
    [v("A", "B", "t", "real"), v("C", "D", "t", "uncertain")],
  );
  expect(s.real).toBe(1);
  expect(s.uncertain).toBe(1);
  expect(s.precision).toBe(1);
});

// A CLAIM'S IDENTITY IS NOT `producer|consumer|tag`. The same triple can be asserted through an
// authored ability one day and through the producer's own entry the next, and a verdict made against
// the first then silently scores the second. Measured: Goldspan Dragon -> Terror of the Peaks was
// cached `real` for the right reason, the 2026-08-07 re-judge overturned it to `false` reading
// Goldspan's TREASURE ability, and round 3 drew that stale `false` against a claim asserting
// Goldspan's own ENTRY — 2 of the 11 disagreements that kept precision withdrawn.
test("a verdict made against a different mechanism is owed again, not scored", () => {
  const claim = { producer: "Goldspan Dragon", consumer: "Terror of the Peaks", tag: "enters:creature" };
  const verdict = { ...claim, verdict: "false" as const, cause: "", note: "judged the treasure ability" };

  // Recorded against the AUTHORED mechanism, now asserted as the card's own entry: unjudged.
  const mismatch = scorePanel([{ ...claim, implied: true }], [{ ...verdict, implied: false }]);
  expect(mismatch.unjudged).toHaveLength(1);
  expect(mismatch.false).toBe(0);

  // Same mechanism on both sides: scored as before.
  const agree = scorePanel([{ ...claim, implied: true }], [{ ...verdict, implied: true }]);
  expect(agree.false).toBe(1);
  expect(agree.unjudged).toHaveLength(0);

  // BACKWARD COMPATIBLE: a verdict that never recorded a mechanism — which is every row written
  // before 2026-08-15 — scores exactly as it always did, rather than invalidating 1,661 of them.
  const legacy = scorePanel([{ ...claim, implied: true }], [verdict]);
  expect(legacy.false).toBe(1);
  expect(legacy.unjudged).toHaveLength(0);
});

// THE AUTHORITY ORDER, and why it had to be encoded rather than left to row order (2026-08-20).
// The cache is append-ordered and a rebuild replays sources alphabetically, so the two disagreed on
// 8 claims and read 92.0% against 93.8% — the panel's headline moving with nothing but file order.
// Of 64 claims whose duplicate rows disagree, 44 are the owner overriding an earlier Claude verdict.
const row = (over: Partial<PanelVerdict> & { producer: string }): PanelVerdict => ({
  consumer: "C", tag: "enters:creature", verdict: "real", cause: "", note: "", ...over,
});
const owner = (over: Partial<PanelVerdict> & { producer: string }): PanelVerdict =>
  row({ note: "USER VERDICT (draw). ", ...over });

test("a user verdict is never overwritten by a Claude one, in either merge order", () => {
  const claude = row({ producer: "P", verdict: "real" });
  const user = owner({ producer: "P", verdict: "false" });
  expect(mergeVerdicts([claude], [user])[0].verdict).toBe("false");
  // ...and the same the other way round, which is the case row order used to decide.
  expect(mergeVerdicts([user], [claude])[0].verdict).toBe("false");
  // Two Claude verdicts still resolve by order: later wins, the original rule.
  expect(mergeVerdicts([claude], [row({ producer: "P", verdict: "uncertain" })])[0].verdict).toBe("uncertain");
});

test("verdicts about different MECHANISMS both survive a merge", () => {
  // `implied` marks a producer supplying the event by BEING itself rather than through an ability.
  // Collapsing the two cost two judged claims the first time this dedupe was attempted.
  const authored = owner({ producer: "P", verdict: "false", implied: false });
  const byBeing = row({ producer: "P", verdict: "real", implied: true });
  expect(mergeVerdicts([authored], [byBeing])).toHaveLength(2);
});

test("scoring reads the verdict for the mechanism the engine asserts, not whichever row is last", () => {
  const cache = [
    row({ producer: "P", verdict: "false", implied: false }),
    row({ producer: "P", verdict: "real", implied: true }),
  ];
  const claim = (implied: boolean) => [{ producer: "P", consumer: "C", tag: "enters:creature", implied }];
  expect(scorePanel(claim(true), cache).real).toBe(1);
  expect(scorePanel(claim(false), cache).false).toBe(1);
  // Reversing the rows must change nothing — the fault this replaces.
  expect(scorePanel(claim(true), [...cache].reverse()).real).toBe(1);
  // A row with no `implied` is the wildcard, and answers either mechanism.
  expect(scorePanel(claim(true), [row({ producer: "P", verdict: "uncertain" })]).uncertain).toBe(1);
  // But an EXACT mechanism row beats the wildcard when both exist — otherwise a stale general
  // verdict silently outranks one made against the mechanism the engine actually asserts.
  const both = [row({ producer: "P", verdict: "uncertain" }), row({ producer: "P", verdict: "real", implied: true })];
  expect(scorePanel(claim(true), both).real).toBe(1);
  expect(scorePanel(claim(true), [...both].reverse()).real).toBe(1);
});

// `dropped` WAS ONE NUMBER FOR FOUR DIFFERENT EVENTS, and it read as attrition (2026-09-07).
// Measured on the live panel: 704 cached verdicts the engine no longer claimed, 147 of them judged
// REAL. Splitting them by hand found 89 RETAGS (the pair still joins, the tag was renamed --
// `cast:artifact` -> `cast:spell`, `enters:any` -> `enters:permanent`), 8 ROT (the named card no
// longer resolves into that deck, because the RESOLVER was fixed: a decklist line "Rampant Growth"
// used to resolve to the split card `Studious First-Year // Rampant Growth`) and 50 genuine
// regressions. One number that mixes "we renamed a tag" with "we lost a true edge" cannot be acted
// on in either direction.
test("dropped separates a retag from a lost pair", () => {
  const cache = [v("A", "B", "cast:artifact", "real"), v("C", "D", "t", "real")];
  // A -> B still joins, under a new tag; C -> D is gone entirely.
  const s = scorePanel([{ producer: "A", consumer: "B", tag: "cast:spell" }], cache);
  expect(s.dropped).toBe(2);
  expect(s.droppedRetag).toBe(1);
  expect(s.droppedLost).toBe(1);
  // The retag is not a loss, so it must not cost recall.
  expect(s.recallHeld).toBe(1);
  expect(s.recallLost).toBe(1);
  expect(s.recall).toBeCloseTo(0.5);
});

// RECALL IS PAIR-LEVEL, because the panel's unit is the pair: "a change that alters which claims a
// pair produces does not invalidate the panel". A pair with three REAL claims that keeps one is a
// held pair, not two thirds of a loss.
test("recall counts pairs with a REAL verdict, not claims", () => {
  const cache = [
    v("A", "B", "t1", "real"), v("A", "B", "t2", "real"), v("A", "B", "t3", "real"),
    v("C", "D", "t1", "false"), // never real, so it is not a recall opportunity either way
  ];
  const s = scorePanel([{ producer: "A", consumer: "B", tag: "t1" }], cache);
  expect(s.recallHeld).toBe(1);
  expect(s.recallLost).toBe(0);
  expect(s.recall).toBe(1);
});

// ROT IS NOT A REGRESSION, AND ONLY THE CALLER CAN TELL. `panel-core` never sees a decklist, so the
// pair-in-deck test is injected. Absent, every lost pair counts as a regression -- the conservative
// direction, since it can only over-report loss.
test("a pair whose card left the deck is rot, and is excluded from recall", () => {
  const cache = [v("Studious First-Year // Rampant Growth", "Guardian Project", "enters:creature", "real")];
  const blind = scorePanel([], cache);
  expect(blind.droppedRot).toBe(0);
  expect(blind.droppedRegression).toBe(1);
  expect(blind.recall).toBe(0);

  const seeing = scorePanel([], cache, () => false);
  expect(seeing.droppedRot).toBe(1);
  expect(seeing.droppedRegression).toBe(0);
  // Nothing real is left to hold OR lose, so recall is undefined rather than 0 -- a rotted verdict
  // must not be able to drag the figure down.
  expect(seeing.recallLost).toBe(0);
  expect(seeing.recall).toBeNull();
});

// A DROPPED **FALSE** CLAIM IS A WIN AND MUST NOT SIT IN THE LOSS BUCKETS. First cut of this split
// put all 704 through the retag/rot/regression funnel and reported "548 regression", of which 528
// were claims the engine had correctly STOPPED making. The bucket names have to mean what they say.
test("a dropped claim that was judged false counts as a gate working, not a loss", () => {
  const s = scorePanel([], [v("A", "B", "t", "false"), v("C", "D", "t", "real")]);
  expect(s.dropped).toBe(2);
  expect(s.droppedFalse).toBe(1);
  expect(s.droppedRegression).toBe(1);
  // ...and a false claim is not a recall opportunity either.
  expect(s.recallHeld + s.recallLost).toBe(1);
});

// A PAIR CAN STOP JOINING DIRECTLY AND STILL BE CLAIMED (2026-09-07, roadmap Z1). Reproduced from
// `Oath of Liliana -> Ayara, First of Locthwain`, one of the six owner-judged "regressions":
// Ayara triggers on a black creature entering, Oath is a Legendary ENCHANTMENT so it never enters
// as one, and the relation belongs to the 2/2 Zombie it makes. The engine models that as
// `Oath -> Zombie [token] -> Ayara` -- two hops, same claim. Aphemia in the same deck keeps a
// DIRECT edge only because it is itself a creature, so casting it triggers Ayara by entering.
// Counting that as a lost edge sends someone to fix an engine that is right.
test("a claim re-attributed to a token the producer makes is not a loss", () => {
  const cache = [v("Oath of Liliana", "Ayara", "enters:creature", "real")];
  const reattributed = (p: string, c: string, t: string) =>
    p === "Oath of Liliana" && c === "Ayara" && t === "enters:creature";

  const blind = scorePanel([], cache);
  expect(blind.droppedRegression).toBe(1);
  expect(blind.recall).toBe(0);

  const seeing = scorePanel([], cache, undefined, reattributed);
  expect(seeing.droppedReattributed).toBe(1);
  expect(seeing.droppedRegression).toBe(0);
  // RECALL COUNTS IT AS HELD: the engine still says these two cards work together, so a measure of
  // "did we keep the true edges" must not punish the model for saying it more precisely.
  expect(seeing.recallHeld).toBe(1);
  expect(seeing.recallLost).toBe(0);
  expect(seeing.recall).toBe(1);
});

// A PERCENTAGE FLOOR LETS ONE LOSS HIDE BEHIND ONE GAIN. The panel's guard is a NAMED set, the
// same shape `derive-compass.test.ts` uses (`expect(regressions).toEqual([])`) and for the same
// reason this repo already writes down as "compare by NAME, not by count".
test("the lost set is reported by name, and it is the pairs recall counted as lost", () => {
  const cache = [
    v("A", "B", "t", "real"),        // still joined -> held
    v("C", "D", "t", "real"),        // gone         -> lost, by name
    v("E", "F", "t", "false"),       // never real   -> not a recall opportunity
  ];
  const s = scorePanel([{ producer: "A", consumer: "B", tag: "t" }], cache);
  expect(s.lostPairs).toEqual(["C|D"]);
  expect(s.lostPairs).toHaveLength(s.recallLost);
});

// BOTH DIRECTIONS, because a ratchet nobody has watched fail is decoration. A pair that starts
// joining again must FAIL too, so the gain is banked rather than quietly spent later.
test("the ratchet names what arrived and what recovered, in both directions", () => {
  expect(ratchetLostPairs(["A|B", "C|D"], ["A|B", "C|D"])).toEqual({ added: [], recovered: [] });
  // A loss nothing has accepted yet.
  expect(ratchetLostPairs(["A|B", "C|D", "E|F"], ["A|B", "C|D"]))
    .toEqual({ added: ["E|F"], recovered: [] });
  // An improvement the list has not been updated for.
  expect(ratchetLostPairs(["A|B"], ["A|B", "C|D"]))
    .toEqual({ added: [], recovered: ["C|D"] });
  // Sorted, so a re-run diffs cleanly rather than by hash order.
  expect(ratchetLostPairs(["Z|Y", "A|B"], []).added).toEqual(["A|B", "Z|Y"]);
});

// A PAIR IS NOT "HELD" BY A CLAIM THE PANEL DOES NOT BELIEVE. The first cut counted a pair as held
// if the engine made ANY live claim on it, whatever that claim was judged. Measured on the real
// panel: 5 pairs were held only by an UNCERTAIN claim — the REAL edge was gone and an unsure one
// was standing in for it (Kinbinding|Purphoros, Braids|Chainer, Vat of Rebirth|Accursed Marauder,
// Prismari Command|Vivi's Persistence, Tablet of Discovery|Vivi's Persistence).
test("a pair held only by an uncertain or false claim is lost, not held", () => {
  const cache = [
    v("A", "B", "t1", "real"),        // the real edge...
    v("A", "B", "t2", "uncertain"),   // ...replaced by an unsure one
    v("C", "D", "t1", "real"),
    v("C", "D", "t2", "false"),
  ];
  const s = scorePanel([
    { producer: "A", consumer: "B", tag: "t2" },
    { producer: "C", consumer: "D", tag: "t2" },
  ], cache);
  expect(s.recallHeld).toBe(0);
  expect(s.lostPairs).toEqual(["A|B", "C|D"]);
});

// An UNJUDGED live claim still holds the pair: that is judging debt, which the headline already
// reports separately, and calling it a loss would double-count the same gap.
test("a pair held by an unjudged claim is held, because debt is reported on its own line", () => {
  const s = scorePanel([{ producer: "A", consumer: "B", tag: "new" }], [v("A", "B", "old", "real")]);
  expect(s.recallHeld).toBe(1);
});

// RETAG MUST STAY IN THE SAME FAMILY. `cast:artifact` -> `cast:spell` is a rename; `static:pump` ->
// `enters:creature` is a DIFFERENT RELATION wearing the same pair. 15 of the 89 "retags" crossed
// families on the real panel.
test("a tag change across families is not a retag", () => {
  const cache = [v("A", "B", "cast:artifact", "real"), v("C", "D", "static:pump", "real")];
  const s = scorePanel([
    { producer: "A", consumer: "B", tag: "cast:spell" },       // same family: a retag
    { producer: "C", consumer: "D", tag: "enters:creature" },  // different family: not a retag
  ], cache);
  expect(s.droppedRetag).toBe(1);
  expect(s.droppedRegression).toBe(1);
});

// The bucket counts claims the engine stopped making because they were WRONG. Uncertain is not
// wrong, and folding it in overstated the win by 29 on the real panel.
test("uncertain is counted apart from false", () => {
  const s = scorePanel([], [v("A", "B", "t", "false"), v("C", "D", "t", "uncertain")]);
  expect(s.droppedFalse).toBe(1);
  expect(s.droppedUncertain).toBe(1);
});
