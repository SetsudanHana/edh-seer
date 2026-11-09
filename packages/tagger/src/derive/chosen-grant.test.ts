import { expect, test } from "vitest";
import { chosenGrantSentence, withChosenTypeGrant } from "./chosen-grant.js";

test("the sentences that hand the chosen type over are read; a condition on it is not (#1570)", () => {
  expect(chosenGrantSentence("This creature is the chosen type in addition to its other types.")).toBe("This creature is the chosen type in addition to its other types");
  expect(chosenGrantSentence("Creatures you control are the chosen type. The same is true for creature spells you control.")).toBe("Creatures you control are the chosen type");
  expect(chosenGrantSentence("Enchanted land is the chosen type.")).toBe("Enchanted land is the chosen type");
  expect(chosenGrantSentence("Each creature card in your graveyard has the chosen creature type in addition to its other types.")).toContain("graveyard has the chosen creature type");
  expect(chosenGrantSentence("Lands you control are the chosen basic land type.")).toBeDefined();
  // conditions and reveals
  expect(chosenGrantSentence("Sacrifice this enchantment, Reveal the creature type you chose: If target attacking creature token is the chosen type, put three +1/+1 counters on it.")).toBeUndefined();
  expect(chosenGrantSentence("If the revealed card is the chosen type, put that card onto the battlefield.")).toBeUndefined();
  expect(chosenGrantSentence("Creatures of the chosen type get +1/+1.")).toBeUndefined();
});

test("only a clause of vague actions is rewritten", () => {
  const clause = (verb: string) => ({ id: 2, abilityType: "static", actions: [{ verb, object: "x" }] }) as never;
  const text = "This creature is the chosen type in addition to its other types.";
  for (const v of ["other", "none", "animate", "grant-ability"]) expect(withChosenTypeGrant(clause(v), text).actions![0]).toMatchObject({ verb: "grant-ability", object: text.slice(0, -1) });
  const c = clause("draw");
  expect(withChosenTypeGrant(c, text)).toBe(c);
  expect(withChosenTypeGrant(clause("other"), undefined)).toEqual(clause("other"));
});
