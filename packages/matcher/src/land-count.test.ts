import { expect, test } from "vitest";
import type { Card } from "@mtg/engine";
import { karstenLands } from "@mtg/engine";
import { landInputs, recommendedLands } from "./land-count.js";
import type { DeckCard } from "./types.js";

const mk = (
  name: string, manaValue: number, oracleText = "", typeLine = "Artifact",
  extra: Partial<Card> = {},
): DeckCard => ({
  card: { name, manaValue, oracleText, typeLine, keywords: [], colors: [], ...extra } as Card,
  tags: null,
});

const land = (name: string) => mk(name, 0, "{T}: Add {B}.", "Land", { producedMana: ["B"] });

test("fast mana is a 0-cost repeatable source, and it is NOT cheap ramp", () => {
  const deck = [
    mk("Mox Diamond", 0, "{T}: Add one mana of any color.", "Artifact", { producedMana: ["W", "U", "B", "R", "G"] }),
    mk("Mana Crypt", 0, "{T}: Add {C}{C}.", "Artifact", { producedMana: ["C"] }),
    // Sol Ring costs 1, so by the spec's own definition it is cheap ramp, not fast mana.
    mk("Sol Ring", 1, "{T}: Add {C}{C}.", "Artifact", { producedMana: ["C"] }),
    // A 0-cost card that produces nothing is neither.
    mk("Ornithopter", 0, "Flying", "Artifact Creature"),
    land("Swamp"),
  ];
  const inputs = landInputs(deck);
  expect(inputs.fastMana).toBe(2);
  expect(inputs.rampPlusDraw).toBe(1); // Sol Ring only
});

/** The correction the stub asks for and the spec calls the one most implementations get wrong. A
 *  Mox counted as cheap ramp is 0.72 of a land lost, every time. */
test("counting a Mox as cheap ramp would change the answer", () => {
  const deck = [
    ...Array.from({ length: 5 }, (_, i) => mk(`Mox-${i}`, 0, "{T}: Add {W}.", "Artifact", { producedMana: ["W"] })),
    ...Array.from({ length: 30 }, (_, i) => mk(`Spell-${i}`, 3)),
  ];
  const inputs = landInputs(deck);
  expect(inputs.fastMana).toBe(5);
  const correct = karstenLands(inputs);
  const wrong = karstenLands({ ...inputs, fastMana: 0, rampPlusDraw: inputs.rampPlusDraw + 5 });
  expect(wrong - correct).toBeCloseTo(3.6, 6);
});

test("cheap ramp and cheap draw count, expensive ones do not", () => {
  // Draw is detected from the tagged effect kind, not from oracle text, so these carry tags -- the
  // same way a real analysed deck does.
  const drawTags = (id: string) => ({
    oracleId: id, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: {
      types: ["instant"], subtypes: [], colors: [], identity: [], cmc: 0,
      power: null, toughness: null, token: false, keywords: [],
    },
    abilities: [{ kind: "on-cast" as const, effect: { kind: "draw-card" as const } }],
  });
  const deck: DeckCard[] = [
    mk("Rampant Growth", 2, "Search your library for a basic land card and put it onto the battlefield tapped.", "Sorcery"),
    mk("Explosive Vegetation", 4, "Search your library for two basic land cards and put them onto the battlefield tapped.", "Sorcery"),
    { ...mk("Ponder", 1, "Draw a card.", "Sorcery"), tags: drawTags("ponder") },
    { ...mk("Blue Sun's Zenith", 5, "Target player draws X cards.", "Instant"), tags: drawTags("bsz") },
    land("Swamp"),
  ];
  // Karsten's bucket is CHEAP acceleration -- a 4-mana ramp spell does not shorten the same turns,
  // and a 5-mana draw spell is a payoff you needed the lands to cast in the first place.
  expect(landInputs(deck).rampPlusDraw).toBe(2);
});

test("the average is over nonlands, which is what the regression was fitted on", () => {
  const deck = [mk("Two", 2), mk("Four", 4), land("Swamp"), land("Island")];
  expect(landInputs(deck).avgManaValue).toBe(3);
});

test("commanders are counted, not just assumed to be one", () => {
  const deck = [mk("Spell", 3), land("Swamp")];
  expect(landInputs(deck, { commanderNames: ["A", "B"] }).commanders).toBe(2);
  expect(landInputs(deck).commanders).toBe(1);
});

test("the recommendation comes back with the count the deck actually runs", () => {
  const deck = [
    ...Array.from({ length: 60 }, (_, i) => mk(`Spell-${i}`, 3)),
    ...Array.from({ length: 37 }, (_, i) => land(`Swamp-${i}`)),
  ];
  const rec = recommendedLands(deck);
  expect(rec.actual).toBe(37);
  expect(rec.target).toBe(Math.round(karstenLands(landInputs(deck))));
  expect(rec.target).toBeGreaterThan(30);
});

test("MDFC counts are zero, and say so rather than being silently absent", () => {
  // Nothing in the repo detects a modal DFC with a land back yet. Reporting 0 explicitly keeps the
  // omission visible instead of letting the regression's own default hide it.
  const inputs = landInputs([mk("Spell", 3), land("Swamp")]);
  expect(inputs.mdfcUntapped).toBe(0);
  expect(inputs.mdfcTapped).toBe(0);
});
