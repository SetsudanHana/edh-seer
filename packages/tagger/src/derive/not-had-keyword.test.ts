import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";

/** "AS THOUGH THEY DIDN'T HAVE <KEYWORD>" IS NOT A GRANT OF IT (#1266, review of the protection rule). Detection Tower's stored clause is a `grant-ability` (Kaya, Bane of the Dead and
 *  Nowhere to Run store `cant`, so they never reached the grant reader). The object names hexproof twice: "creatures ... with hexproof" and "as though they didn't have hexproof". */
const TEXT = "{1}, {T}: Until end of turn, your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof.";
const OBJ = "your opponents and creatures your opponents control with hexproof can be the targets of spells and abilities you control as though they didn't have hexproof until end of turn";
const grants = (object: string, text: string): string[] => deriveAbilities([
  { id: 1, abilityType: "activated", actions: [{ verb: "grant-ability", object, fromZone: null, toZone: null, amount: null, optional: false }] },
], "Detection Tower", { 1: text }, undefined, text).abilities.flatMap((a) => a.grants ?? []);

test("Detection Tower grants no keyword: the sentence names hexproof twice and grants it never", () => {
  expect(grants(OBJ, TEXT)).toEqual([]);
});

test("a real grant beside a 'didn't have' keyword is still read (Colossus of Akros)", () => {
  expect(grants("it has trample and can attack as though it didn't have defender", "It has trample and can attack as though it didn't have defender.")).toEqual(["trample"]);
});
