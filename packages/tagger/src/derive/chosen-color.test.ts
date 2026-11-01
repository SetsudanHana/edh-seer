import { expect, test } from "vitest";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";
import { chosenColorOf } from "./chosen-color.js";
import { parseSubject } from "./subject.js";
import type { Ability, SubjectFilter } from "../schema.js";

// #1360: a chosen COLOUR is not a chosen creature TYPE. Real oracle text (corpus 2026-11-01).
const HERALDIC = "As this artifact enters, choose a color.\nCreatures you control of the chosen color get +1/+0.\n{T}: Add one mana of the chosen color.";
const PRISM = "As this artifact enters, choose a color.\nWhenever you cast a spell of the chosen color, you gain 1 life.";
const KINDRED = "As this enchantment enters, choose a creature type.\nAt the beginning of your upkeep, you may look at the top card of your library. If it's a creature card of the chosen type, you may reveal it and put it into your hand.";

const subjectsOf = (name: string, oracleText: string, typeLine: string): SubjectFilter[] => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  const tags = deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
  return tags.abilities.flatMap((a) => [a.trigger?.subject, a.effect.subject, ...(a.emits ?? []).map((e) => e.subject)]).filter((s): s is SubjectFilter => s !== undefined);
};

test("Heraldic Banner's subjects carry chosenColor and no chosenType", () => {
  const subs = subjectsOf("Heraldic Banner", HERALDIC, "Artifact");
  expect(subs.some((s) => s.chosenColor === true)).toBe(true);
  expect(subs.some((s) => s.chosenType === true)).toBe(false);
});

test("Prism Ring's cast trigger carries chosenColor and no chosenType", () => {
  const subs = subjectsOf("Prism Ring", PRISM, "Artifact");
  expect(subs.some((s) => s.chosenColor === true)).toBe(true);
  expect(subs.some((s) => s.chosenType === true)).toBe(false);
});

test("a chosen creature type is still chosenType (Kindred Discovery-style)", () => {
  const subs = subjectsOf("Kindred Discovery", KINDRED, "Enchantment");
  expect(subs.some((s) => s.chosenColor === true)).toBe(false);
  expect(parseSubject("creature spells of the chosen type").chosenType).toBe(true);
});

test("parseSubject reads the chosen colour as chosenColor", () => {
  const s = parseSubject("creatures you control of the chosen color");
  expect(s.chosenColor).toBe(true);
  expect(s.chosenType).toBeUndefined();
});

// A STORED (model) reading puts chosenType on a colour choice, the prompt does not tell it apart.
const stored = (subject: SubjectFilter): Ability => ({
  kind: "activated", clause: 2, effect: { kind: "mana-generation", subject },
} as unknown as Ability);

test("chosenColorOf moves a stored chosenType to chosenColor when its clause names a colour only", () => {
  const sub: SubjectFilter = { control: "any", token: null, chosenType: true };
  const [a] = chosenColorOf([stored(sub)], { 2: "{T}: Add one mana of the chosen color." }, HERALDIC);
  expect(a!.effect.subject).toEqual({ control: "any", token: null, chosenColor: true });
});

test("chosenColorOf leaves 'the chosen color and type' (Riptide Replicator's token) a chosenType", () => {
  const sub: SubjectFilter = { control: "you", token: true, type: "creature", chosenType: true };
  const text = "{4}, {T}: Create an X/X creature token of the chosen color and type, where X is the number of charge counters on this artifact.";
  const [a] = chosenColorOf([stored(sub)], { 2: text }, text);
  expect(a!.effect.subject).toEqual(sub);
});
