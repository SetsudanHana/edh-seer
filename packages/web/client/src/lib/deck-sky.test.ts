import { expect, test } from "vitest";
import { engineDeck } from "./engine-model.fixture.js";
import { buildEngineModel } from "./engine-model.js";
import { deckSky } from "./deck-sky.js";

test("every card is one star, placed the same way every time, and themes are constellations", () => {
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);
  const a = deckSky(m), b = deckSky(m);
  expect(a.stars.map((s) => [s.id, s.x, s.y])).toEqual(b.stars.map((s) => [s.id, s.x, s.y]));
  const cards = [...m.cards.values()].filter((c) => !c.isToken && !c.isFace);
  expect(new Set(a.stars.map((s) => s.id)).size).toBe(cards.length);
  expect(a.stars.length).toBe(cards.length);
  for (const s of a.stars) expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
  // Each constellation holds only cards of its theme, and every theme drawn has a star.
  for (const c of a.clusters) {
    expect(c.ids.length).toBeGreaterThan(0);
    const g = m.groups.find((x) => x.tag === c.tag)!;
    for (const id of c.ids) expect(g.hubs.includes(id) || g.members.includes(id)).toBe(true);
  }
  // A constellation's lines join cards that work together, never two strangers.
  for (const [x, y] of a.lines) expect(!!m.partners.get(x)?.get(y)).toBe(true);
});

test("a set's links into the deck, once each, and the links inside it", async () => {
  const { linksFrom, linksWithin } = await import("./deck-sky.js");
  const { report, graph } = engineDeck();
  const m = buildEngineModel(report, graph);
  const ids = new Set(["Payoff A", "Payoff B"]);
  const out = linksFrom(m, ids);
  const keys = out.map(([a, b]) => [a, b].sort().join("|"));
  expect(new Set(keys).size).toBe(keys.length);
  for (const [a, b] of out) expect(ids.has(a) && !!m.partners.get(a)?.get(b) && !m.cards.get(b)!.isToken).toBe(true);
  expect(linksWithin(m, ids).map((p) => [...p].sort())).toEqual([["Payoff A", "Payoff B"]]);
});
