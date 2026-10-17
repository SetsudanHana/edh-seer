import { expect, test } from "vitest";
import { classifyCondition, conditionTestsObject } from "./intervening-if.js";

const none = { threshold: false, selfDiesOnCreatureCard: false };

test("the family is the audit's, and the same call says whether derive represents it", () => {
  expect(classifyCondition("it had one or more counters on it", none)).toMatchObject({ family: "counter-presence", represented: false });
  expect(classifyCondition("you cast it", none)).toMatchObject({ family: "cast-entry", represented: false });
  expect(classifyCondition("you control an artifact", none)).toMatchObject({ family: "control", represented: false });
  expect(classifyCondition("something unlisted", none)).toMatchObject({ family: "other", represented: false });
});

test("the shapes derive represents", () => {
  expect(classifyCondition("three or more creatures died this turn", { ...none, threshold: true }).represented).toBe(true);
  expect(classifyCondition("it doesn't have the same name as another creature you control", none).represented).toBe(true);
  expect(classifyCondition("it wasn't cast", none).represented).toBe(true);
  expect(classifyCondition("none of them were cast", none).represented).toBe(true);
  expect(classifyCondition("you didn't cast it from your hand", none).represented).toBe(true);
  expect(classifyCondition("a creature left the battlefield without dying", none).represented).toBe(true);
  expect(classifyCondition("it's the first creature spell you cast this turn", none).represented).toBe(true);
  expect(classifyCondition("it's the first instant spell this turn", none).represented).toBe(true);
  expect(classifyCondition("~ is in the command zone or on the battlefield", none).represented).toBe(true);
  expect(classifyCondition("this card is in your graveyard", none).represented).toBe(true);
});

test("'it was a creature' is represented only for a self dies trigger on a creature card (#1250)", () => {
  expect(classifyCondition("it was a creature", none)).toMatchObject({ family: "was-a-type", represented: false });
  expect(classifyCondition("it was a creature", { ...none, selfDiesOnCreatureCard: true }).represented).toBe(true);
  expect(classifyCondition("they were an creature", { ...none, selfDiesOnCreatureCard: true }).represented).toBe(true);
  expect(classifyCondition("it was an artifact", { ...none, selfDiesOnCreatureCard: true }).represented).toBe(false);
});

test("conditionTestsObject reads the whole text: an if that tests the trigger's object", () => {
  for (const t of ["Whenever a creature dies, if it was enchanted or equipped, draw a card.", "When it becomes blocked, if it was cast, scry 1.",
    "Whenever a creature attacks, if it's exiled, x.", "If that creature is legendary, y."]) {
    expect(conditionTestsObject(t), t).toBe(true);
  }
  for (const t of ["Whenever a creature attacks, if it's not their turn, draw.", "if it's the first time that creature has become tapped this turn"]) {
    expect(conditionTestsObject(t), t).toBe(false);
  }
});
