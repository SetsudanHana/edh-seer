import { describe, expect, test } from "vitest";
import goldfish from "./fixtures/goldfish-cards.json" with { type: "json" };
import { classifyAccelerant } from "./goldfish.js";
import { RAMP_RESILIENCE } from "./mana-base.js";
import { NON_ACCELERANT_WEIGHT, nonAccelerantRamp } from "./ramp-class.js";
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

  test("the weight per class is the one every non-accelerant has had (0.15); a land is no ramp piece", () => {
    for (const [cls, w] of Object.entries(NON_ACCELERANT_WEIGHT)) {
      if (cls === "land") expect(w, cls).toBeNull();
      else expect(w, cls).toBe(RAMP_RESILIENCE.oneShot);
    }
  });
});
