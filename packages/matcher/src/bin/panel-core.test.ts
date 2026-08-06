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
