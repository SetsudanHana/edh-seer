import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

/** EVERY VERTICAL STICKY IN THE APP CLEARS THE SITE HEADER.
 *
 *  A sticky `top` is a VIEWPORT-absolute offset, so it has to name every bar pinned above it. The
 *  site header went sticky on 2026-09-04, which put a new bar above four things that were already
 *  pinned -- the report summary, the chapter rail, the cards table's own head, and the card and
 *  commander pages' asides -- and any one of them left un-rebased pins BEHIND it instead of under
 *  it, silently, at the width where it matters.
 *
 *  THE TEST IS OVER THE SOURCE rather than over a render, because the defect is a missing term in a
 *  class string and the next instance of it will be in a component this file has never heard of.
 *  `seo.test.ts` reads files for the same reason. jsdom cannot measure a sticky offset anyway, which
 *  is why `components.test.tsx` asserts the class too -- this one asserts the RULE.
 *
 *  Horizontal stickies are exempt by inspection: `sticky left-0` pins a row header sideways inside a
 *  table and has no vertical offset to get wrong. */
const SRC = join(import.meta.dirname, "components");

/** `top-[...]`, `sm:top-[...]`, `lg:top-6` — any Tailwind vertical-offset utility, with its prefix. */
const TOP_UTILITY = /(?:^|\s)((?:[a-z]+:)*top-(?:\[[^\]]*\]|[\w.]+))/g;

const sources = readdirSync(SRC)
  .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
  .map((f) => ({ file: f, text: readFileSync(join(SRC, f), "utf8") }));

test("the source files this rule scans are actually there", () => {
  // A glob that quietly matches nothing is a test that quietly passes.
  expect(sources.length).toBeGreaterThan(30);
  expect(sources.some((s) => s.file === "ChapterRail.tsx")).toBe(true);
});

test("every vertically-pinned element offsets by --site-header-h", () => {
  const offenders: string[] = [];
  for (const { file, text } of sources) {
    // One className at a time, so a `top-` in an unrelated attribute cannot answer for a `sticky`.
    for (const [, cls] of text.matchAll(/className=[{`"]([^"`]*)[`"}]/g)) {
      if (!/(?:^|\s)(?:[a-z]+:)*sticky(?:\s|$)/.test(cls)) continue;
      for (const [, util] of cls.matchAll(TOP_UTILITY)) {
        if (util.includes("--site-header-h")) continue;
        offenders.push(`${file}: ${util}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
