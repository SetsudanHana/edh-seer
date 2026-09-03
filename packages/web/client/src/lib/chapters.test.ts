import { expect, test } from "vitest";
import { CHAPTERS, CHAPTER_FOR_GAUGE } from "./chapters.js";

/** A RAIL WORD IS THE ONLY WORD SOME READERS EVER SEE FOR ITS CHAPTER.
 *
 *  Below `lg` this list is the section select's option text, so the closed control shows one rail
 *  word and nothing else. `READ` sat over a heading reading "Deck at a glance" and `STAND` over
 *  "Scores and bracket", and the phone judge hit it on all four runs -- *"neither is a heading I
 *  passed"*, *"I don't know if that's Standing, Standard or something else"* -- which is why its
 *  confidence on "get me to the mana section" never rose above 60% before tapping.
 *
 *  The rule, and the one a rename has to keep: a rail word is a word out of its own heading.
 *
 *  NOT "shorter than the heading" -- `Roles`/"Roles" has always been both, legitimately. The one
 *  rename that has to stay short is `Fix`: making it `Fixes` was tried while this was written and
 *  the suite's own "each chapter's heading appears exactly once in the scroll" test caught it, the
 *  rail button and the heading both matching. That test owns that rule; this one owns this one. */
test("every rail word appears in the heading it scrolls to", () => {
  for (const chapter of CHAPTERS) {
    expect(
      chapter.title.toLowerCase(),
      `the rail says "${chapter.rail}" and the heading says "${chapter.title}"`,
    ).toContain(chapter.rail.toLowerCase());
  }
});

/** The gauges hand off to chapters, and a typo here is a scroll to nowhere -- `getElementById`
 *  returns null and the reader stays where they were with no error. */
test("every gauge hand-off names a chapter that exists", () => {
  const ids = new Set(CHAPTERS.map((c) => c.id));
  for (const [gauge, chapter] of Object.entries(CHAPTER_FOR_GAUGE)) {
    expect(ids, `${gauge} sends the reader to "${chapter}"`).toContain(chapter);
  }
});
