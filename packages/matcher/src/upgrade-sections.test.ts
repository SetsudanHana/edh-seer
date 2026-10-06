import { expect, test } from "vitest";
import type { Card } from "@edh-seer/engine";
import { landFacts } from "./land-score.js";
import fixtures from "./same-job.fixtures.json" with { type: "json" };
import { rolesOfCard } from "./quality.js";
import { answerCovers, gameChangerOption, landOptions, newConditions, roleOptions, sameJob, strictlyBetter } from "./upgrade-sections.js";
import type { DeckCard } from "./types.js";

/** Cards as printed (oracle text read 2026-09-30); the text rules read nothing else. */
const card = (name: string, typeLine: string, oracleText: string, producedMana?: string[]): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, ...(producedMana ? { producedMana } : {}) } as Card,
  tags: null,
});

test("strictly better: at least as good everywhere, better somewhere", () => {
  expect(strictlyBetter({ manaValue: 3, timing: 2 }, { manaValue: 1, timing: 2 })).toEqual(["manaValue"]);
  expect(strictlyBetter({ manaValue: 3, timing: 2 }, { manaValue: 1, timing: 0 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3, timing: 2, breadth: 2 }, { manaValue: 1, timing: 2 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3 }, { manaValue: 1, timing: 2 })).toBeNull();
});

test("a second ability is never a gain on its own, but may not be lost", () => {
  expect(strictlyBetter({ manaValue: 3, timing: 1, extraValue: 0 }, { manaValue: 3, timing: 1, extraValue: 1 })).toEqual([]);
  expect(strictlyBetter({ manaValue: 3, timing: 1, extraValue: 1 }, { manaValue: 2, timing: 1, extraValue: 0 })).toBeNull();
});

test("a shuffle is compared only with a shuffle: Boomerang never beats Chaos Warp, and Chaos Warp never replaces Murder", () => {
  expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 0 }, { manaValue: 2, timing: 2, permanence: 1 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 2 }, { manaValue: 2, timing: 2, permanence: 0 })).toBeNull();
  expect(strictlyBetter({ manaValue: 3, timing: 2, permanence: 0 }, { manaValue: 2, timing: 2, permanence: 0 })).toEqual(["manaValue"]);
});

const signet = card("Orzhov Signet", "Artifact", "{1}, {T}: Add {W}{B}.", ["W", "B"]);
const moxAmber = card("Mox Amber", "Legendary Artifact", "{T}: Add one mana of any color among legendary creatures and planeswalkers you control.", ["W", "U", "B", "R", "G"]);
const cribSwap = card("Crib Swap", "Kindred Instant — Shapeshifter", "Changeling (This card is every creature type.)\nExile target creature. Its controller creates a 1/1 colorless Shapeshifter creature token with changeling.");
const swords = card("Swords to Plowshares", "Instant", "Exile target creature. Its controller gains life equal to its power.");

test("a condition the cut does not print is a different card: Mox Amber is not Orzhov Signet", () => {
  expect(newConditions(signet, moxAmber)).toBe(true);
  expect(newConditions(cribSwap, swords)).toBe(false);
});

test("one colour word each: a colorless token does not excuse a black-or-red limit", () => {
  const purge = card("Celestial Purge", "Instant", "Exile target black or red permanent.");
  expect(newConditions(cribSwap, purge)).toBe(true);
});

test("a stat limit must be the same limit: Isolate is not Despark", () => {
  const despark = card("Despark", "Instant", "Exile target permanent with mana value 4 or greater.");
  const isolate = card("Isolate", "Instant", "Exile target permanent with mana value 1.");
  expect(newConditions(despark, isolate)).toBe(true);
});

test("reach the cut has is kept: one creature is not your whole team", () => {
  const formation = card("Unbreakable Formation", "Instant", "Creatures you control gain indestructible until end of turn.");
  const willing = card("Gods Willing", "Instant", "Target creature you control gains protection from the color of your choice until end of turn. Scry 1.");
  expect(newConditions(formation, willing)).toBe(true);
});

