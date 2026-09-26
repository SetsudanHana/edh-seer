import { expect, test } from "vitest";
import { engineDeck } from "./engine-model.fixture.js";
import { buildEngineModel } from "./engine-model.js";
import { buildOrbit, visiblePartners } from "./orbit-model.js";

const model = () => { const { report, graph } = engineDeck(); return buildEngineModel(report, graph); };

test("the cards a card works with sit in sectors by group, the biggest group first", () => {
  const o = buildOrbit(model(), "Payoff A")!;
  // Ten deck cards and the Treasure token, counted apart.
  expect(o.direct).toBe(10);
  expect(o.directTokens).toBe(1);
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

test("every sector on a card gets its own colour", () => {
  const o = buildOrbit(model(), "Payoff A")!;
  expect(new Set(o.sectors.map((s) => s.hue)).size).toBe(o.sectors.length);
});

test("a sector with one-time links keeps one on the ring when the rest are folded", () => {
  const m = model();
  const o = buildOrbit(m, "Cleric 1")!;
  const withOnce = o.sectors.find((s) => s.partners.some((p) => p.once) && s.partners.length > 2);
  if (!withOnce) return;
  const v = visiblePartners(o, o.sectors.length * 2).find((x) => x.sector === withOnce)!;
  expect(v.shown.some((p) => p.once)).toBe(true);
});

/** Owner ruling 2026-09-27 (#517): a pair held only by a prowess pump is no route. Vanilla is not
 *  reached; a prowess link to Cleric 1 must not make it "one step out", while a real link does. */
test("a prowess-only link is no route one step out; a real link is", () => {
  const withLink = (tag: string) => {
    const { report, graph } = engineDeck();
    const edges = [...report.edges, { a: "Cleric 1", b: "Vanilla", score: 1, reasons: [{ producer: "Vanilla", consumer: "Cleric 1", tag, text: "When Vanilla is cast, Cleric 1 gets +1/+1" }] }];
    return buildOrbit(buildEngineModel({ ...report, edges } as typeof report, graph), "Payoff A")!;
  };
  expect(withLink("prowess:-creature").far.map((c) => c.id)).toContain("Vanilla");
  expect(withLink("cast:-creature").near.map((n) => n.card.id)).toContain("Vanilla");
});
