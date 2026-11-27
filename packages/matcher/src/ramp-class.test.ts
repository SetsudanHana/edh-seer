import { describe, expect, test } from "vitest";
import goldfish from "./fixtures/goldfish-cards.json" with { type: "json" };
import { classifyAccelerant } from "./goldfish.js";
import { RAMP_RESILIENCE } from "./mana-base.js";
import { NON_ACCELERANT_WEIGHT, isColourFilter, nonAccelerantRamp } from "./ramp-class.js";
import type { DeckCard } from "./types.js";

// #1190: every Ramp-role card the goldfish does not play as an accelerant was weighted 0.15 as "a one-shot", and the report called it "a ritual or a Treasure". Birgi and Phyrexian Altar are
// neither. The class is read from the derived mana lines; the WEIGHT per class is unchanged (a weight change needs an owner ruling).
const real = (name: string): DeckCard => structuredClone((goldfish as unknown as DeckCard[]).find((c) => c.card.name === name)!);

describe("the class of a Ramp-role card that is not an accelerant", () => {
  const cases: [string, string][] = [
    ["Dark Ritual", "one-shot"],
    ["Seething Song", "one-shot"],
    ["Pitiless Plunderer", "one-shot"],
    ["Lotus Petal", "one-shot"],
    ["Birgi, God of Storytelling // Harnfel, Horn of Bounty", "trigger-mana"],
    ["Phyrexian Altar", "sacrifice"],
    ["Myriad Landscape", "land"],
    ["Wayfarer's Bauble", "land-drop"],
    ["Jegantha, the Wellspring", "restricted"],
    ["Cryptic Trilobite", "restricted"],
    ["Wall of Roots", "paid"],
    ["Springleaf Drum", "paid"],
    ["Mox Tantalite", "other"],
  ];
  for (const [name, want] of cases) {
    test(`${name} is ${want}`, () => {
      const dc = real(name);
      expect(classifyAccelerant(dc, [dc]), `${name} must not be an accelerant for the class to be asked`).toBeNull();
      expect(nonAccelerantRamp(dc, [dc])).toBe(want);
    });
  }

  test("a gated source the deck does not meet is gated-off; the deck that meets the gate plays it as a rock", () => {
    const jasper = real("Mox Jasper");
    expect(classifyAccelerant(jasper, [jasper])).toBeNull();
    expect(nonAccelerantRamp(jasper, [jasper])).toBe("gated-off");
  });

  test("a Lander maker is a land-drop; a cost reducer is its own class", () => {
    const lander: DeckCard = { ...real("Pitiless Plunderer"), tags: { ...real("Pitiless Plunderer").tags!, manaLines: [{ ...real("Pitiless Plunderer").tags!.manaLines![0]!, producesToken: "lander" }] } };
    expect(nonAccelerantRamp(lander, [lander])).toBe("land-drop");
    const medallion: DeckCard = { card: { name: "Sapphire Medallion", oracleText: "", typeLine: "Artifact", manaValue: 3 } as never, tags: { abilities: [{ kind: "static", effect: { kind: "cost-reduction", subject: { control: "you", type: "spell", scope: "all" } } }] } as never };
    expect(nonAccelerantRamp(medallion, [medallion])).toBe("cost-reducer");
  });

  test("the weight per class is pinned: a land is no ramp piece (null), a cost reducer and a colour filter weigh 0 (owner 2026-10-14, 2026-11-27), every other class 0.15", () => {
    const want: Record<string, number | null> = {
      land: null, "land-drop": RAMP_RESILIENCE.oneShot, "cost-reducer": 0, "colour-filter": 0, "one-shot": RAMP_RESILIENCE.oneShot, sacrifice: RAMP_RESILIENCE.oneShot,
      "trigger-mana": RAMP_RESILIENCE.oneShot, "gated-off": RAMP_RESILIENCE.oneShot, restricted: RAMP_RESILIENCE.oneShot, paid: RAMP_RESILIENCE.oneShot, other: RAMP_RESILIENCE.oneShot,
    };
    expect(NON_ACCELERANT_WEIGHT).toEqual(want);
  });
});

// #1237 (owner ruling 2026-11-26, weight 0 on 2026-11-27): a NET-0 COLOUR FILTER fixes colours and adds no mana. The goldfish refuses it as acceleration since #1184 (`classifyAccelerant`'s net bar); the land count now names it its own class.
// The 13 cards of the issue, as stored (Mongo, 2026-11-27), each asked with no deck. In a deck, 12 stay filters: Pyramid of the Pantheon's counter line is admitted there (test below).
const THIRTEEN = ["Prophetic Prism", "Arcum's Astrolabe", "Celestial Prism", "Mana Cylix", "Viridian Acolyte", "Giant's Boulder", "Helionaut", "Fire Sprites", "Ceta Disciple", "Necra Disciple", "Standing Stones",
  "Jenson Carthalion, Druid Exile", "Pyramid of the Pantheon"];
describe("a net-0 colour filter is a class of its own", () => {
  for (const name of THIRTEEN) {
    // Asked of the card alone (no deck): Pyramid of the Pantheon's three-mana line waits on counters on the card itself, which the goldfish admits by the turn in a deck that can meet it (`ManaOutput.estimated`), so there it is played as an accelerant.
    test(`${name} is a colour filter: an accelerant until the net bar, none after it`, () => {
      const dc = real(name);
      expect(classifyAccelerant(dc, undefined, false, false), "a rock or a dork without the bar").not.toBeNull();
      expect(classifyAccelerant(dc, undefined, false, true), "none with the bar").toBeNull();
      expect(isColourFilter(dc)).toBe(true);
      expect(nonAccelerantRamp(dc)).toBe("colour-filter");
    });
  }
  test("Sol Ring, Mind Stone, Chromatic Lantern and a net +1 dork (Llanowar Elves) are not", () => {
    for (const name of ["Sol Ring", "Mind Stone", "Chromatic Lantern", "Llanowar Elves"]) {
      const dc = real(name);
      expect(isColourFilter(dc, [dc]), name).toBe(false);
      expect(nonAccelerantRamp(dc, [dc]), name).not.toBe("colour-filter");
    }
  });
  test("a one-shot and a land are not (they were never accelerants)", () => {
    for (const name of ["Dark Ritual", "Myriad Landscape"]) expect(isColourFilter(real(name), [real(name)]), name).toBe(false);
  });
});

// #1237 review: in a deck, Pyramid of the Pantheon is no colour filter. Its brick-counter line is admitted by the turn there, so the land count keeps
// it a rock, as on main. Mana Cylix in the same deck is still a filter.
test("in a deck, Pyramid of the Pantheon stays an accelerant; Mana Cylix stays a colour filter", () => {
  const pyramid = real("Pyramid of the Pantheon");
  const cylix = real("Mana Cylix");
  const deck = [pyramid, cylix, real("Sol Ring")];
  expect(isColourFilter(pyramid, deck)).toBe(false);
  expect(isColourFilter(cylix, deck)).toBe(true);
});
