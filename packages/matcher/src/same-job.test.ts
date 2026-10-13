import { expect, test } from "vitest";
import fixtures from "./same-job.fixtures.json" with { type: "json" };
import labelCards from "./same-job.labels.cards.json" with { type: "json" };
import labelSet from "./same-job.labels.json" with { type: "json" };
import { ingredients, rolesOfCard } from "./quality.js";
import { effectsOf, groupKey, hasGatedYield, netPositiveMana, netYield, sameGroup, sameJob, sameRockAnyColour } from "./same-job.js";
import { cardLines, producedManaTypes } from "./mana-lines.js";
import { withLines } from "./mana-test-support.js";
import type { DeckCard } from "./types.js";

/** Cards as the corpus derives them (tags read 2026-10-02). */
const card = (name: keyof typeof fixtures) => fixtures[name] as unknown as DeckCard;

test("one shared role label is not the same job: taking an opponent out is not giving yourself hexproof", () => {
  const reproach = card("Teferi's Reproach");
  const calm = card("Blossoming Calm");
  expect(rolesOfCard(reproach)).toContain("protection");
  expect(rolesOfCard(calm)).toContain("protection");
  expect([...effectsOf(reproach, "protection")]).not.toEqual([...effectsOf(calm, "protection")]);
  expect(sameJob(reproach, calm, "protection")).toBe(false);
});

test("protecting you is not protecting your permanents, though both read as a bare keyword grant", () => {
  const calm = card("Blossoming Calm");
  const heroic = card("Heroic Intervention");
  expect(effectsOf(calm, "protection")).toContain("protects|you");
  expect(effectsOf(heroic, "protection")).toContain("protects|permanents");
  expect(sameJob(heroic, calm, "protection")).toBe(false);
  // THE GRANT'S KEYWORDS ARE PART OF THE KEY (S-T1, 2026-10-06): read from the grammar, so the card
  // is the same job as itself and still not Blossoming Calm.
  expect(groupKey(heroic, "protection")).toMatch(/hexproof/);
  expect(sameJob(heroic, heroic, "protection")).toBe(true);
});

/** THE GROUP KEY IS THE JOB (S-T2): a readable card is the same job as itself, and the parts the
 *  stored tags lost -- a condition, a limit on what it hits -- keep cards apart. */
test("a card read completely is in its own group", () => {
  const signet = card("Arcane Signet");
  expect(groupKey(signet, "ramp")).not.toBeNull();
  expect(sameJob(signet, signet, "ramp")).toBe(true);
});

test("a removal spell whose victim puts a permanent onto the battlefield gives the opponent something back", () => {
  expect(ingredients(card("Wild Magic Surge"), "targetedRemoval").drawback).toBe(1);
  expect(ingredients(card("Stroke of Midnight"), "targetedRemoval").drawback).toBe(1);
});

test("a Game Changer is in a rock's group though not its job: Mana Vault does not untap, Mox Diamond costs a land", () => {
  const signet = card("Arcane Signet");
  for (const gc of [card("Mana Vault"), card("Mox Diamond")]) {
    expect(sameJob(signet, gc, "ramp")).toBe(false);
    expect(sameGroup(signet, gc, "ramp")).toBe(true);
  }
  expect(sameJob(card("Painful Truths"), card("Rhystic Study"), "draw")).toBe(false);
  expect(sameGroup(card("Painful Truths"), card("Rhystic Study"), "draw")).toBe(true);
});

test("the group still keeps the kind of job: taking an opponent out is not giving yourself hexproof, and removal is not ramp", () => {
  expect(sameGroup(card("Teferi's Reproach"), card("Blossoming Calm"), "protection")).toBe(false);
  expect(sameGroup(card("Stroke of Midnight"), card("Mana Vault"), "ramp")).toBe(false);
});

