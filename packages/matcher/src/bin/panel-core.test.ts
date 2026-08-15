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
