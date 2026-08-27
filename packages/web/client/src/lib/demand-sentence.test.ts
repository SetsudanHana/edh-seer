import { expect, test } from "vitest";
import { eventLabel, tagLabel, STATIC_KIND, MECHANISM, DEMAND_VERB, DEMAND_SUBJECTLESS, DEMAND_PHASE } from "./demand-sentence.js";

/** The graph's trace-event chips label a census key's VERB half. It reuses `DEMAND_VERB` rather
 *  than adding a second vocabulary — this repo has twice shipped an internal identifier rendered as
 *  English (`targetedRemoval`, `enters:type:land`), and both times the humane label already existed
 *  one file over. */
test("an event label is English, never a raw verb token", () => {
  expect(eventLabel("dies")).toBe("Dying");
  expect(eventLabel("enters")).toBe("Entering the battlefield");
});

test("a verb the map has never seen de-slugs rather than printing a token", () => {
  expect(eventLabel("bushido")).toBe("Bushido");
  expect(eventLabel("combat-damage")).not.toContain("-");
});

/** THE MEASURED MECHANISM VOCABULARY — a ratchet over what the engine actually produced.
 *
 *  `BuildBenchmarks.demand.test.ts` walks `DEMAND_VERB`/`DEMAND_PHASE`/`DEMAND_SUBJECTLESS` against
 *  `VERB_VOCAB`, which is authoritative for what a CONSUMER'S TRIGGER can watch. It cannot see this
 *  vocabulary: most of `edges.ts`'s passes write their own literal tag (`ramp-target:`, `creates:`,
 *  `land-condition:` …), and no exported list enumerates them. So the authority here is a
 *  MEASUREMENT — every mechanism that carried at least one reason across the 71 calibration decks on
 *  2026-08-27, with its reason count and deck count recorded beside it so a future reader can tell a
 *  stale entry from a rare one.
 *
 *  This is what stops the next pass shipping "Ramp target" to a reader: adding a literal without a
 *  label leaves this list stale rather than failing, which is the ceiling and is why the counts are
 *  written down — but every mechanism that HAS been seen is now pinned, and the two worst offenders
 *  were in 69 and 70 of 71 decks. */
const MEASURED: ReadonlyArray<[string, number, number]> = [
  // mechanism, reasons, decks
  ["static:cost-reduction", 4326, 59], ["static:pump", 1698, 34], ["ramp-target", 1543, 69],
  ["draw", 1021, 25], ["counter-added", 739, 9], ["creates", 662, 70], ["land-condition", 576, 45],
  ["leaves", 500, 32], ["tutor", 479, 27], ["static:keyword-grant", 425, 22],
  ["enters-graveyard", 381, 8], ["attacks", 306, 14], ["scales", 255, 16], ["doubles", 234, 7],
  ["static:type-grant", 229, 5], ["combat-damage", 228, 13], ["non-combat-damage", 184, 5],
  ["sacrifice", 119, 11], ["proliferate", 112, 1], ["create-token", 102, 6], ["gain-life", 89, 6],
  ["discard", 62, 7], ["static:speed-increase", 61, 5], ["static:untap", 45, 1],
  ["static:token-generation", 44, 1], ["clone", 44, 2], ["lose-life", 32, 5], ["wincon", 11, 2],
  ["untaps", 2, 1], ["taps", 2, 1], ["static:animate", 1, 1],
];

test("every mechanism the engine has actually produced reads as English, not as its own key", () => {
  const raw: string[] = [];
  for (const [mechanism] of MEASURED) {
    // The de-slugify branch is the fallback this map exists to remove, so reaching it IS the failure
    // -- asserting the exact label instead would pin wording nobody has agreed and break on a reword.
    const fallback = mechanism.replace(/-/g, " ");
    const label = eventLabel(mechanism);
    if (label.toLowerCase() === fallback.toLowerCase()) raw.push(mechanism);
  }
  expect(raw).toEqual([]);
});

test("a mechanism is labelled by exactly one map, so precedence never silently picks a winner", () => {
  const maps = { STATIC_KIND, MECHANISM, DEMAND_VERB, DEMAND_SUBJECTLESS, DEMAND_PHASE };
  const twice: string[] = [];
  for (const [mechanism] of MEASURED) {
    const found = Object.entries(maps).filter(([, m]) => mechanism in m).map(([n]) => n);
    if (found.length > 1) twice.push(`${mechanism}: ${found.join(" + ")}`);
  }
  expect(twice).toEqual([]);
});

/** THE CARD INSPECTOR'S TAG CHIPS. It rendered the raw tag inside an uppercasing chip, so a
 *  relationship read "ENTERS:CREATURE  GRAVEYARD-RECURSION:ANY" directly above the sentences that
 *  already said the same thing in words -- the third surface in this repo to ship an internal
 *  identifier as English, and it survived the previous sweep only because it sits in a panel the
 *  persona screenshots had cropped. */
test("a whole reason tag reads as English, keeping the subject that narrows it", () => {
  // The subject is what discriminates: same mechanism, two different claims.
  expect(tagLabel("enters:creature")).toBe("Entering the battlefield · creature");
  expect(tagLabel("enters:land")).toBe("Entering the battlefield · land");
  expect(tagLabel("enters:creature")).not.toBe(tagLabel("enters:land"));
  // `any` narrows nothing, so printing it would add a word and no fact.
  expect(tagLabel("graveyard-recursion:any")).toBe("Bringing cards back from a graveyard");
  // A static tag's second component IS the mechanism, so it has no subject half to append.
  expect(tagLabel("static:pump")).toBe("Boosting power and toughness");
  // And nothing reaches a reader as its own key.
  for (const t of ["enters:creature", "graveyard-recursion:any", "static:pump", "ramp-target:basic"]) {
    expect(tagLabel(t).toLowerCase()).not.toContain(":");
  }
});
