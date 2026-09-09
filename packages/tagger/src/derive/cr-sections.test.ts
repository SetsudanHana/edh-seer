/** EVERY CR SECTION HAS A VERDICT, OR THE BUILD IS RED. The count test in `cr-completeness.test.ts`
 *  pins how many sections the rules have; this one pins that each has been JUDGED, which is what
 *  the emblem's month of silence lacked (CR 114 had no row). Offline: reads the committed section
 *  list and the committed table. */
import { expect, test } from "vitest";
import { SECTIONS } from "./cr-sections.js";
import crKeywords from "./cr-keywords.json" with { type: "json" };

test("every CR section has a verdict, and every verdict names a real section", () => {
  const rules = crKeywords.sections.map((s) => s.rule);
  const unjudged = rules.filter((r) => !(r in SECTIONS)).map((r) => `${r} ${crKeywords.sections.find((s) => s.rule === r)!.name}`);
  expect(unjudged, "CR sections with no row in cr-sections.ts").toEqual([]);
  const phantom = Object.keys(SECTIONS).filter((r) => !rules.includes(r));
  expect(phantom, "rows for sections the rules no longer have").toEqual([]);
});

test("a verdict is one of four words and carries a note", () => {
  for (const [rule, s] of Object.entries(SECTIONS)) {
    expect(["MODELLED", "PARTIAL", "OPEN", "N/A"], rule).toContain(s.verdict);
    expect(s.note.length, `${rule} has an empty note`).toBeGreaterThan(10);
  }
});

test("the witnesses stay where the evidence put them", () => {
  // 114 is the row whose absence let emblems derive as tokens for a month; 903 IS the format.
  expect(SECTIONS["114"]!.verdict).toBe("MODELLED");
  expect(SECTIONS["903"]!.verdict).not.toBe("N/A");
  expect(SECTIONS["614"]!.verdict).toBe("OPEN");
  // Excluded variants stay excluded on legality, never quietly promoted.
  for (const r of ["901", "902", "904", "905", "311", "314"]) expect(SECTIONS[r]!.verdict, r).toBe("N/A");
});
