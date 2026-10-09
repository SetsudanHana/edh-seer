import { expect, test } from "vitest";
import type { LandFacts } from "./land-score.js";
import { REASON_MAX, bringDownReason, fillReasons, gameChangerReasons, landReasons, roleReasons, synergyReasons } from "./upgrade-reasons.js";
import type { LandOption, RoleOption } from "./upgrade-sections.js";

const roleOpt = (add: string, over: Partial<RoleOption> = {}): RoleOption => ({
  add, role: "targetedRemoval", gained: ["manaValue"], cut: { manaValue: 3, timing: 2 }, addIngredients: { manaValue: 1, timing: 2 }, gameChanger: false, links: 0, ...over,
});
const lf = (name: string, tapped: 0 | 1 | 2, colours: string[]): LandFacts => ({ name, colours: colours as LandFacts["colours"], tapped, utility: [], hurts: false, basic: false, front: true });

test("reasons name what was gained, on both sides, within the limit", () => {
  const r = roleReasons("Crib Swap", roleOpt("Swords to Plowshares", { gained: ["manaValue", "drawback"], cut: { manaValue: 3, timing: 2, drawback: 1 }, addIngredients: { manaValue: 1, timing: 2, drawback: 0 } }));
  expect(r.in).toBe("Swords to Plowshares is the same removal for 2 less mana and gives the opponent nothing back.");
  expect(r.out).toBe("Crib Swap costs 3 where Swords to Plowshares costs 1 and gives the opponent something back.");
  const long = roleReasons("A".repeat(80), roleOpt("B".repeat(80)));
  expect(long.in.length).toBeLessThanOrEqual(REASON_MAX);
  expect(long.out.length).toBeLessThanOrEqual(REASON_MAX);
});

test("land reasons say tapped and colours in plain words", () => {
  const o: LandOption = { add: "Isolated Chapel", cut: lf("Temple of Silence", 2, ["W", "B"]), addFacts: lf("Isolated Chapel", 1, ["W", "B"]), untapped: true, colours: [], gameChanger: false };
  expect(landReasons(o)).toEqual({ out: "Temple of Silence enters tapped.", in: "Isolated Chapel enters tapped less often and makes white or black." });
});

test("draw reasons count the cards, and card search is said in player words", () => {
  const r = roleReasons("Divination", roleOpt("Night's Whisper", { role: "draw", gained: ["manaValue", "rateFloor"], cut: { manaValue: 3, timing: 0, rateFloor: 40 }, addIngredients: { manaValue: 2, timing: 0, rateFloor: 60 } }));
  expect(r.in).toBe("Night's Whisper is the same card draw for 1 less mana and with more cards for the mana.");
  expect(r.out).toBe("Divination costs 3 where Night's Whisper costs 2 and gets fewer cards for the mana.");
  expect(roleReasons("Diabolic Tutor", roleOpt("Demonic Tutor", { role: "tutor" })).in).toContain("the same card search");
});

test("a bring-down cut says what the bracket allows, and explains the Game Changer list", () => {
  expect(bringDownReason({ name: "Smothering Tithe", why: { kind: "game-changer", limit: 0, count: 1 } }, 2))
    .toBe("Smothering Tithe is on the official Game Changer list, which raises a deck's bracket; bracket 1–2 allows none, and this deck has 1.");
  expect(bringDownReason({ name: "Isochron Scepter", why: { kind: "combo", with: ["Dramatic Reversal"], result: "Infinite mana" } }, 3))
    .toBe("With Dramatic Reversal, Isochron Scepter makes an infinite combo, which bracket 3 doesn't allow.");
});

test("a synergy pair reads both counts, and keeps the engine's own sentence", () => {
  const side = (name: string, partners: number, onTheme: number, commander = false) => ({ name, partners, onTheme, commander });
  expect(synergyReasons(side("Stick Together", 13, 2), { ...side("Pious Evangel", 9, 7), reason: "Pious Evangel puts cards into the graveyard" }))
    .toEqual({ out: "Stick Together works with 13 cards in this deck, 2 of them on its theme; Pious Evangel works with 9 cards, 7 of them on it.", in: "Pious Evangel puts cards into the graveyard" });
  // What can make a card with fewer links the stronger one is said, never left to a count.
  expect(synergyReasons(side("Jazal Goldmane", 16, 0), { ...side("Daxos", 4, 0, true), reason: "r" }).out)
    .toBe("Jazal Goldmane works with 16 cards in this deck, none of them on its theme; Daxos works with 4 cards, none of them on it, and with your commander.");
});

