import { expect, test } from "vitest";
import { shortestPath, stepRoute } from "./walk-route.js";

// Rani - Role - Token - Wicked Role, and Rani - Cleric; Loner stands alone.
const graph: Record<string, string[]> = {
  Rani: ["Role", "Cleric"], Role: ["Rani", "Token"], Token: ["Role", "Wicked Role"], "Wicked Role": ["Token"],
  Cleric: ["Rani"], Loner: [],
};
const links = (id: string) => graph[id] ?? [];
const linked = (a: string, b: string) => links(a).includes(b);

test("the shortest path goes hop by hop along real links", () => {
  expect(shortestPath("Rani", "Wicked Role", links)).toEqual(["Rani", "Role", "Token", "Wicked Role"]);
  expect(shortestPath("Rani", "Role", links)).toEqual(["Rani", "Role"]);
  expect(shortestPath("Rani", "Rani", links)).toEqual(["Rani"]);
  expect(shortestPath("Rani", "Loner", links)).toBeNull();
});

test("a step to a card the middle doesn't reach takes every card on the way (#769)", () => {
  // Back at step one (The Rani, nothing behind it), a tap on Wicked Role.
  const trail = stepRoute([], "Rani", "Wicked Role", links);
  expect(trail).toEqual(["Rani", "Role", "Token"]);
  const route = [...trail, "Wicked Role"];
  for (let i = 1; i < route.length; i++) expect(linked(route[i - 1]!, route[i]!)).toBe(true);
});

test("a step to a linked card adds only the card you left", () => {
  expect(stepRoute(["Cleric"], "Rani", "Role", links)).toEqual(["Cleric", "Rani"]);
});

test("a card already on the route is a step back to it", () => {
  expect(stepRoute(["Cleric", "Rani", "Role"], "Token", "Rani", links)).toEqual(["Cleric"]);
});

test("a path that crosses the route has its loop cut out, and no card appears twice", () => {
  // Walked Rani -> Role, now on Token; the way to Cleric runs back through Role and Rani.
  expect(stepRoute(["Rani", "Role"], "Token", "Cleric", links)).toEqual(["Rani"]);
  expect(linked("Rani", "Cleric")).toBe(true);
});

test("a card no link reaches starts the route again", () => {
  expect(stepRoute(["Cleric"], "Rani", "Loner", links)).toEqual([]);
});

test("past the cap the oldest cards drop off the front, and each step left is still a link", () => {
  const chain: Record<string, string[]> = {};
  const ids = Array.from({ length: 10 }, (_, i) => `c${i}`);
  ids.forEach((id, i) => { chain[id] = [ids[i - 1], ids[i + 1]].filter((x): x is string => !!x); });
  const trail = stepRoute([], "c0", "c9", (id) => chain[id] ?? [], 6);
  expect(trail).toEqual(["c3", "c4", "c5", "c6", "c7", "c8"]);
});
