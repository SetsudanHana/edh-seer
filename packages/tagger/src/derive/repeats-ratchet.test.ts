import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import type { Ability } from "../schema.js";
import { repeatsFor } from "./repeats.js";

/** Abilities the rules cannot name, as a FIXED list captured from the corpus. Both directions are
 *  load-bearing, exactly as `KNOWN_DEFECT_CAP` and `derive-compass` are:
 *
 *   - the count may not GROW, so a new gap cannot be waved through;
 *   - a quarantined ability that starts resolving FAILS, so an improvement has to be banked here
 *     rather than silently absorbed.
 *
 *  A ratchet nobody has tested is decoration. Both arms were verified by hand on 2026-08-11, then
 *  reverted; see the task-3 report for the full transcript:
 *   1. `REFUSED_CAP` dropped to 594 -> "the refused set has not grown" FAILED:
 *      "AssertionError: expected 595 to be less than or equal to 594".
 *   2. A throwaway rule added to `repeats.ts`'s trigger branch ("if (verbs.includes("gain-life"))
 *      return "once";") resolved 8 fixture rows -> "a refused ability that now resolves must be
 *      banked, not silently absorbed" FAILED, naming them: Wall of Limbs, Exemplar of Light, Vito
 *      Thorn of the Dusk Rose, Marauding Blight-Priest, Starscape Cleric, Heliod Sun-Crowned, and
 *      Ratchet Field Medic // Ratchet Rescue Racer (twice, one per face).
 *
 *  THE TWO ARMS ARE NOT EQUIVALENT (2026-08-11 review, finding 2). Arm 2 ("a refused ability that
 *  now resolves...") is LIVE on every run -- it calls `repeatsFor` fresh against the checked-in
 *  fixture, so any rule change that newly resolves one of these 579 rows fails immediately. Arm 1
 *  ("the refused set has not grown") only bounds the CHECKED-IN FIXTURE'S row count; it says nothing
 *  about the live corpus until a human regenerates `repeats-refused.json` and re-derives, unlike
 *  `KNOWN_DEFECT_CAP`, which is checked against a live count every run. A code change that makes
 *  MORE abilities refuse today will not fail this test -- it will only show up once someone reruns:
 *
 *    npx tsx --env-file=packages/tagger/.env packages/tagger/src/bin/repeats-report.ts --refused packages/tagger/src/derive/repeats-refused.json
 *
 *  and notices the row count moved past REFUSED_CAP. Also note: every row in this fixture carries
 *  `cost: ""` structurally -- rules 1-2 (`repeats.ts`) run against `cost` BEFORE the trigger branch,
 *  so any ability with a real, non-empty cost resolves via rule 1 or 2 and can never reach refusal.
 *  The ratchet reads `cost` correctly; this fixture simply cannot exercise that arm. */
const FIXTURE = new URL("repeats-refused.json", import.meta.url);

/** Raise ONLY with a written reason. Lower it whenever a rule is added.
 *
 *  Dropped 595 -> 579 (task 4, 2026-08-11): `ORDINAL_EACH_TURN` in `repeats.ts` resolved 16 refused
 *  abilities, including Faerie Mastermind's own trigger -- the card the taxonomy was built around
 *  was itself in the refused set until this rule existed. Verified: population 27380/35037/231 and
 *  panel 82.8% both held after the fix, because nothing reads `repeats` yet.
 *
 *  Raised 579 -> 621 (finding 3, 2026-08-11 review): `attacks` was pulled out of `PHASE_VERBS` and
 *  is now phase-shaped only when `subject.self === true` (`repeats.ts`). The 202 `attacks:you`
 *  abilities that were wrongly resolving to `per-cycle` for a CLASS subject ("whenever a creature
 *  you control attacks") mostly re-resolve to `repeatable` via rule 9, but some carry no type/
 *  subtype at all and correctly fall all the way through to refusal -- that is the source of the
 *  +42 rows. This is a CORRECTNESS fix, not a new gap: a confidently wrong label is worse than an
 *  honest refusal. Verified after re-deriving: population 27380/35037/231 and panel 82.8% both held,
 *  because nothing reads `repeats` yet. */
/** Re-banked 621 -> 1413 (2026-09-05, owner: "fix the repeats labeller so Black Market Connections
 *  counts as engine"). TWO THINGS MOVED AT ONCE and the number only makes sense read as both:
 *  the fixture had never been regenerated since it was captured on the 2,541-card calibration
 *  corpus, and the corpus is 21,317 cards now, so the row count was never comparable to the live
 *  refusal count (3,118 refused of 37,912 abilities, 8.2%, on the morning of the change). Then the
 *  rules widened -- `RawTrigger` lets a step outside the `Verb` union (main-phase, draw-step) and a
 *  saga chapter resolve, rule 9 reads an untyped non-self trigger as a class, rule 8b reads the
 *  card's own or an untyped combat trigger as once per combat, and `sacrifice`/`enters-graveyard`/
 *  `cast` joined SELF_EVENTS -- and refusal fell to 1,413 (3.7%). 454 of the old 621 rows resolve.
 *  Verified: population 35655/45598/289 and panel 429 / 387 / 16 both held, because a label still
 *  changes what nothing matches; the draw facet moved 400 -> 445 engines, 107 -> 41 unlabelled. */
const REFUSED_CAP = 1413;

/** `repeatsFor` takes THREE arguments -- `cost` feeds rules 1-2 (self-sacrifice, {T}/{Q}),
 *  `clauseText` feeds rule 3 ("once each turn"). A fixture row missing `cost` would half-disable the
 *  second arm: a refusal later resolved by a cost rule would never be detected. */
type Row = { name: string; clauseText: string; cost: string; ability: Ability };

test("the refused set has not grown", () => {
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as Row[];
  expect(rows.length).toBeLessThanOrEqual(REFUSED_CAP);
});

test("a refused ability that now resolves must be banked, not silently absorbed", () => {
  const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as Row[];
  const resolved = rows.filter((r) => repeatsFor(r.ability, r.clauseText, r.cost) !== undefined);
  expect(
    resolved.map((r) => r.name),
    "these now resolve -- remove them from repeats-refused.json and lower REFUSED_CAP",
  ).toEqual([]);
});
