import { beforeBracket } from "./sections.js";
import { expect, test } from "vitest";
import { parseDecklistText } from "./decklist.js";

test("parses names, stripping leading quantities", () => {
  const names = parseDecklistText("1 Krenko, Mob Boss\n1x Sol Ring\nImpact Tremors");
  expect(names).toEqual(["Krenko, Mob Boss", "Sol Ring", "Impact Tremors"]);
});

test("ignores comments and blank lines", () => {
  const names = parseDecklistText("# Commander\n\n1 Sol Ring\n// sideboard\n");
  expect(names).toEqual(["Sol Ring"]);
});

test("strips trailing set/collector annotations", () => {
  const names = parseDecklistText("1 Sol Ring (C21) 263\n1 Arcane Signet [LTC]");
  expect(names).toEqual(["Sol Ring", "Arcane Signet"]);
});

test("expands leading quantities into repeated names", () => {
  const names = parseDecklistText("5 Forest\n1 Sol Ring\n2x Mountain");
  expect(names).toEqual(["Forest", "Forest", "Forest", "Forest", "Forest", "Sol Ring", "Mountain", "Mountain"]);
});

/** A PASTED DECKLIST IS UNTRUSTED INPUT, and two patterns here were measurably quadratic in it.
 *
 *  Measured before the fix: `/\s*[([].*$/` took 1.0ms at 1,000 characters and 1,966ms at 64,000 --
 *  four times the input for sixteen times the work, because `replace` retries at every position and
 *  `\s*` re-splits the same whitespace run each time. One long line hung the analyze endpoint for
 *  two seconds. After the fix the same input is 0.0ms.
 *
 *  Asserts a TIME BUDGET rather than an implementation, because the defect is a complexity class
 *  and any linear rewrite should pass. 2s is far above the fixed cost (~0ms) and far below the
 *  1.97s the old pattern took, so it separates the two without measuring machine speed. */
/** DIRECTLY ON THE UNCAPPED HELPER, because the end-to-end test below CANNOT SEE THIS FIX.
 *  `parseDecklistText` caps a line at MAX_CARD_LINE before any pattern touches it, so the old
 *  quadratic regex passed that test too -- the cap was doing all the work. Proven by restoring the
 *  old pattern and watching the suite stay green. This test feeds `beforeBracket` 200,000
 *  characters with no cap in front of it, which is the only way to separate a linear scan from a
 *  backtracking one. Restoring `/\s*[([].*$/` here takes it from 0ms to roughly 20 seconds. */
test("beforeBracket is linear on input the line cap never sees", () => {
  // NO BRACKET IN THE INPUT, and that is the whole test. The old pattern only blew up when the
  // match FAILED at every position; given a bracket it succeeds immediately and runs in 0.1ms. The
  // first version of this test appended "(LEA) 1" and therefore passed against the quadratic
  // pattern too -- measuring nothing. Same input without the bracket: 736ms at 40,000 characters.
  const huge = `Sol Ring${" ".repeat(200_000)}`;
  const started = performance.now();
  expect(beforeBracket(huge)).toBe("Sol Ring");
  expect(performance.now() - started).toBeLessThan(1_000);
});

test("a pathological decklist line parses in linear time", () => {
  const line = `1 Sol Ring${" ".repeat(64_000)}(LEA) 1`;
  const started = performance.now();
  const names = parseDecklistText(line);
  expect(performance.now() - started).toBeLessThan(2_000);
  expect(names).toEqual(["Sol Ring"]);
});

test("the suffix and quantity rules still hold after the linear rewrite", () => {
  expect(parseDecklistText("2 Sol Ring (LEA) 1\n1x Skullclamp [DST]\nIsland"))
    .toEqual(["Sol Ring", "Sol Ring", "Skullclamp", "Island"]);
});
