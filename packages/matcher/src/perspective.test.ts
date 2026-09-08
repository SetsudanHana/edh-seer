import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { flipPerspective } from "./perspective.js";

/** CR 114.2: the player who gets the emblem controls it. An emblem's own text is written from its
 *  controller's seat ("deals 3 damage to you"), so a node an OPPONENT controls is read from our
 *  seat by swapping the two: the opponent's emblem deals damage to the opponent, from a source the
 *  opponent controls. `any` is nobody's and stays. */
test("flipPerspective swaps you and opp on subjects and dealers, leaves any alone", () => {
  const tags: CardTags = {
    oracleId: "e", schemaVersion: 1, promptVersion: 0, model: "t",
    characteristics: { types: ["emblem"], subtypes: ["chandra"], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, emblem: true, keywords: [] },
    abilities: [{
      kind: "triggered",
      trigger: { verbs: ["upkeep"], subject: { control: "you", token: null } },
      effect: { kind: "damage", subject: { control: "you", token: null } },
      amount: "3",
      emits: [{ verb: "non-combat-damage", subject: { control: "you", token: null }, dealer: { control: "you", token: null } }],
    }, {
      kind: "static",
      effect: { kind: "pump", subject: { control: "opp", token: null, type: "creature" } },
      emits: [{ verb: "lose-life", subject: { control: "any", token: null } }],
    }],
  };
  const flipped = flipPerspective(tags);
  expect(flipped.abilities[0]!.trigger!.subject.control).toBe("opp");
  expect(flipped.abilities[0]!.effect.subject!.control).toBe("opp");
  expect(flipped.abilities[0]!.emits![0]!.subject.control).toBe("opp");
  expect(flipped.abilities[0]!.emits![0]!.dealer!.control).toBe("opp");
  expect(flipped.abilities[1]!.effect.subject!.control).toBe("you");
  expect(flipped.abilities[1]!.emits![0]!.subject.control).toBe("any");
  // Pure: the input is untouched.
  expect(tags.abilities[0]!.trigger!.subject.control).toBe("you");
});
