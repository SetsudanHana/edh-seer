import { expect, test } from "vitest";
import {
  blindRecall, scoreRecall, stratumOf, type RecallJudgment, type SilentPair,
} from "./recall-core.js";
import { seededRng } from "./precision-core.js";

const pair = (over: Partial<SilentPair> = {}): SilentPair => ({
  deck: "d", a: "A", b: "B", flatClaims: false, sharedThemes: [], ...over,
});

test("a pair the FLAT engine claims and derived does not is the LOST stratum", () => {
  // This is where today's gates did their work, so it is where a real loss would hide. It outranks
  // a shared theme: a pair can be both, and the lost-signal question is the one being asked.
  expect(stratumOf(pair({ flatClaims: true }))).toBe("lost");
  expect(stratumOf(pair({ flatClaims: true, sharedThemes: ["cast:creature"] }))).toBe("lost");
});

test("a shared theme with no claim either side is PLAUSIBLE, and everything else is BASE", () => {
  expect(stratumOf(pair({ sharedThemes: ["dies:creature"] }))).toBe("plausible");
  expect(stratumOf(pair())).toBe("base");
});

test("the worksheet carries no stratum, and the key does", () => {
  // Same ordering as the precision instrument: the judge cannot see which stratum a row came from,
  // so the stratum cannot colour the verdict. Without this, knowing a row is "LOST" is a standing
  // invitation to find a synergy in it.
  const rows = blindRecall([pair({ a: "X", flatClaims: true }), pair({ a: "Y" })], seededRng(1));
  for (const r of rows) {
    expect(r).not.toHaveProperty("stratum");
    expect(r).not.toHaveProperty("flatClaims");
    expect(r).not.toHaveProperty("sharedThemes");
  }
  expect(rows.map((r) => r.id).sort()).toEqual([0, 1]);
});

test("recall counts only the misses the engine COULD have expressed", () => {
  // An inexpressible miss is a ceiling, not a defect: no SubjectFilter or verb in the vocabulary can
  // carry "your second spell each turn". Counting it as a defect would make the number unreachable
  // and stop it guiding anything.
  const judgments: RecallJudgment[] = [
    { id: 0, verdict: "miss-expressible", note: "" },
    { id: 1, verdict: "miss-inexpressible", note: "" },
    { id: 2, verdict: "correct-silence", note: "" },
    { id: 3, verdict: "correct-silence", note: "" },
    { id: 4, verdict: "uncertain", note: "" },
  ];
  const s = scoreRecall(judgments);
  expect(s.missExpressible).toBe(1);
  expect(s.missInexpressible).toBe(1);
  expect(s.decided).toBe(4); // uncertain counts against neither
  expect(s.recall).toBeCloseTo(0.75, 5);
});

test("a stratum with nothing decided has no recall rather than a fake 100%", () => {
  const s = scoreRecall([{ id: 0, verdict: "uncertain", note: "" }]);
  expect(s.decided).toBe(0);
  expect(s.recall).toBeNull();
});
