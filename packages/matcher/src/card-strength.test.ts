import { expect, test } from "vitest";
import { COMMANDER_BOOST, loadImpactWeights, type Reason } from "@edh-seer/engine";
import { AXIS_BOOST, FEEDER_SHARE, cardStrength, type CardLink } from "./card-strength.js";

const w = loadImpactWeights();
const r = (tag: string): Reason => ({ tag, text: tag });
const fed = (tag: string, commander = false): CardLink => ({ feeds: [], fedBy: [r(tag)], commander });
const feeds = (tag: string): CardLink => ({ feeds: [r(tag)], fedBy: [], commander: false });
const axis = new Map([["dies:creature", 1]]);

test("the report's formula: what a card is fed, square-rooted, plus a damped share of what it feeds", () => {
  const s = cardStrength([fed("enters:creature"), fed("enters:creature"), feeds("enters:creature")], w, new Map());
  expect(s.strength).toBeCloseTo(Math.sqrt(2) + (w.roleBlend ?? 1) * Math.sqrt(FEEDER_SHARE));
  expect(s).toMatchObject({ partners: 3, onTheme: 0, commander: false });
});

test("links on the deck's theme outweigh more links off it: the case a partner count got wrong", () => {
  const offTheme = cardStrength(Array.from({ length: 6 }, () => fed("enters:creature")), w, axis);
  const onTheme = cardStrength(Array.from({ length: 3 }, () => fed("dies:creature")), w, axis);
  expect(onTheme.strength).toBeGreaterThan(offTheme.strength);
  expect(onTheme.strength).toBeCloseTo(Math.sqrt(3 * (1 + AXIS_BOOST)));
  expect(onTheme.onTheme).toBe(3);
});

test("a link with the commander counts COMMANDER_BOOST times, and is said", () => {
  const s = cardStrength([fed("enters:creature", true)], w, new Map());
  expect(s.strength).toBeCloseTo(Math.sqrt(COMMANDER_BOOST));
  expect(s.commander).toBe(true);
});

test("a deck card with no reason either way is not a partner", () => {
  expect(cardStrength([{ feeds: [], fedBy: [], commander: true }], w, axis)).toEqual({ strength: 0, partners: 0, onTheme: 0, commander: false });
});