test("a Game Changer upgrade says what was checked, explains the term, and fits the limit", () => {
  const o = { add: "Mox Diamond", role: "ramp", gained: [], cut: {}, addIngredients: {}, gameChanger: true, links: 0, upgrade: "game-changer" } as RoleOption;
  const r = gameChangerReasons("Arcane Signet", o);
  expect(r.out).toBe("Arcane Signet is weaker ramp than Mox Diamond.");
  expect(r.in).toBe("Mox Diamond is ramp too, and one of the strongest cards in Commander: a Game Changer, which this bracket allows.");
  const long = gameChangerReasons("Kaho, Minamo Historian's Very Long Name Indeed", { ...o, add: "Jace, the Mind Sculptor's Even Longer Imaginary Name" });
  expect(long.in.length).toBeLessThanOrEqual(REASON_MAX);
});

test("a colour swap says which colour the deck is short of, on both sides", () => {
  const r = roleReasons("Fire Diamond", roleOpt("Talisman of Creativity", { role: "ramp", gained: [], colour: ["U"] }));
  expect(r.in).toBe("Talisman of Creativity is the same ramp and makes blue, which the deck is short of for its spells.");
  expect(r.out).toBe("Fire Diamond doesn't make blue, which the deck is short of for its spells.");
  expect(roleReasons("A", roleOpt("B", { role: "ramp", gained: [], colour: ["U", "R"] })).in).toContain("makes blue and red, which");
});

test("a colour swap that gives up a role says so, on both sides", () => {
  const r = roleReasons("Mind Stone", roleOpt("Izzet Signet", { role: "ramp", gained: [], colour: ["U"], lost: ["draw"] }));
  expect(r.out).toBe("Mind Stone also does card draw, and doesn't make blue, which the deck is short of for its spells.");
  expect(r.in).toBe("Izzet Signet is the same ramp and makes blue, which the deck is short of for its spells, but does not do card draw.");
});

test("a swap toward a type the deck's payoffs watch says so", () => {
  const r = roleReasons("Mind Stone", roleOpt("Fertile Ground", { role: "ramp", gained: [], colour: ["G"], crossType: "enchantment" }));
  expect(r.in).toBe("Fertile Ground is the same ramp and makes green, which the deck is short of for its spells, and it's an enchantment, which your enchantment payoffs count.");
});

test("a dork swap that keeps a themed creature type says it is still one", () => {
  const r = roleReasons("Llanowar Elves", roleOpt("Mystic of the Deep", { role: "ramp", gained: [], colour: ["U"], keptType: "elf" }));
  expect(r.in).toBe("Mystic of the Deep is the same ramp and makes blue, which the deck is short of for its spells, and it's still an Elf.");
});

test("a fetch-spell swap says the add can find a land of the short colour", () => {
  const r = roleReasons("Rampant Growth", roleOpt("Farseek", { role: "ramp", gained: [], colour: ["G"], fetch: true }));
  expect(r.in).toBe("Farseek can find a land that makes green, which the deck is short of for its spells.");
  expect(r.out).toBe("Rampant Growth can't find a land that makes green, which the deck is short of for its spells.");
});

test("a fetch swap that gives up a role says so", () => {
  const r = roleReasons("Mwonvuli Acid-Moss", roleOpt("Farseek", { role: "ramp", gained: [], colour: ["G"], fetch: true, lost: ["targetedRemoval"] }));
  expect(r.out).toBe("Mwonvuli Acid-Moss also does removal, and can't find a land that makes green, which the deck is short of for its spells.");
  expect(r.in).toBe("Farseek can find a land that makes green, which the deck is short of for its spells, but does not do removal.");
});

test("a fill says how short the deck was and why the cut is the weakest card", () => {
  const r = fillReasons({ label: "Ramp", short: 2 }, "Weak A", "Works with 1 other card in this deck.", { name: "Fellwar Stone", reason: "Fellwar Stone makes mana for the colours your commander asks for." });
  expect(r.out).toBe("Weak A is the weakest card here. Works with 1 other card in this deck.");
  expect(r.in).toBe("Ramp: you were 2 short; Fellwar Stone makes mana for the colours your commander asks for.");
  const long = fillReasons({ label: "Ramp", short: 2 }, "Weak A", "x".repeat(200), { name: "Fellwar Stone", reason: "y".repeat(200) });
  expect(long.out.length).toBeLessThanOrEqual(REASON_MAX);
  expect(long.in).toBe("Ramp: you were 2 short; Fellwar Stone fills the gap.");
});
