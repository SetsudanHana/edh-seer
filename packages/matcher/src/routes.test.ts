import { expect, test } from "vitest";
import type { Reason } from "@edh-seer/engine";
import { findRoutes } from "./routes.js";

const r = (producer: string, consumer: string, producerAbility: number | undefined, consumerAbility: number | undefined, extra: Partial<Reason> = {}): Reason => ({
  tag: `t:${producer}>${consumer}`, text: `${producer} feeds ${consumer}`, producer, consumer,
  ...(producerAbility !== undefined ? { producerAbility } : {}),
  ...(consumerAbility !== undefined ? { consumerAbility } : {}),
  ...extra,
});

test("a chain through the same ability is a route, one sentence per hop", () => {
  const routes = findRoutes([r("A", "X", undefined, 0), r("X", "B", 0, 1)], "A", "B");
  expect(routes).toHaveLength(1);
  expect(routes[0]!.hops.map((h) => h.text)).toEqual(["A feeds X", "X feeds B"]);
});

/** THE TEST THIS DESIGN EXISTS FOR: A reaches X's ability 0, X's ability 1 reaches B. */
test("the false chain is refused", () => {
  expect(findRoutes([r("A", "X", undefined, 0), r("X", "B", 1, 0)], "A", "B")).toEqual([]);
});

test("a token a hop creates continues through its own implied events", () => {
  const reasons = [
    r("Krenko", "Goblin", 0, undefined, { consumerIsToken: true }),
    r("Goblin", "Impact Tremors", undefined, 0, { producerIsToken: true }),
    r("Impact Tremors", "Ghyrson", 0, 0),
  ];
  expect(findRoutes(reasons, "Krenko", "Ghyrson")[0]!.hops.map((h) => h.to)).toEqual(["Goblin", "Impact Tremors", "Ghyrson"]);
});

test("a middle hop cannot start from a card merely existing", () => {
  expect(findRoutes([r("A", "X", undefined, 0), r("X", "B", undefined, 0)], "A", "B")).toEqual([]);
});

test("the hop cap: five hops is no route at maxHops 4", () => {
  const chain = [r("A", "C1", undefined, 0), r("C1", "C2", 0, 0), r("C2", "C3", 0, 0), r("C3", "C4", 0, 0), r("C4", "B", 0, 0)];
  expect(findRoutes(chain, "A", "B")).toEqual([]);
  expect(findRoutes(chain, "A", "B", { maxHops: 5 })).toHaveLength(1);
});

test("the shortest route wins over a longer one", () => {
  const reasons = [r("A", "C", undefined, 0), r("C", "D", 0, 0), r("D", "B", 0, 0), r("A", "E", undefined, 0), r("E", "B", 0, 0)];
  expect(findRoutes(reasons, "A", "B").map((x) => x.hops.length)).toEqual([2]);
});

test("a face's ability does not continue from the other face's", () => {
  // X's back face (1) is triggered at its ability 0; X's FRONT face's ability 0 feeds B.
  expect(findRoutes([r("A", "X", undefined, 0, { consumerFace: 1 }), r("X", "B", 0, 0)], "A", "B")).toEqual([]);
  expect(findRoutes([r("A", "X", undefined, 0, { consumerFace: 1 }), r("X", "B", 0, 0, { producerFace: 1 })], "A", "B")).toHaveLength(1);
});

test("a self hop is not a route step", () => {
  expect(findRoutes([r("A", "A", undefined, 0), r("A", "B", 0, 0)], "A", "B").map((x) => x.hops.length)).toEqual([1]);
});

test("a token node and a card with the same name are different stops", () => {
  // The Llanowar Elves CARD's ability 0 feeds B; the TOKEN named Llanowar Elves has no ability to continue from.
  const reasons = [r("A", "Llanowar Elves", 0, undefined, { consumerIsToken: true }), r("Llanowar Elves", "B", 0, 0)];
  expect(findRoutes(reasons, "A", "B")).toEqual([]);
});

test("no indices, no route", () => {
  expect(findRoutes([{ tag: "static:pump", text: "A pumps B", producer: "A", consumer: "B" }], "A", "B")).toEqual([]);
});