test("trading a land for a land is not ramp: Crop Rotation is not in Cultivate's group", () => {
  expect(rolesOfCard(card("Crop Rotation"))).toContain("ramp");
  expect(sameGroup(card("Cultivate"), card("Crop Rotation"), "ramp")).toBe(false);
});

/** G1, THE SAME-JOB GATE, IN THE SUITE (S-T2, docs/plans/2026-10-04-same-job-review.md): over the
 *  owner's second reading of the labelled pairs, at least 90% of the pairs `sameJob` puts together
 *  are labelled same, and no pair labelled different is put together. Measured 2026-10-06: 9 of 10
 *  together are same, 0 different (the old rules: 11 of 61, 39 different). Cards as the static build
 *  resolves them (`research/matcher/dump-same-job-label-cards.ts`). A ratchet both ways: the purity
 *  floor, and the count of same pairs found may not fall below what is banked. */
test("G1: the pairs the group key puts together are the owner's same pairs", () => {
  const labels = labelSet.pairs as { role: string; out: string; in: string; label: string; excluded?: boolean }[];
  const cards = labelCards as unknown as Record<string, DeckCard>;
  const live = labels.filter((p) => !p.excluded);
  const together = live.filter((p) => sameJob(cards[p.out]!, cards[p.in]!, p.role as never));
  const same = together.filter((p) => p.label === "same").length;
  expect(together.filter((p) => p.label === "different").map((p) => `${p.out} -> ${p.in}`)).toEqual([]);
  expect(same / together.length).toBeGreaterThanOrEqual(0.9);
  expect(same).toBeGreaterThanOrEqual(9);
});

// #1169 2b-2 follow-up: a card that adds no mana TYPE (a Treasure / Spawn maker, a grantee engine) was one bucket in the ramp key (the empty string). It keys on what it does
// instead, so a land fetch that also makes an Eldrazi Spawn is not the plain land fetch of the same cost.
test("two ramp cards that add no mana type do not share a group because of it (Growth Spasm is not Scout the Wilderness)", () => {
  const spasm = card("Growth Spasm");
  const scout = card("Scout the Wilderness");
  expect(groupKey(spasm, "ramp")).not.toBeNull();
  expect(groupKey(spasm, "ramp")).not.toBe(groupKey(scout, "ramp"));
  expect(sameJob(scout, spasm, "ramp")).toBe(false);
});

// #1169 2b-2 fix round 2 (owner 2026-10-13: a gated source is still a mana source, conditioned on the deck). A gated line counts when the DECK meets its gate, and not otherwise;
// with no deck to judge it against it is credited as before (never).
const filler = (n: number): DeckCard[] => Array.from({ length: n }, (_, i) => ({ card: { name: `Spell ${i}`, typeLine: "Instant", oracleText: "", manaValue: 2 } as never, tags: null }));
const ofType = (n: number, typeLine: string, name = "Piece"): DeckCard[] => Array.from({ length: n }, (_, i) => ({ card: { name: `${name} ${i}`, typeLine, oracleText: "", manaValue: 2 } as never, tags: null }));
const deckWith = (...own: DeckCard[][]): DeckCard[] => { const cards = own.flat(); return [...cards, ...filler(100 - cards.length)]; };

