import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 *      Ratchet Field Medic // Ratchet Rescue Racer (twice, one per face). */
const FIXTURE = join(__dirname, "repeats-refused.json");

/** Raise ONLY with a written reason. Lower it whenever a rule is added. */
const REFUSED_CAP = 595;

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
