import { expect, test } from "vitest";
import { engineDeck } from "./engine-model.fixture.js";
import { buildEngineModel } from "./engine-model.js";
import { buildOrbit, visiblePartners } from "./orbit-model.js";

const model = () => { const { report, graph } = engineDeck(); return buildEngineModel(report, graph); };

test("the cards a card works with sit in sectors by group, the biggest group first", () => {
  const o = buildOrbit(model(), "Payoff A")!;
  expect(o.direct).toBe(11);
  expect(o.sectors[0]!.partners.map((p) => p.card.id)).toContain("Cleric 1");
  expect(o.sectors.flatMap((s) => s.partners).length).toBe(11);
});

test("the rest of the deck is one step out or not reached, and tokens are neither", () => {
  const o = buildOrbit(model(), "Payoff A")!;
  const reducer = o.near.find((n) => n.card.id === "Reducer")!;
  expect(reducer.via.map((c) => c.id)).toContain("Cleric 1");
  expect(o.far.map((c) => c.id)).toEqual(["Doom Blade", "Vanilla"]);
  expect([...o.near.map((n) => n.card.id), ...o.far.map((c) => c.id)]).not.toContain("token:Treasure");
});

test("a card that is not in the deck has no orbit", () => {
  expect(buildOrbit(model(), "Nope")).toBeNull();
});

test("when the ring is full every sector keeps a disc, and the rest are counted", () => {
  const o = buildOrbit(model(), "Payoff A")!;
  const vis = visiblePartners(o, 4);
  expect(vis.every((v) => v.shown.length >= 1)).toBe(true);
  expect(vis.reduce((t, v) => t + v.shown.length + v.hidden, 0)).toBe(11);
  expect(vis.reduce((t, v) => t + v.shown.length, 0)).toBeLessThanOrEqual(Math.max(4, o.sectors.length));
});

test("the cards one step out are grouped under the fewest partners that cover them", () => {
  const o = buildOrbit(model(), "Payoff A")!;
  expect(o.through.reduce((t, g) => t + g.cards.length, 0)).toBe(o.near.length);
  const ids = o.through.flatMap((g) => g.cards.map((c) => c.id));
  expect(new Set(ids).size).toBe(ids.length);
  expect(o.through.every((g) => g.example)).toBe(true);
});
