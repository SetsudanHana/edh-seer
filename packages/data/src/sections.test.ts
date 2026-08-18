import { expect, test } from "vitest";
import { parseDecklistSections } from "./sections.js";

test("splits a Commander section from the deck", () => {
  const text = [
    "Commander",
    "1 Krenko, Mob Boss",
    "",
    "Deck",
    "1 Sol Ring",
    "1 Impact Tremors",
  ].join("\n");
  expect(parseDecklistSections(text)).toEqual({
    commanders: ["Krenko, Mob Boss"],
    deck: ["Sol Ring", "Impact Tremors"],
  });
});

test("supports two commanders (Partner) and drops a Sideboard section", () => {
  const text = [
    "Commanders",
    "1 Tymna the Weaver",
    "1 Thrasios, Triton Hero",
    "",
    "1 Sol Ring",
    "",
    "Sideboard",
    "1 Not In Deck",
  ].join("\n");
  const out = parseDecklistSections(text);
  expect(out.commanders).toEqual(["Tymna the Weaver", "Thrasios, Triton Hero"]);
  expect(out.deck).toEqual(["Sol Ring"]);
});

test("no Commander header → everything is deck, commanders empty", () => {
  const text = "1 Sol Ring\n1 Krenko, Mob Boss";
  expect(parseDecklistSections(text)).toEqual({
    commanders: [],
    deck: ["Sol Ring", "Krenko, Mob Boss"],
  });
});

test("expands quantities in the deck section (basics counted by copy)", () => {
  const { deck } = parseDecklistSections("2 Forest\n1 Sol Ring");
  expect(deck).toEqual(["Forest", "Forest", "Sol Ring"]);
});

// THE HEADERLESS CONVENTION. Requiring a "Commander" header meant `commanders` came back empty for
// all 71 calibration decks, so SubjectFilter.commander shipped with a producer side that could never
// fire. Measured over those files: 67 have a one-card first block, 4 have two (partner pairs), none
// has three or more.
test("a headerless list reads its first block as the commander", () => {
  const s = parseDecklistSections("1 Kratos, God of War\n\n30 Mountain\n1 Sol Ring");
  expect(s.commanders).toEqual(["Kratos, God of War"]);
  expect(s.deck).toContain("Sol Ring");
  expect(s.deck).not.toContain("Kratos, God of War");
});

test("two cards before the blank line are a partner pair", () => {
  const s = parseDecklistSections("1 Kediss, Emberclaw Familiar\n1 Kratos, God of War\n\n1 Sol Ring");
  expect(s.commanders).toEqual(["Kediss, Emberclaw Familiar", "Kratos, God of War"]);
});

test("an explicit header always wins over the convention", () => {
  const s = parseDecklistSections("Commander\n1 Kratos, God of War\n\nDeck\n1 Sol Ring");
  expect(s.commanders).toEqual(["Kratos, God of War"]);
  expect(s.deck).toEqual(["Sol Ring"]);
});

test("an ordinary list is NOT reinterpreted", () => {
  // Three cards before the blank is a decklist that happens to have one, not a commander block —
  // guessing there would mislabel two real deck cards.
  const three = parseDecklistSections("1 Sol Ring\n1 Mana Crypt\n1 Mox Diamond\n\n1 Forest");
  expect(three.commanders).toEqual([]);
  // No blank line at all: nothing to split on.
  expect(parseDecklistSections("1 Sol Ring\n1 Forest").commanders).toEqual([]);
});

// THE FLAT EXPORT (Moxfield plain text): commander first, no blank line, alphabetical 99. Measured
// 2026-08-18 — the owner's own deck parsed with ZERO commanders, so COMMANDER_TF_BOOST never fired,
// markCommander stamped nothing and pressure.ts priced the commander by draw probability. Fires on
// that file and on zero of the 71 calibration decks, which all carry the blank line.
const alphabetical = [
  "1 Arachnogenesis", "1 Arid Mesa", "1 Artifact Mutation", "1 Aura Mutation", "1 Beast Within",
  "1 Birds of Paradise", "1 Chandra's Ignition", "1 Cultivate", "1 Elemental Bond", "1 Farseek",
  "1 Fires of Yavimaya", "15 Forest", "1 Garruk's Uprising", "1 Guardian Project", "1 Harrow",
  "1 Impact Tremors", "1 Kodama's Reach", "1 Krosan Grip", "1 Llanowar Elves", "1 Migration Path",
  "1 Nature's Lore", "1 Parallel Lives", "1 Purphoros, God of the Forge", "1 Rampant Growth",
  "1 Sakura-Tribe Elder", "1 Second Harvest", "1 Skyshroud Claim", "1 Sol Ring", "1 Song of Freyalise",
  "1 Three Visits", "1 Warleader's Call", "1 Wild Growth",
];

test("a flat export with the commander first and an alphabetical 99 finds the commander", () => {
  const text = ["1 Samut, the Driving Force (DFT) 367", ...alphabetical].join("\n");
  const out = parseDecklistSections(text);
  expect(out.commanders).toEqual(["Samut, the Driving Force"]);
  expect(out.deck).toHaveLength(46); // 31 singles + 15 Forest
  expect(out.deck).not.toContain("Samut, the Driving Force");
});

test("a partner pair at the head of a flat export is found too", () => {
  const text = ["1 Tana, the Bloodsower", "1 Tymna the Weaver", ...alphabetical].join("\n");
  expect(parseDecklistSections(text).commanders).toEqual(["Tana, the Bloodsower", "Tymna the Weaver"]);
});

// IT UNDER-DETECTS ON PURPOSE: a missing commander is recoverable, a wrong one is silent and
// deck-wide.
test("a commander that sorts first breaks no order, so nothing is inferred", () => {
  const text = ["1 Aatua, Whatever", ...alphabetical].join("\n");
  expect(parseDecklistSections(text).commanders).toEqual([]);
});

test("a list that is not sorted at all is left alone", () => {
  const text = ["1 Samut, the Driving Force", "1 Zombie Master", "1 Arid Mesa", ...alphabetical].join("\n");
  expect(parseDecklistSections(text).commanders).toEqual([]);
});

test("an explicit header still wins over the flat-export inference", () => {
  const text = ["Commander", "1 Krenko, Mob Boss", "Deck", ...alphabetical].join("\n");
  expect(parseDecklistSections(text).commanders).toEqual(["Krenko, Mob Boss"]);
});

test("a short sorted fragment is not a decklist and infers nothing", () => {
  const text = ["1 Zzz Card", "1 Arid Mesa", "1 Birds of Paradise"].join("\n");
  expect(parseDecklistSections(text).commanders).toEqual([]);
});
