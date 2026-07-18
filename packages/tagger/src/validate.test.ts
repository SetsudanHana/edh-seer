import { expect, test } from "vitest";
import { parseAbilities } from "./validate.js";

test("parses a valid triggered ability", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
        effect: { kind: "token-generation" },
      },
    ],
  });
  const abilities = parseAbilities(raw);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].kind).toBe("triggered");
  expect(abilities[0].trigger!.verbs).toEqual(["enters"]);
});

test("empty abilities is valid", () => {
  expect(parseAbilities('{"abilities":[]}')).toEqual([]);
});

test("throws on non-JSON", () => {
  expect(() => parseAbilities("not json")).toThrow(/parse/i);
});

test("throws on unknown verb", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "triggered", trigger: { verbs: ["explodes"], subject: { control: "you", token: null } }, effect: { kind: "x" } }],
  });
  expect(() => parseAbilities(raw)).toThrow(/verb/i);
});

test("normalizes missing/unknown control and token instead of throwing", () => {
  // LLM omits token and uses an unknown control word.
  const raw = JSON.stringify({
    abilities: [{ kind: "static", effect: { kind: "lord", subject: { subtype: "wizard", control: "mine" } } }],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.subject!.control).toBe("you"); // unknown -> default you
  expect(a.effect.subject!.token).toBe(null); // missing -> null (any)
});

test("maps opponent synonyms to opp and coerces stray token to null", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: { type: "creature", control: "each opponent", token: "null" } },
        effect: { kind: "drain" },
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.subject.control).toBe("opp");
  expect(a.trigger!.subject.token).toBe(null);
});

test("throws when triggered ability lacks a trigger", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "triggered", effect: { kind: "x" } }] });
  expect(() => parseAbilities(raw)).toThrow(/trigger/i);
});

test("accepts array-valued type/subtype (OR)", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: { type: ["instant", "sorcery"], control: "you", token: false } },
        effect: { kind: "player-damage", subject: { subtype: ["faerie", "wizard"], control: "you", token: null } },
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.subject.type).toEqual(["instant", "sorcery"]);
  expect(a.effect.subject!.subtype).toEqual(["faerie", "wizard"]);
});
