import { expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import type { Ability } from "../schema.js";

/** A STATIC'S STORED `effect.subject` SAYS WHO IT APPLIES TO (#1542, found by the #1364 kindred review). Real oracle text
 *  (Mongo `cards`) and real stored readings (Mongo `cardClauses.canonical`, verbatim), read 2026-11-06. */
function abilitiesOf(name: string, typeLine: string, oracleText: string, records: unknown[]): Ability[] {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  return deriveCardTags(deriveInputOf(card as never, name, name, records as never)).abilities;
}
const grant = (name: string, typeLine: string, text: string, records: unknown[]) => abilitiesOf(name, typeLine, text, records).filter((a) => a.kind === "static");
const g = (object: string) => ({ verb: "grant-ability", object, fromZone: null, toZone: null, amount: null, optional: false });

const doomguide = () => grant("Solemn Doomguide", "Creature — Tiefling Cleric",
  "Flying\nEach creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}. ({1}{B}: Return the card to the battlefield. The creature gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)",
  [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying", fromZone: null, toZone: null }] }, { id: 2, abilityType: "static", actions: [g("unearth {1}{B}")] }]);
const aminatou = () => grant("Aminatou, Veil Piercer", "Legendary Creature — Human Wizard",
  "At the beginning of your upkeep, surveil 2. (Look at the top two cards of your library, then put any number of them into your graveyard and the rest on top of your library in any order.)\nEach enchantment card in your hand has miracle. Its miracle cost is equal to its mana cost reduced by {4}. (You may cast a card for its miracle cost when you draw it if it's the first card you drew this turn.)",
  [{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "surveil", object: "2", fromZone: null, toZone: null, amount: null, optional: false }] }, { id: 2, abilityType: "static", actions: [g("Each enchantment card in your hand gains miracle with a reduced mana cost")] }]);
const planisphere = () => grant("Astrologian's Planisphere", "Artifact — Equipment",
  "Job select (When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.)\nEquipped creature is a Wizard in addition to its other types and has \"Whenever you cast a noncreature spell and whenever you draw your third card each turn, put a +1/+1 counter on this creature.\"\nDiana — Equip {2}",
  [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Job select", fromZone: null, toZone: null }] }, { id: 2, abilityType: "static", actions: [g("Wizard type")] },
    { id: 3, abilityType: "triggered", trigger: { event: "cast", subject: "a noncreature spell", control: "you" }, actions: [{ verb: "add-counter", object: "+1/+1", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 4, abilityType: "none", actions: [{ verb: "none", object: "Equip {2}", fromZone: null, toZone: null }] }]);
const cane = () => grant("Blue Mage's Cane", "Artifact — Equipment",
  "Job select\nEquipped creature gets +0/+2, is a Wizard in addition to its other types, and has \"Whenever this creature attacks, exile up to one target instant or sorcery card from defending player's graveyard. If you do, copy it. You may cast the copy by paying {3} rather than paying its mana cost.\"\nSpirit of the Whalaqee — Equip {2}",
  [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Job select", fromZone: null, toZone: null }] },
    { id: 2, abilityType: "static", actions: [{ verb: "modify-pt", object: "equipped creature", fromZone: null, toZone: null, amount: "+0/+2", optional: false }, g("equipped creature is a Wizard in addition to its other types")] },
    { id: 4, abilityType: "none", actions: [{ verb: "none", object: "Equip {2}", fromZone: null, toZone: null }] }]);
const squire = () => grant("Skyknight Squire", "Creature — Cat Scout",
  "Whenever another creature you control enters, put a +1/+1 counter on this creature.\nAs long as this creature has three or more +1/+1 counters on it, it has flying and is a Knight in addition to its other types.",
  [{ id: 1, abilityType: "triggered", trigger: { event: "enters", subject: "another creature you control", control: "you" }, actions: [{ verb: "add-counter", object: "+1/+1", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 2, abilityType: "static", actions: [g("flying"), { verb: "modify-pt", object: "is a Knight in addition to its other types", fromZone: null, toZone: null, amount: null, optional: false }] }]);
const marshal = () => grant("Field Marshal", "Creature — Human Soldier", "Other Soldier creatures get +1/+1 and have first strike. (They deal combat damage before creatures without first strike.)",
  [{ id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "other Soldier creatures", fromZone: null, toZone: null, amount: "+1/+1", optional: false }, g("other Soldier creatures, first strike")] }]);
const boots = () => grant("Swiftfoot Boots", "Artifact — Equipment", "Equipped creature has hexproof and haste. (It can't be the target of spells or abilities your opponents control. It can attack and {T} no matter when it came under your control.)\nEquip {1} ({1}: Attach to target creature you control. Equip only as a sorcery.)",
  [{ id: 1, abilityType: "static", actions: [g("hexproof"), g("haste")] }, { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Equip {1}", fromZone: null, toZone: null }] }]);

test("zone: a grant to 'creature cards in your graveyard' keeps the graveyard (Solemn Doomguide), and a hand grant its hand (Aminatou)", () => {
  const d = doomguide().find((a) => a.effect.kind === "keyword-grant")!;
  expect(d.effect.subject).toMatchObject({ zone: "graveyard", control: "you", subtype: ["cleric", "rogue", "warrior", "wizard"] });
  expect(d.grants).toEqual(["unearth"]);
  expect(aminatou().find((a) => a.effect.kind === "keyword-grant")!.effect.subject).toMatchObject({ zone: "hand", type: "enchantment" });
});

test("host: 'Equipped creature is a Wizard' is no Wizard lord (Astrologian's Planisphere, Blue Mage's Cane)", () => {
  for (const abs of [planisphere(), cane()]) {
    const hostRows = abs.filter((a) => a.host === true);
    expect(hostRows.length).toBeGreaterThan(0);
    for (const a of hostRows) expect(a.effect.subject?.subtype, a.effect.kind).toBeUndefined();
  }
});

test("self: 'it ... is a Knight in addition to its other types' names no Knight class (Skyknight Squire)", () => {
  for (const a of squire()) expect(a.effect.subject?.subtype, a.effect.kind).toBeUndefined();
  expect(squire().find((a) => a.effect.kind === "pump")?.threshold).toEqual({ atLeast: 3 });
});

test("controls: a real lord keeps its class (Field Marshal), a real Equipment grant is still a host grant (Swiftfoot Boots)", () => {
  expect(marshal().find((a) => a.effect.kind === "pump")!.effect.subject).toMatchObject({ subtype: "soldier", other: true, scope: "all" });
  const b = boots().find((a) => a.effect.kind === "keyword-grant")!;
  expect(b.host).toBe(true);
  expect(b.grants).toEqual(expect.arrayContaining(["hexproof", "haste"]));
});
