import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

/** WHERE THE COUNTERS GO (overview persona rounds 2026-09-25, item 8: The Earth Crystal, which doubles
 *  +1/+1 counters on a CREATURE you control, was fed by The Ozolith -- an artifact -- and by Mog's
 *  chapter IV). Real clause shapes from `cardClauses`, 2026-09-26: the object is the COUNTER, and the
 *  recipient is only in the sentence. */
test("counters put on the card by its own name are counters on itself", () => {
  const t = "Whenever a creature you control leaves the battlefield, if it had counters on it, put those counters on The Ozolith.";
  const oz = deriveAbilities([{ id: 1, abilityType: "triggered", trigger: { event: "leaves", subject: "a creature you control", control: "you" },
    actions: [{ verb: "add-counter", object: "those counters" }] }], "The Ozolith", { 1: t }, undefined, t).abilities;
  expect(oz[0]!.emits?.map((e) => e.subject.self)).toEqual([true]);
});

test("counters put on each other <type> you control carry that recipient", () => {
  const t = "Put two +1/+1 counters on each other Moogle you control.";
  const mog = deriveAbilities([{ id: 4, abilityType: "triggered", trigger: { event: "chapter", subject: "IV", control: "you" },
    actions: [{ verb: "add-counter", object: "+1/+1", amount: "2" }] }], "Summon: Good King Mog XII", { 4: t }, undefined, t).abilities;
  expect(mog[0]!.emits?.map((e) => [e.subject.subtype, e.subject.control, e.subject.counter])).toEqual([["moogle", "you", "+1/+1"]]);
});