test("a trigger must wait for the same thing, the card's own name aside", () => {
  const moldervine = card("Moldervine Reclamation", "Enchantment", "Whenever a creature you control dies, you gain 1 life and draw a card.");
  const season = card("Season of Growth", "Enchantment", "Whenever a creature you control enters, scry 1.\nWhenever you cast a spell that targets a creature you control, draw a card.");
  expect(newConditions(moldervine, season)).toBe(true);
  const a = card("Rock A", "Artifact", "When Rock A enters, draw a card.");
  const b = card("Rock B", "Artifact", "When this artifact enters, draw a card.");
  expect(newConditions(a, b)).toBe(false);
});

test("damage and -N/-N are capped by toughness: Flame-Blessed Bolt is not Swords to Plowshares", () => {
  const bolt = card("Flame-Blessed Bolt", "Instant", "Flame-Blessed Bolt deals 2 damage to target creature or planeswalker. If that creature or planeswalker would die this turn, exile it instead.");
  expect(newConditions(swords, bolt)).toBe(true);
});

test("the same job: never a creature, the same kind of card, and at least the cut's yield", () => {
  const drake = card("Crackling Drake", "Creature — Drake", "When Crackling Drake enters, draw a card.");
  const bolt = card("Divination", "Sorcery", "Draw two cards.");
  const cost = card("Ambition's Cost", "Sorcery", "You draw three cards and you lose 3 life.");
  const insist = card("Insist", "Sorcery", "The next creature spell you cast this turn can't be countered. Draw a card.");
  expect(sameJob(drake, bolt, "draw")).toBe(false);
  expect(sameJob(cribSwap, card("Pacifism", "Enchantment — Aura", "Enchant creature"), "targetedRemoval")).toBe(false);
  expect(sameJob(cost, insist, "draw")).toBe(false);
});

test("ramp keeps every colour the cut makes", () => {
  const talisman = card("Talisman of Progress", "Artifact", "{T}: Add {C}.\n{T}: Add {W} or {U}. Talisman of Progress deals 1 damage to you.", ["C", "W", "U"]);
  const mindStone = card("Mind Stone", "Artifact", "{T}: Add {C}.", ["C"]);
  expect(sameJob(signet, mindStone, "ramp")).toBe(false);
  expect(sameJob(mindStone, talisman, "ramp")).toBe(false);
});

test("an answer covers the cut's card types with no new limit", () => {
  const creature = [{ type: "creature", control: "opp" }];
  expect(answerCovers(creature, [{ type: "permanent", notType: ["land"], control: "opp" }])).toBe(true);
  expect(answerCovers(creature, [{ type: "enchantment", control: "opp" }])).toBe(false);
  expect(answerCovers(creature, [{ type: ["creature", "enchantment"], subtype: "spirit", control: "opp" }])).toBe(false);
});

const needed = new Set(["W", "B"] as const);
const land = (name: string, typeLine: string, oracleText: string, producedMana: string[]) => {
  const dc = card(name, typeLine, oracleText, producedMana);
  return { facts: landFacts(dc, needed, []), dc, gameChanger: false };
};
const temple = land("Temple of Silence", "Land", "Temple of Silence enters tapped.\nWhen Temple of Silence enters, scry 1.\n{T}: Add {W} or {B}.", ["W", "B"]);
const chapel = land("Isolated Chapel", "Land", "Isolated Chapel enters tapped unless you control a Plains or a Swamp.\n{T}: Add {W} or {B}.", ["W", "B"]);
const plains = land("Plains", "Basic Land — Plains", "({T}: Add {W}.)", ["W"]);

test("a tapped dual gives way to a check land; the shock-style condition is what tapped measures", () => {
  expect(landOptions([temple], [chapel], 0).map((o) => [o.cut, o.options.map((x) => x.add)])).toEqual([["Temple of Silence", ["Isolated Chapel"]]]);
});

test("never adds a two-faced land, an artifact land, or one whose extra lines carry a condition", () => {
  const pathway = land("Brightclimb Pathway // Grimclimb Pathway", "Land // Land", "{T}: Add {W}.\n//\n{T}: Add {B}.", ["W", "B"]);
  const den = land("Ancient Den", "Artifact Land", "{T}: Add {W}.", ["W"]);
  const grove = land("Grove of the Burnwillows", "Land", "{T}: Add {C}.\n{T}: Add {W} or {B}. Each opponent gains 1 life.", ["C", "W", "B"]);
  expect(landOptions([temple, plains], [pathway, den, grove], 0)).toEqual([]);
});

