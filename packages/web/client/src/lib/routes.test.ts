import { expect, test } from "vitest";
import { routesThrough, ROUTE_MIDDLE_CAP } from "./routes.js";
import type { CardGraph } from "../types.js";

const e = (from: string, to: string, tags: string[], weight = 1): CardGraph["edges"][number] =>
  ({ from, to, weight, tags, reasonTexts: [] });

/** THE OWNER'S OWN CASE, 2026-08-27. Ghyrson Starn does not synergise with token creation; add
 *  Impact Tremors and it does, because Tremors triggers on a creature entering and emits damage.
 *  The engine formed both edges all along and never said the route existed. */
test("a token maker reaches a damage payoff through the card that converts the event", () => {
  const edges = [
    e("Krenko", "Impact Tremors", ["enters:creature"]),
    e("Impact Tremors", "Ghyrson Starn", ["non-combat-damage:any"]),
  ];
  const [r] = routesThrough(edges, "Ghyrson Starn");
  expect(r.through).toBe("Impact Tremors");
  expect(r.dir).toBe("in");
  expect(r.ends).toEqual(["Krenko"]);
  // BOTH mechanisms are named — a route is heterogeneous in event type, which is exactly why an
  // event FILTER cannot show one: tracing either verb alone hides half the chain.
  expect(r.farTag).toBe("enters:creature");
  expect(r.nearTag).toBe("non-combat-damage:any");
});

test("a far end that already connects directly is not re-reported as a route", () => {
  const edges = [
    e("Krenko", "Impact Tremors", ["enters:creature"]),
    e("Impact Tremors", "Ghyrson Starn", ["non-combat-damage:any"]),
    // Krenko already reaches Ghyrson on its own; the inspector lists that edge directly.
    e("Krenko", "Ghyrson Starn", ["enters:creature"]),
  ];
  expect(routesThrough(edges, "Ghyrson Starn")).toEqual([]);
});

test("routes out are found as well as routes in", () => {
  const edges = [
    e("Ghyrson Starn", "Impact Tremors", ["non-combat-damage:any"]),
    e("Impact Tremors", "Payoff", ["enters:creature"]),
  ];
  const [r] = routesThrough(edges, "Ghyrson Starn");
  expect(r.dir).toBe("out");
  expect(r.through).toBe("Impact Tremors");
  expect(r.ends).toEqual(["Payoff"]);
});

/** The middle doing the most work leads, because it is the card a reader most needs named. */
test("middles are ranked by how many routes they open, and capped", () => {
  const edges = [
    e("M1", "Root", ["x:any"]), e("M2", "Root", ["x:any"]),
    e("A", "M1", ["y:any"]), e("B", "M1", ["y:any"]), e("C", "M1", ["y:any"]),
    e("D", "M2", ["y:any"]),
  ];
  const rs = routesThrough(edges, "Root");
  expect(rs[0].through).toBe("M1");
  expect(rs[0].total).toBe(3);
  expect(rs[1].through).toBe("M2");
  expect(rs.length).toBeLessThanOrEqual(ROUTE_MIDDLE_CAP);
});

test("neither the root nor the middle is ever its own far end", () => {
  const edges = [
    e("Root", "M", ["x:any"]), e("M", "Root", ["y:any"]),
  ];
  for (const r of routesThrough(edges, "Root")) {
    expect(r.ends).not.toContain("Root");
    expect(r.ends).not.toContain("M");
  }
});
