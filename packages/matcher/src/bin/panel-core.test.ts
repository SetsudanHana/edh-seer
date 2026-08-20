import { expect, test } from "vitest";
import { claimKey, mergeVerdicts, scorePanel, type PanelVerdict } from "./panel-core.js";

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