test("basics are cut last, and never below the floor; a land that is sometimes tapped never replaces one that never is", () => {
  const plainsB = land("Plains", "Basic Land — Plains", "({T}: Add {W}.)", ["W"]);
  const scrubland = land("Scrubland", "Land — Plains Swamp", "({T}: Add {W} or {B}.)", ["W", "B"]);
  expect(landOptions([temple, plains, plainsB], [chapel, scrubland], 0).map((o) => [o.cut, o.options.map((x) => x.add)]))
    .toEqual([["Temple of Silence", ["Scrubland", "Isolated Chapel"]], ["Plains", ["Scrubland"]]]);
  expect(landOptions([temple, plains, plainsB], [chapel, scrubland], 2).map((o) => o.cut)).toEqual(["Temple of Silence"]);
});

test("a land whose mana comes on a condition is never cut: Exotic Orchard is not colourless", () => {
  const orchard = land("Exotic Orchard", "Land", "{T}: Add one mana of any color that a land an opponent controls could produce.", ["W", "U", "B", "R", "G"]);
  expect(orchard.facts.utility).toContain("conditional-mana");
  expect(landOptions([orchard], [chapel], 0)).toEqual([]);
});

/** Cards as the corpus derives them (tags read 2026-10-03), for the Game Changer upgrade. */
const real = (name: keyof typeof fixtures) => fixtures[name] as unknown as DeckCard;
const candidate = (d: DeckCard) => ({ dc: d, roles: rolesOfCard(d), links: 0 });
const rated = (q: Record<string, number>) => (name: string) => q[name] ?? -1;

test("a Game Changer upgrade: the same group, rated higher, and only a Game Changer", () => {
  const signet = real("Arcane Signet");
  const quality = rated({ "Arcane Signet": 92, "Mana Vault": 98, "Mox Diamond": 98, "Painful Truths": 80 });
  const vault = gameChangerOption("ramp", signet, candidate(real("Mana Vault")), quality);
  expect(vault).toMatchObject({ add: "Mana Vault", role: "ramp", gameChanger: true, upgrade: "game-changer", gained: [] });
  // Rated lower than the cut: Sol Ring is not traded for anything.
  expect(gameChangerOption("ramp", signet, candidate(real("Mana Vault")), rated({ "Arcane Signet": 99, "Mana Vault": 98 }))).toBeNull();
  // Not a Game Changer: the strict rule's to judge.
  expect(gameChangerOption("ramp", signet, candidate(real("Arcane Signet")), quality)).toBeNull();
  // Once is not every turn: Lion's Eye Diamond and Jeska's Will never replace a Signet.
  for (const once of ["Lion's Eye Diamond", "Jeska's Will"] as const) {
    expect(gameChangerOption("ramp", signet, candidate(real(once)), rated({ "Arcane Signet": 92, [once]: 99 }))).toBeNull();
  }
  // Not the section's job.
  expect(gameChangerOption("consistency", signet, candidate(real("Mana Vault")), quality)).toBeNull();
});

test("a cut's Game Changer upgrades come before its strict options, strongest first", () => {
  const quality = rated({ "Arcane Signet": 92, "Mana Vault": 97, "Mox Diamond": 98 });
  const [only] = roleOptions("ramp", [real("Arcane Signet")], [], { pool: [candidate(real("Mana Vault")), candidate(real("Mox Diamond"))], quality });
  expect(only!.options.map((o) => o.add)).toEqual(["Mox Diamond", "Mana Vault"]);
  expect(roleOptions("ramp", [real("Arcane Signet")], [])).toEqual([]);
});

/** AN UNREAD AMOUNT IS NOT A WORSE ONE (review of #1051): the add's X or conditional amount leaves
 *  `amount` unset, and the swap is still judged on everything else. A smaller amount still refuses. */
test("strictlyBetter skips an amount the add cannot state, and refuses a smaller one", () => {
  expect(strictlyBetter({ manaValue: 2, timing: 1, amount: 2, rateFloor: 50 }, { manaValue: 1, timing: 1, rateFloor: 90 })).toEqual(["manaValue", "rateFloor"]);
  expect(strictlyBetter({ manaValue: 2, timing: 1, amount: 2 }, { manaValue: 1, timing: 1, amount: 1 })).toBeNull();
});