test("a gated line counts toward net yield and net-positive mana in a deck that meets its gate, and in no other (Mox Jasper, Mox Opal, Sceptre of Eternal Glory)", () => {
  const jasper = card("Mox Jasper");
  const dragons = deckWith(ofType(12, "Creature — Dragon", "Dragon"));
  expect(netYield(jasper)).toBeNull();
  expect(netYield(jasper, deckWith())).toBeNull();
  expect(netYield(jasper, dragons)).toBe(1);
  expect(netPositiveMana(jasper)).toBe(false);
  expect(netPositiveMana(jasper, deckWith())).toBe(false);
  expect(netPositiveMana(jasper, dragons)).toBe(true);
  const opal = card("Mox Opal");
  expect(netPositiveMana(opal, deckWith(ofType(25, "Artifact", "Rock")))).toBe(true);
  expect(netPositiveMana(opal, deckWith(ofType(2, "Artifact", "Rock")))).toBe(false);
  // Sceptre: an ungated 1, and a gated 3 that waits on three lands with one name
  const sceptre = card("Sceptre of Eternal Glory");
  expect(netYield(sceptre)).toBe(1);
  expect(netYield(sceptre, deckWith(ofType(24, "Basic Land — Forest", "Forest").map((d) => ({ ...d, card: { ...d.card, name: "Forest" } }))))).toBe(3);
  expect(netYield(sceptre, deckWith(ofType(24, "Land", "Land")))).toBe(1);
  // a gate that is not a property of a decklist stays unmet whatever the deck: Glistening Sphere's poison counters
  expect(netYield(card("Glistening Sphere"), deckWith(ofType(40, "Artifact")))).toBe(1);
});

test("a gated rock is not a like-for-like swap for an ungated one, whatever the deck (a rock that needs Dragons is not a Signet)", () => {
  const dragons = deckWith(ofType(12, "Creature — Dragon", "Dragon"));
  const signet = card("Arcane Signet");
  // the same card in every other respect, with its one mana line gated on a Dragon
  const gated = withLines(signet, cardLines(signet).map((l) => ({ ...l, gate: "you control a dragon" })));
  const twin = withLines(signet, cardLines(signet));
  expect(hasGatedYield(gated)).toBe(true);
  expect(hasGatedYield(twin)).toBe(false);
  expect(hasGatedYield(card("Mox Jasper"))).toBe(true);
  expect(hasGatedYield(card("Sceptre of Eternal Glory"))).toBe(true);
  expect(hasGatedYield(card("Mind Stone"))).toBe(false);
  expect(hasGatedYield(card("Sol Ring"))).toBe(false);
  expect(sameRockAnyColour(signet, twin, dragons)).toBe(true);
  expect(sameRockAnyColour(signet, gated, dragons)).toBe(false);
  expect(sameRockAnyColour(gated, signet, dragons)).toBe(false);
  expect(sameRockAnyColour(gated, withLines(signet, cardLines(signet).map((l) => ({ ...l, gate: "you control a dragon" }))), dragons)).toBe(true);
});

// #1169 2b-2 fix round 2 review: Path of Annihilation (a static grant AND two Eldrazi Spawn) and Cryptolith Rite (a static grant) both add every colour, so the types never fell
// back to the shape and the two shared a group key. The shape of what the card does rides in the key beside the types.
test("a card that grants any colour AND makes tokens is not the group of one that only grants (Path of Annihilation, Cryptolith Rite)", () => {
  const path = card("Path of Annihilation");
  const rite = card("Cryptolith Rite");
  expect(producedManaTypes(path)).toEqual(producedManaTypes(rite));
  expect(groupKey(path, "ramp")).not.toBeNull();
  expect(groupKey(path, "ramp")).not.toBe(groupKey(rite, "ramp"));
});

// #1169 2b-2 fix round 2 (owner 2026-10-13: "gated is conditional same as lands, so it should impact the card quality"): the ramp quality's `restriction` ingredient is the conditional
// penalty a rock already carried ("spend this mana only"); a gated mana line is the same kind of condition, so a gated source rates below the ungated one in every deck.
test("a gated mana source carries the ramp restriction ingredient, an ungated one does not (Mox Jasper, Mox Opal, Sceptre, Sarevok's Tome against Arcane Signet, Mind Stone, Sol Ring)", () => {
  for (const n of ["Mox Jasper", "Mox Opal", "Sceptre of Eternal Glory", "Sarevok's Tome", "Glistening Sphere"] as const) expect(ingredients(card(n), "ramp").restriction, n).toBe(1);
  for (const n of ["Arcane Signet", "Mind Stone", "Sol Ring"] as const) expect(ingredients(card(n), "ramp").restriction, n).toBe(0);
});
