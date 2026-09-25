import { expect, test } from "vitest";
import { doublesClassSentence } from "./sentence.js";

/** THE WHOLE-CLASS DOUBLER IS READ, AND SAYS SO (overview persona rounds 2026-09-25, item 10): "Harmonic
 *  Prodigy doubles Inalla, Archmage Ritualist's triggers" ended on the one word the page reads as "the
 *  engine did not read the effect", and every seat asked what that meant. Worded after the printed
 *  card -- "that ability triggers an additional time" -- it no longer ends in "triggers". */
test("a whole-class doubler sentence says what happens and does not end in 'triggers'", () => {
  const text = doublesClassSentence("Harmonic Prodigy", "Inalla, Archmage Ritualist");
  expect(text).toBe("Inalla, Archmage Ritualist's triggered abilities trigger an additional time thanks to Harmonic Prodigy");
  expect(/\btriggers$/.test(text)).toBe(false);
});
