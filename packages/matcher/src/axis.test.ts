import { expect, test } from "vitest";
import type { Reason } from "@mtg/engine";
import { buildAxis, axisFactor } from "./axis.js";

const reason = (tag: string): Reason => ({ tag, text: `${tag} reason` });

test("commander theme tags always weigh 1", () => {
  const axis = buildAxis(new Set(["cast:noncreature"]), new Map());
  expect(axis.get("cast:noncreature")).toBe(1);
});

test("non-commander tags weigh by deck frequency, normalized to the most common", () => {
  const deckFreq = new Map([
    ["enters:creature", 10],
    ["gain-life", 5],
  ]);
  const axis = buildAxis(new Set(), deckFreq);
  expect(axis.get("enters:creature")).toBe(1); // 10/10
  expect(axis.get("gain-life")).toBe(0.5); // 5/10
});

test("a tag both on the commander and frequent takes the max (1)", () => {
  const axis = buildAxis(new Set(["gain-life"]), new Map([["gain-life", 2], ["enters:creature", 10]]));
  expect(axis.get("gain-life")).toBe(1); // max(commander 1, theme 0.2)
});

test("a generic commander (no theme tags) cedes the axis to deck themes", () => {
  const axis = buildAxis(new Set(), new Map([["proliferate", 4], ["draw", 2]]));
  expect(axis.get("proliferate")).toBe(1);
  expect(axis.get("draw")).toBe(0.5);
});

test("axisFactor is 1 for an edge with no on-axis reason", () => {
  const axis = buildAxis(new Set(["cast:noncreature"]), new Map());
  expect(axisFactor([reason("enters:creature")], axis, 1.5)).toBe(1);
});

test("axisFactor amplifies an on-axis edge by 1 + boost*weight", () => {
  const axis = buildAxis(new Set(["cast:noncreature"]), new Map());
  expect(axisFactor([reason("cast:noncreature")], axis, 1.5)).toBe(2.5); // 1 + 1.5*1
});

test("axisFactor uses the strongest on-axis reason in a multi-reason edge", () => {
  const axis = buildAxis(new Set(), new Map([["a", 10], ["b", 2]])); // a=1.0, b=0.2
  expect(axisFactor([reason("a"), reason("b")], axis, 1.5)).toBe(2.5); // uses a
});
