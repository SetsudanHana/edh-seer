import { expect, test } from "vitest";
import { VERB_VOCAB } from "@edh-seer/tagger";
import { PHASE_VERBS } from "./availability.js";
import { VERBS, verbEntry } from "./verbs.js";

/** #1170 PR 2. `tsc` already refuses a `Record<Verb, VerbEntry>` with a verb missing; these walk the
 *  same record at run time against the vocabulary list, so a verb added to `VERB_VOCAB` but not to the
 *  `Verb` type (or the other way) fails here as well. */
test("the record holds exactly the VERB_VOCAB verbs", () => {
  expect(Object.keys(VERBS).sort()).toEqual([...VERB_VOCAB].sort());
});

/** `availability.ts`'s PHASE_VERBS is the authority on what the game, not a card, supplies. */
test("the phase-shaped verbs are exactly PHASE_VERBS", () => {
  const phases = VERB_VOCAB.filter((v) => VERBS[v].shape === "phase");
  expect(phases.sort()).toEqual([...PHASE_VERBS].sort());
});

/** A verb with no action is a choice, not a gap: nothing "deaths" a creature (CR 700.4's dies), and no
 *  card makes a creature attack or block the way it makes one die. */
test("the verbs with no action form are the ones nobody performs, and no others", () => {
  const none = VERB_VOCAB.filter((v) => VERBS[v].shape !== "phase" && VERBS[v].action === undefined && (VERBS[v] as { bare?: { action?: string } }).bare?.action === undefined);
  expect(none.sort()).toEqual(["attacks", "becomes-blocked", "blocks", "combat-damage", "dies", "leaves", "non-combat-damage"]);
});

test("a graveyard leave is a zone event the record names, a future verb is not", () => {
  expect(verbEntry("leaves-graveyard")?.finite).toBe("leaves a graveyard");
  expect(verbEntry("some-future-verb")).toBeUndefined();
  expect(verbEntry("constructor")).toBeUndefined();
});

/** CR 709.5f: you unlock HALF of a permanent; 709.5i: the event the key names is the FULL unlock. */
test("a card that unlocks, unlocks half of a Room", () => {
  expect(VERBS.unlock.action).toBe("unlock half of {object}");
  expect(VERBS.unlock.defaultObject).toBe("a Room");
});
