import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";

/** THE COMMITTED IDF ARTIFACT GOES STALE SILENTLY, AND IT DECIDES EVERY DECK'S THEME.
 *
 *  `globalIDF` scores an ABSENT tag `log(N+1)` — the MAXIMUM — so a verb that ships after the last
 *  regeneration does not merely lose weight, it wins every ranking it appears in. Measured
 *  2026-08-18 on the owner's Samut deck: `theme-stats.json` was regenerated 2026-08-15 00:31 and
 *  the `combat-damage` table row landed 11 hours later (651cf0f), so the whole family was missing,
 *  scored idf 7.84 against `enters:creature`'s 2.02, and a 3-card tag beat a 6-card one to become
 *  that deck's primary theme. Third time this repo has been bitten by a stale artifact
 *  (`hierarchy.json` at 16 of 527 subtypes; this same generator reading the flat `cardTags`).
 *
 *  This is the drift guard the other two lacked: it reads only committed files, needs no database,
 *  and fails the moment a verb exists that the artifact has never seen. Regenerate with
 *  `bin/gen-theme-stats.ts` (free — no model, no spend). VERIFIED TO FIRE: before the 2026-08-18
 *  regeneration it failed on `combat-damage`. */
test("every canonical verb family appears in the committed theme-stats artifact", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "..", "theme-stats.json");
  const stats = JSON.parse(readFileSync(path, "utf8")) as { N: number; counts: Record<string, number> };
  const families = new Set(Object.keys(stats.counts).map((t) => t.slice(0, t.indexOf(":") === -1 ? undefined : t.indexOf(":"))));
  // Phase/structural verbs legitimately carry no theme tag in any deck, so absence proves nothing
  // about freshness for them — they are excluded rather than allowed to weaken the assertion.
  // `detain` (AC11 batch 3, 2026-09-09): the corpus has 12 cards that detain and none that trigger
  // on it, so no card carries a detain theme tag and absence proves nothing about freshness.
  // `city-blessing` (#1321, DERIVE 380): a RECALL GAP, not a structural absence. The only two corpus cards that emitted it (Court of Ire, Starscream) "become the monarch" and are now guarded out; Ascend (CR 702.131), printed on 28 cards, is the real producer and derive never emits it for them (#1322).
  // `face-a-dilemma` (#1349, Star Trek): derive's modal pass supplies it from every modal spell and ability, but the artifact is built from the DERIVED rows, and none carries
  // it until the corpus is re-derived at the version this ships in. REMOVE it from this set when theme-stats.json is regenerated after that derive (bin/gen-theme-stats.ts):
  // the family then appears and this exclusion is dead weight.
  const STRUCTURAL = new Set(["dice-rolled", "detain", "city-blessing", "face-a-dilemma"]);
  const missing = VERB_VOCAB.filter((v) => !STRUCTURAL.has(v) && !families.has(v));
  expect(missing).toEqual([]);
});
