import { expect, test } from "vitest";
import type { CardPageData, PartnerRow } from "./partners.js";
import { pageMap, pickRoundRobin } from "./page-orbit.js";

const row = (slug: string, event: string, producer = false): PartnerRow => ({ name: slug, slug, score: 0.1, event, reason: `${slug} reason`, ...(producer ? { producer: true as const } : {}) });
const PAGE = {
  name: "Krenko, Mob Boss", typeLine: "Legendary Creature", manaCost: null, artCrop: null, backArtCrop: null, abilities: [],
  identity: ["R"], commander: true, emits: [], demands: [], pool: {}, rarity: {},
  partners: [row("a1", "enters|creature|-|-"), row("a2", "enters|creature|-|-"), row("a3", "enters|creature|-|-"), row("b1", "dies|creature|-|-"), row("c1", "attacks|creature|-|-", true)],
} as unknown as CardPageData;

test("a card page's rows become the map: one group per event, links from the card that causes it", () => {
  const m = pageMap(PAGE, "krenko");
  expect(m.orbit.sectors.map((s) => s.partners.map((p) => p.card.id))).toEqual([["a1", "a2", "a3"], ["b1"], ["c1"]]);
  expect(m.groups.map((g) => g.hue)).toEqual(m.orbit.sectors.map((s) => s.hue));
  expect(m.orbit.direct).toBe(5);
  // A producer row's card causes the event Krenko waits for: the link runs into the middle.
  const c1 = m.orbit.sectors[2]!.partners[0]!.links[0]!;
  expect([c1.from, c1.to]).toEqual(["c1", "krenko"]);
  const a1 = m.orbit.sectors[0]!.partners[0]!.links[0]!;
  expect([a1.from, a1.to]).toEqual(["krenko", "a1"]);
});

test("the map takes the first card of every group before a second of any", () => {
  const m = pageMap(PAGE, "krenko");
  expect(pickRoundRobin(m.orbit, 4).map((x) => x.p.card.id)).toEqual(["a1", "b1", "c1", "a2"]);
  expect(pickRoundRobin(m.orbit, 99).length).toBe(5);
});
