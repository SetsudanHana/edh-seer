import { expect, test } from "vitest";
import { loadManualEntries, staleWaivers, unwaivedViolations, type ManualEntry } from "./manual-clauses.js";
import { segment } from "./segment.js";
import type { ClauseRecord } from "./canonicalize.js";

const segmentedFor = (e: ManualEntry) => segment(e.oracleText, e.keywords, e.typeLine);

/** THE RATCHET. Free, no database — every entry carries the card's printed inputs, so the whole
 *  check is a file read plus a re-segmentation.
 *
 *  An EMPTY fixture passes vacuously and that is CORRECT here, unlike the browser-bundle list where
 *  empty would have meant "nothing checked". Empty is the goal state: no card needs hand-authoring.
 *  The synthetic tests below are what prove the machinery works when it is not empty. */
test("every manual entry states a reason and carries no unwaived violation", () => {
  for (const e of loadManualEntries()) {
    expect(e.reason.trim(), `${e.name} must say why the pipeline cannot answer it`).not.toBe("");
    expect(unwaivedViolations(e, segmentedFor(e)).map((v) => `${v.kind}: ${v.detail}`), e.name).toEqual([]);
  }
});

test("no manual entry declares a waiver that has stopped firing", () => {
  // Fires in the IMPROVEMENT direction: when the harness learns the shape, the waiver goes quiet
  // and this fails, so the entry is deleted and the win is banked rather than sitting behind a
  // hand-written answer nobody revisits.
  for (const e of loadManualEntries()) {
    expect(staleWaivers(e, segmentedFor(e)), `${e.name}: delete these waivers, the harness handles it now`).toEqual([]);
  }
});

// ── the machinery, proven on synthetic entries because the fixture is (correctly) empty ──

const AANG_TEXT = "Whenever you waterbend, earthbend, or airbend, draw a card.";
const entry = (over: Partial<ManualEntry>): ManualEntry => ({
  oracleId: "test", name: "Test Card", reason: "a reason", waivers: [],
  oracleText: AANG_TEXT, typeLine: "Legendary Creature — Avatar", keywords: [],
  clauses: [], ...over,
});

const rec = (id: number, event: string): ClauseRecord =>
  ({ id, abilityType: "triggered", trigger: { event }, actions: [{ verb: "draw" }] }) as ClauseRecord;

test("an entry answering one clause several times is refused unless it waives duplicate-id", () => {
  // The shape manual entries exist for: a trigger head naming more events than the schema holds.
  const four = [rec(1, "waterbend"), rec(1, "earthbend"), rec(1, "airbend")];
  const bare = entry({ clauses: four });
  expect(unwaivedViolations(bare, segmentedFor(bare)).map((v) => v.kind)).toContain("duplicate-id");

  const waived = entry({ clauses: four, waivers: ["duplicate-id"] });
  expect(unwaivedViolations(waived, segmentedFor(waived))).toEqual([]);
});

test("a waiver does NOT excuse the violations it did not name", () => {
  // The bound, and the whole reason this is not a back door: waiving the id shape must not let a
  // bad verb through. `sacrifice-everything` is not in VERBS.
  const bad = entry({
    clauses: [{ id: 1, abilityType: "triggered", trigger: { event: "waterbend" },
                actions: [{ verb: "sacrifice-everything" }] } as ClauseRecord],
    waivers: ["duplicate-id"],
  });
  expect(unwaivedViolations(bad, segmentedFor(bad)).map((v) => v.kind)).toContain("unknown-verb");
});

test("a waiver that does not fire is reported as stale", () => {
  // A clean entry declaring a waiver it does not need. This is what the ratchet catches the day the
  // harness improves.
  const clean = entry({ clauses: [rec(1, "waterbend")], waivers: ["duplicate-id"] });
  expect(unwaivedViolations(clean, segmentedFor(clean))).toEqual([]);
  expect(staleWaivers(clean, segmentedFor(clean))).toEqual(["duplicate-id"]);
});

test("a needed waiver is not reported as stale", () => {
  const needed = entry({ clauses: [rec(1, "waterbend"), rec(1, "earthbend")], waivers: ["duplicate-id"] });
  expect(staleWaivers(needed, segmentedFor(needed))).toEqual([]);
});
