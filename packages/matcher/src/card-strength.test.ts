import { expect, test } from "vitest";
import { COMMANDER_BOOST, loadImpactWeights, type Reason } from "@edh-seer/engine";
import { AXIS_BOOST, FEEDER_SHARE, cardStrength, type CardLink } from "./card-strength.js";

const w = loadImpactWeights();
/** A repeating payoff whose effect is `kind` (the prior: kind x repeatability x scaling). */
const r = (tag: string, effectKind: string): Reason => ({ tag, text: tag, effectKind, repeatability: "triggered" });
const fed = (tag: string, kind = "draw-card", commander = false): CardLink => ({ feeds: [], fedBy: [r(tag, kind)], commander });
const feeds = (tag: string, kind = "draw-card"): CardLink => ({ feeds: [r(tag, kind)], fedBy: [], commander: false });
const none = new Map<string, number>();

test("what a link is worth: gaining 1 life counts a fraction of drawing a card", () => {
  const life = cardStrength([fed("enters:creature", "lifegain")], w, none).strength;
  const draw = cardStrength([fed("enters:creature", "draw-card")], w, none).strength;
  expect(life).toBeCloseTo(Math.sqrt(w.kinds.lifegain!));
  expect(draw).toBeCloseTo(Math.sqrt(w.kinds["draw-card"]!));
  expect(life).toBeLessThan(draw / 1.5);
});

test("diminishing returns per trigger: many links through one trigger are one synergy grown, not many", () => {
  const sameTrigger = cardStrength(Array.from({ length: 16 }, () => fed("enters:creature")), w, none).strength;
  const fourTriggers = cardStrength(["enters:creature", "dies:creature", "cast:instant", "attacks:creature"].map((t) => fed(t)), w, none).strength;
  expect(sameTrigger).toBeCloseTo(4 * Math.sqrt(w.kinds["draw-card"]!)); // sqrt(16) of one
  expect(fourTriggers).toBeCloseTo(4 * Math.sqrt(w.kinds["draw-card"]!)); // four in full
  // So a payoff that fires on every creature for 1 life does not beat a card that draws off four things.
  const everything = cardStrength(Array.from({ length: 30 }, () => fed("enters:creature", "lifegain")), w, none).strength;
  expect(everything).toBeLessThan(fourTriggers);
});

test("the deck's theme and the commander still count for more; feeding counts a share", () => {
  const axis = new Map([["dies:creature", 1]]);
  expect(cardStrength([fed("dies:creature")], w, axis).strength).toBeCloseTo(Math.sqrt(w.kinds["draw-card"]! * (1 + AXIS_BOOST)));
  const s = cardStrength([fed("enters:creature", "draw-card", true)], w, none);
  expect(s.strength).toBeCloseTo(Math.sqrt(w.kinds["draw-card"]! * COMMANDER_BOOST));
  expect(s.commander).toBe(true);
  expect(cardStrength([feeds("enters:creature")], w, none).strength).toBeCloseTo((w.roleBlend ?? 1) * Math.sqrt(FEEDER_SHARE * w.kinds["draw-card"]!));
});

test("a deck card with no reason either way is not a partner", () => {
  expect(cardStrength([{ feeds: [], fedBy: [], commander: true }], w, new Map())).toEqual({ strength: 0, partners: 0, onTheme: 0, commander: false });
});
