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

test("throws on bad control value", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "static", effect: { kind: "lord", subject: { subtype: "wizard", control: "mine", token: false } } }],
  });
  expect(() => parseAbilities(raw)).toThrow(/control/i);
});

test("throws when triggered ability lacks a trigger", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "triggered", effect: { kind: "x" } }] });
  expect(() => parseAbilities(raw)).toThrow(/trigger/i);
});
