import { expect, test } from "vitest";
import { parseSubject } from "./subject.js";

test("control comes from the possessive phrase, defaulting to any", () => {
  expect(parseSubject("a creature you control").control).toBe("you");
  expect(parseSubject("each creature your opponents control").control).toBe("opp");
  expect(parseSubject("target opponent").control).toBe("opp");
  expect(parseSubject("target creature").control).toBe("any");
});

test("a subject with no card type is a player — the absence of type IS the encoding", () => {
  // Zulaport Cutthroat's drain subject is {control:"opp", token:null} with no type at all.
  expect(parseSubject("each opponent")).toMatchObject({ control: "opp", token: null });
  expect(parseSubject("you")).toEqual({ control: "you", token: null });
});

test("card types are recognised singular and plural", () => {
  expect(parseSubject("target creature").type).toBe("creature");
  expect(parseSubject("creatures you control").type).toBe("creature");
  expect(parseSubject("target artifact or enchantment").type).toEqual(["artifact", "enchantment"]);
  expect(parseSubject("target nonland permanent").type).toBe("permanent");
});

test("token is tri-state and always explicit", () => {
  expect(parseSubject("a creature token you control").token).toBe(true);
  expect(parseSubject("a nontoken creature you control").token).toBe(false);
  expect(parseSubject("target creature").token).toBeNull();
});
