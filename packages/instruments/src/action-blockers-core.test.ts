import { expect, test } from "vitest";
import { attribute, blockers, shapeOf, type Construction } from "./action-blockers-core.js";
import type { ActionReading, ActionRow } from "./action-diff-core.js";

const row = (effect: string, verbs: string[], cards = 1): ActionRow => ({ effect, type: "spell", actions: verbs.map((verb) => ({ verb, object: "" })), cards });
// A toy grammar: reads "draw a card" and "destroy target creature", nothing else.
const toy = (effect: string): ActionReading[] => [
  ...(/^draw a card\.?$/i.test(effect.trim()) ? [{ verb: "draw" }] : []),
  ...(/^destroy target creature\.?$/i.test(effect.trim()) ? [{ verb: "destroy" }] : []),
];
const toyUnread = (effect: string) => (toy(effect).length ? [] : [effect.replace(/\.$/, "")]);
const DURATION: Construction = { name: "duration", test: / until end of turn/i, rewrite: (t) => t.replace(/ until end of turn/i, "") };
const COND: Construction = { name: "condition", test: /^if [^,]+, /i, rewrite: (t) => t.replace(/^if [^,]+, /i, "") };

test("an action is attributed to the construction whose removal ALONE makes it read", () => {
  expect(attribute(row("Draw a card until end of turn.", ["draw"]), 0, toy, [DURATION, COND])).toEqual({ kind: "single", names: ["duration"] });
  // Neither alone, both together.
  expect(attribute(row("If you do, draw a card until end of turn.", ["draw"]), 0, toy, [DURATION, COND])).toEqual({ kind: "combination", names: ["duration", "condition"] });
  expect(attribute(row("Scry 2.", ["scry"]), 0, toy, [DURATION, COND])).toEqual({ kind: "unknown" });
});

test("causes come first: a verb the parser never produces, a verb the text never prints, a count, a phrase", () => {
  const b = blockers([
    row("Draw a card.", ["draw"], 5),                    // read
    row("Destroy target creature.", ["destroy", "draw"], 2), // draw not in the text: the store's
    row("Draw a card, then draw a card.", ["draw"], 3),   // the toy reads neither phrase: phrase
    row("Scry 2.", ["scry"], 4),                          // scry: no grammar
    row("", ["draw"], 9),                                 // no printed text: skipped
  ], toy, toyUnread, [DURATION, COND]);
  expect(b.total).toEqual({ actions: 3, uses: 9 });
  expect(b.causes).toEqual({ "no-grammar": 4, "not-in-text": 2, count: 0, phrase: 3 });
  // The printed-verb domain: the read draw (5) and destroy (2), the phrase (3) and the scry (4); not
  // the draw the text never prints, nor the row with no text.
  expect(b.domain).toEqual({ uses: 14, read: 7 });
  expect(b.shapes.map((s) => [s.shape, s.uses])).toEqual([["draw :: draw a CLASS, then draw a CLASS", 3]]);
});

test("a shape keeps the construction and drops what varies between cards", () => {
  expect(shapeOf('Create a 2/2 black Zombie creature token with "Flying."')).toBe("create a P/T CLASS with QUOTE");
  expect(shapeOf("Put two +1/+1 counters on target Elf you control")).toBe("put N P/T counters on target TYPE you control");
  expect(shapeOf("Add {G}{G}")).toBe("add {M}");
});
