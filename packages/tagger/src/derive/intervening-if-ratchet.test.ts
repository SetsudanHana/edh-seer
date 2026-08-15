import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { conditionFamily, interveningIfOf } from "./intervening-if.js";

/** Trigger clauses whose printed intervening if (CR 603.4) NOTHING in the derived doc represents,
 *  as a fixed list captured from the clause corpus by `bin/intervening-if-audit.ts --fixture`.
 *
 *  Two arms, and they are NOT equivalent — the same asymmetry `repeats-ratchet.test.ts` documents:
 *
 *   - `UNREPRESENTED_CAP` bounds the CHECKED-IN fixture's row count. It says nothing about the live
 *     corpus until someone regenerates the fixture; regenerate after any change to derivation or to
 *     `interveningIfOf` and the number moves.
 *   - "every fixture row is still detected" is LIVE on every run: it calls `interveningIfOf` fresh
 *     against each row's printed text, so a predicate edit that silently stops seeing a condition
 *     fails here rather than making the census quietly shrink. Under-detection is the failure mode
 *     that would make this instrument lie, so it is the arm that runs for free.
 *
 *  The direction a fix moves the count is DOWN: give derivation a way to represent a condition and
 *  the audit stops listing it. Lower the cap when that happens; raise it only with a written reason.
 *
 *    npx tsx --env-file=packages/tagger/.env packages/tagger/src/bin/intervening-if-audit.ts \
 *      --fixture packages/tagger/src/derive/intervening-if-unrepresented.json */
const FIXTURE = new URL("intervening-if-unrepresented.json", import.meta.url);

/** 110 of the 130 intervening-if trigger clauses in the 2,651-card clause corpus, measured
 *  2026-08-15. The other 20 have a `trigger.threshold` on an ability whose verb matches, which is
 *  the numeric `{atLeast}` subset and the only channel that exists today.
 *
 *  Raise ONLY with a written reason. */
const UNREPRESENTED_CAP = 110;

interface Row { name: string; condition: string; family: string; text: string }
const rows = JSON.parse(readFileSync(FIXTURE, "utf8")) as Row[];

test("the set of dropped conditions has not grown", () => {
  expect(rows.length).toBeLessThanOrEqual(UNREPRESENTED_CAP);
});

test("every fixture row is still DETECTED — under-detection would make the census lie", () => {
  const missed = rows.filter((r) => interveningIfOf(r.text) === null)
    .map((r) => `${r.name}: "${r.condition}"`);
  expect(missed, "interveningIfOf stopped seeing a condition it used to see").toEqual([]);
});

test("and still classified into the same family", () => {
  const moved = rows.filter((r) => conditionFamily(r.condition) !== r.family)
    .map((r) => `${r.name}: ${r.family} -> ${conditionFamily(r.condition)}`);
  expect(moved, "a family rule changed; regenerate the fixture and re-read the counts").toEqual([]);
});

test("a trigger's condition is read; a rider inside an effect is not", () => {
  // Yuna, Grand Summoner — the witness. Her trigger derives as a bare sacrifice watcher, so three
  // Saga producers feed it correctly only because a Saga always has lore counters when it dies.
  expect(interveningIfOf("Whenever another permanent you control is put into a graveyard from the "
    + "battlefield, if it had one or more counters on it, you may put that number of +1/+1 counters "
    + "on target creature.")).toBe("it had one or more counters on it");
  // "If you do" is the follow-up to an optional cost, inside the effect — not a condition on the event.
  expect(interveningIfOf("Whenever this creature attacks, you may sacrifice a creature. If you do, "
    + "draw a card.")).toBeNull();
  // Not a trigger sentence at all.
  expect(interveningIfOf("Creatures you control get +1/+1 if you control an artifact.")).toBeNull();
  // A replacement effect's "if ... would" belongs to replacement.ts, not here.
  expect(interveningIfOf("Whenever a creature dies, if it would be put into a graveyard, exile it "
    + "instead.")).toBeNull();
});
