import { expect, test } from "vitest";
import fixtures from "./same-job.fixtures.json" with { type: "json" };
import { ingredients, rolesOfCard } from "./quality.js";
import { effectsOf, sameGroup, sameJob } from "./same-job.js";
import type { DeckCard } from "./types.js";

/** Cards as the corpus derives them (tags read 2026-10-02). */
const card = (name: keyof typeof fixtures) => fixtures[name] as unknown as DeckCard;

test("one shared role label is not the same job: taking an opponent out is not giving yourself hexproof", () => {
  const reproach = card("Teferi's Reproach");
  const calm = card("Blossoming Calm");
  expect(rolesOfCard(reproach)).toContain("protection");
  expect(rolesOfCard(calm)).toContain("protection");
  expect([...effectsOf(reproach, "protection")]).not.toEqual([...effectsOf(calm, "protection")]);
  expect(sameJob(reproach, calm, "protection")).toBe(false);
});

test("protecting you is not protecting your permanents, though both read as a bare keyword grant", () => {
  const calm = card("Blossoming Calm");
  const heroic = card("Heroic Intervention");
  expect(effectsOf(calm, "protection")).toContain("protects|you");
  expect(effectsOf(heroic, "protection")).toContain("protects|permanents");
  expect(sameJob(heroic, calm, "protection")).toBe(false);
  expect(sameJob(heroic, heroic, "protection")).toBe(true);
});

test("a removal spell whose victim puts a permanent onto the battlefield gives the opponent something back", () => {
  expect(ingredients(card("Wild Magic Surge"), "targetedRemoval").drawback).toBe(1);
  expect(ingredients(card("Stroke of Midnight"), "targetedRemoval").drawback).toBe(1);
});

test("a Game Changer is in a rock's group though not its job: Mana Vault does not untap, Mox Diamond costs a land", () => {
  const signet = card("Arcane Signet");
  for (const gc of [card("Mana Vault"), card("Mox Diamond")]) {
    expect(sameJob(signet, gc, "ramp")).toBe(false);
    expect(sameGroup(signet, gc, "ramp")).toBe(true);
  }
  expect(sameJob(card("Painful Truths"), card("Rhystic Study"), "draw")).toBe(false);
  expect(sameGroup(card("Painful Truths"), card("Rhystic Study"), "draw")).toBe(true);
});

test("the group still keeps the kind of job: taking an opponent out is not giving yourself hexproof, and removal is not ramp", () => {
  expect(sameGroup(card("Teferi's Reproach"), card("Blossoming Calm"), "protection")).toBe(false);
  expect(sameGroup(card("Stroke of Midnight"), card("Mana Vault"), "ramp")).toBe(false);
});
