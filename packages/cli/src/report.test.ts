import { describe, expect, it, test } from "vitest";
import type { DeckReport } from "@mtg/engine";
import { formatReport } from "./report.js";

const report: DeckReport = {
  commanders: ["Krenko, Mob Boss"],
  cards: [
    {
      name: "Krenko, Mob Boss",
      isCommander: true,
      score: 6,
      partnerCount: 2,
      topPartners: [{ name: "Impact Tremors", score: 2, reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }] }],
    },
    {
      name: "Impact Tremors",
      isCommander: false,
      score: 2.375,
      partnerCount: 1,
      topPartners: [{ name: "Krenko, Mob Boss", score: 2, reasons: [{ tag: "token", text: "Krenko makes tokens; Impact Tremors pays off tokens." }] }],
    },
  ],
  edges: [],
  combos: [{ cards: ["A", "B"], result: "Win" }],
  themes: [{ tag: "token", count: 2 }],
  manaCurve: [
    { value: 0, count: 0 },
    { value: 1, count: 0 },
    { value: 2, count: 0 },
    { value: 3, count: 0 },
    { value: 4, count: 0 },
    { value: 5, count: 0 },
    { value: 6, count: 0 },
    { value: 7, count: 0 },
  ],
  landCount: 0,
  avgManaValue: 0,
  medianManaValue: 0,
  roles: { ramp: 1, draw: 0, removal: 0 },
  cohesion: {
    theme: "Goblins",
    tag: "tribe:goblin",
    // `dominant` is REQUIRED and this fixture never had it -- `vitest` does not typecheck, so the
    // suite stayed green while `tsc -p packages/cli` failed at HEAD. The recorded trap, again.
    dominant: true,
    secondary: "Treasures",
    secondaryTag: "treasure",
    score: 0.5,
    familyScore: 0.5,
    label: "focused",
  },
};

test("formatReport shows commanders, ranked cards with partner counts, and reasons", () => {
  const out = formatReport(report);
  expect(out).toContain("Krenko, Mob Boss");
  expect(out).toMatch(/commander/i);
  expect(out).toContain("synergizes with 2");
  expect(out).toContain("pays off tokens");
  expect(out).toContain("Win"); // combo still rendered
  expect(out).toContain("token: 2"); // themes still rendered
  expect(out).toContain("Deck cohesion");
  expect(out).toContain("Goblins / Treasures"); // primary / secondary theme
  expect(out).toContain("0.50 (focused)");
  expect(out).toContain("[6.00]"); // integer score formatted to 2 decimals
  expect(out).toContain("[2.38]"); // fractional score rounds to 2 decimals (2.375 -> 2.38)
});

test("formatReport renders a placeholder when cohesion is null", () => {
  const out = formatReport({ ...report, cohesion: null });
  expect(out).toContain("=== Deck cohesion ===");
  expect(out).toContain("(no themes)");
});

// ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER. Bontu's Monument printed
// "triggers on a creature being cast" three times for each of three partners -- nine rows where
// three belong -- because the reason OBJECTS survive on purpose (effectKind is load-bearing for
// archetype detection) and only the graph wire was deduping them.
test("a partner's repeated sentence is printed once", () => {
  const dup = (text: string, effectKind: string) => ({ tag: "cast:creature", text, effectKind });
  const dupReport = {
    ...report,
    cards: [{
      name: "Bontu's Monument", score: 8.7, synergyRating: 4, partnerCount: 1, isCommander: false,
      topPartners: [{
        name: "Burakos, Party Leader",
        reasons: [
          dup("Bontu's Monument triggers on a creature being cast; Burakos supplies it", "drain"),
          dup("Bontu's Monument triggers on a creature being cast; Burakos supplies it", "lifegain"),
          dup("Bontu's Monument triggers on a creature being cast; Burakos supplies it", "player-life-loss"),
        ],
      }],
    }],
  } as never;
  const out = formatReport(dupReport);
  const hits = out.split("\n").filter((l) => l.includes("triggers on a creature being cast"));
  expect(hits).toHaveLength(1);
});

test("the commander's cast odds ship WITH what is wrong with them", () => {
  const r = {
    ...report,
    deckMath: { topdeck: [], castability: { cards: [], refused: 0, biases: "", commanders: [
      { name: "Samut, the Driving Force", turn: 6, mana: 0.341, manaWithRocks: 0.435, colors: [] },
    ] } },
  } as unknown as DeckReport;
  const out = formatReport(r);
  expect(out).toContain("34% – 44% to have 6 mana by turn 6");
  // A bare percentage the engine already knows reads low is worse than no percentage.
  expect(out).toContain("land-fetch ramp");
  // One commander needs no name prefix; the line sits under the name already printed.
  expect(out).not.toContain("Samut, the Driving Force: 34%");
});

test("a refused cost prints an em dash and the reason, never 0%", () => {
  const r = {
    ...report,
    deckMath: { topdeck: [], castability: { cards: [], refused: 1, biases: "", commanders: [
      { name: "Omarthis", turn: 2, mana: null, manaWithRocks: null, colors: [], refused: "X cost — the mana value on the card is not what you pay" },
    ] } },
  } as unknown as DeckReport;
  const out = formatReport(r);
  expect(out).toContain("— (X cost");
  expect(out).not.toMatch(/\b0%/);
});

test("the thing block abstains with the theme layer, and prints its own ceiling", () => {
  const withThing = formatReport({ ...report, thing: {
    theme: "creatures entering", tag: "enters:creature", count: 39, cards: [],
    fromCommandZone: ["Samut, the Driving Force"], turn: 3, k: 2, probability: 0.96,
  } } as unknown as DeckReport);
  expect(withThing).toContain("39 cards do this deck's thing (creatures entering)");
  expect(withThing).toContain("96% to have 2 of them by turn 3");
  expect(withThing).toContain("from the command zone, every game");
  expect(withThing).toContain("one in six");
  // Null exactly when the theme layer declined to name the deck.
  expect(formatReport({ ...report, thing: null } as unknown as DeckReport)).not.toContain("does the deck do its thing");
});

describe("ramp resilience", () => {
  it("prints the three tiers and the land share", () => {
    const out = formatReport({ ...report, rampResilience: { land: 8, rock: 5, dork: 2, landShare: 8 / 15 } });
    expect(out).toContain("=== How resilient your ramp is ===");
    expect(out).toContain("lands 8  ·  rocks 5  ·  dorks 2  —  53% land-shaped");
    // The caveat is BLOCK TEXT, not a tooltip: the K9 review found tooltips never reach a touch
    // user, and "not scored" is the load-bearing half of this section.
    expect(out).toContain("Not scored");
  });

  it("says nothing at all for a deck with no ramp", () => {
    // Three zeroes state nothing, and `landShare` is deliberately absent rather than 0 there --
    // 0% land-shaped would read as "all fragile" for a deck that has nothing to be fragile.
    const out = formatReport({ ...report, rampResilience: { land: 0, rock: 0, dork: 0 } });
    expect(out).not.toContain("How resilient your ramp is");
  });

  it("says nothing when the field is absent (the flat engine never populates it)", () => {
    expect(formatReport(report)).not.toContain("How resilient your ramp is");
  });
});
