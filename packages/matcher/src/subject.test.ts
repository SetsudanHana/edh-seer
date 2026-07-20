import { expect, test } from "vitest";
import { subjectMatches } from "./subject.js";
import type { SubjectFilter } from "@mtg/tagger";
import type { Hierarchy } from "./types.js";

const H: Hierarchy = { wizard: ["creature"], zombie: ["creature"], treasure: ["artifact"] };
const s = (o: Partial<SubjectFilter>): SubjectFilter => ({ control: "you", token: null, ...o });

test("consumer type is satisfied by a producer subtype via the hierarchy", () => {
  expect(subjectMatches(s({ subtype: "wizard" }), s({ type: "creature" }), H)).toBe(true);
});

test("consumer subtype requires the producer to be that subtype", () => {
  expect(subjectMatches(s({ type: "creature" }), s({ subtype: "wizard" }), H)).toBe(false);
  expect(subjectMatches(s({ subtype: "wizard" }), s({ subtype: "wizard" }), H)).toBe(true);
});

test("OR arrays match if any branch matches", () => {
  expect(subjectMatches(s({ subtype: "wizard" }), s({ type: ["artifact", "creature"] }), H)).toBe(true);
  expect(subjectMatches(s({ subtype: "treasure" }), s({ type: ["creature"] }), H)).toBe(false);
});

test("control matches equal or via any wildcard, else fails", () => {
  expect(subjectMatches(s({ control: "you" }), s({ control: "you" }), H)).toBe(true);
  expect(subjectMatches(s({ control: "you" }), s({ control: "any" }), H)).toBe(true);
  expect(subjectMatches(s({ control: "you" }), s({ control: "opp" }), H)).toBe(false);
});

test("token tri-state gates the match", () => {
  expect(subjectMatches(s({ token: true }), s({ token: null }), H)).toBe(true);
  expect(subjectMatches(s({ token: true }), s({ token: false }), H)).toBe(false);
  expect(subjectMatches(s({ token: false }), s({ token: true }), H)).toBe(false);
});

test("counter and zone gates require equality when the consumer names them", () => {
  expect(subjectMatches(s({ counter: "+1/+1" }), s({ counter: "+1/+1" }), H)).toBe(true);
  expect(subjectMatches(s({}), s({ counter: "+1/+1" }), H)).toBe(false);
  expect(subjectMatches(s({ zone: "graveyard" }), s({ zone: "graveyard" }), H)).toBe(true);
});
