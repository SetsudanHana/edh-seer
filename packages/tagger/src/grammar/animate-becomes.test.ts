import { expect, test } from "vitest";
import { deriveCardTags } from "../derive/derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "./clause-record.js";

/** #1352: the grammar's `animate` carries the becomes-phrase, as the stored model answer writes it ("this as a 3/6 Golem artifact creature"). Oracle text is the corpus's (Scryfall), the
 *  expected subjects the STORED derive's, read from Mongo `cardTagsDerived` before the change (clauseSource model) unless a case says it is an improvement. */
const animates = (name: string, typeLine: string, oracleText: string) => {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card, name, name, g.records, undefined, g.readings));
  return { subjects: tags.abilities.filter((a) => a.effect?.kind === "animate").map((a) => a.effect.subject), kinds: tags.abilities.map((a) => a.effect?.kind) };
};
const stats = (p: number, t: number) => [{ metric: "power", op: "eq", value: p }, { metric: "toughness", op: "eq", value: t }];

test("Jade Statue: the grammar's animate equals the stored one, and there is no separate pump", () => {
  const r = animates("Jade Statue", "Artifact", "{2}: This artifact becomes a 3/6 Golem artifact creature until end of combat. Activate only during combat.");
  expect(r.subjects).toEqual([{ control: "any", token: null, type: ["creature", "artifact"], allTypes: ["artifact", "creature"], subtype: "golem", stats: stats(3, 6), self: true }]);
  expect(r.kinds).not.toContain("pump");
});

test("Simic Keyrune: colours, subtype, stats and the 'with' keyword are in the animate", () => {
  const r = animates("Simic Keyrune", "Artifact", "{T}: Add {G} or {U}.\n{G}{U}: This artifact becomes a 2/3 green and blue Crab artifact creature with hexproof until end of turn. (It can't be the target of spells or abilities your opponents control.)");
  expect(r.subjects).toEqual([{ control: "any", token: null, keyword: ["hexproof"], colors: ["U", "G"], type: ["creature", "artifact"], allTypes: ["artifact", "creature"], subtype: "crab", stats: stats(2, 3), self: true }]);
  expect(r.kinds).not.toContain("keyword-grant");
});

test("Raging Ravine: 'It's still a land' keeps the land type (stored: [creature, land])", () => {
  const r = animates("Raging Ravine", "Land", "This land enters tapped.\n{T}: Add {R} or {G}.\n{2}{R}{G}: Until end of turn, this land becomes a 3/3 red and green Elemental creature with \"Whenever this creature attacks, put a +1/+1 counter on it.\" It's still a land.");
  expect(r.subjects).toEqual([{ control: "any", token: null, colors: ["R", "G"], type: ["creature", "land"], subtype: "elemental", stats: stats(3, 3), self: true }]);
});

test("Gideon, Ally of Zendikar: stored type and subtypes, and the card itself (the stored subject lacked self)", () => {
  const r = animates("Gideon, Ally of Zendikar", "Legendary Planeswalker — Gideon", "+1: Until end of turn, Gideon becomes a 5/5 Human Soldier Ally creature with indestructible that's still a planeswalker. Prevent all damage that would be dealt to him this turn.\n0: Create a 2/2 white Knight Ally creature token.\n−4: You get an emblem with \"Creatures you control get +1/+1.\"");
  expect(r.subjects).toEqual([{ control: "any", token: null, keyword: ["indestructible"], type: ["creature", "planeswalker"], subtype: ["human", "soldier", "ally"], stats: stats(5, 5), self: true }]);
});

test("Opal Guardian: a strict improvement on the stored {type: permanent}: the Gargoyle creature, its stats and flying", () => {
  const r = animates("Opal Guardian", "Enchantment", "When an opponent casts a creature spell, if this permanent is an enchantment, this enchantment becomes a 3/4 Gargoyle creature with flying and protection from red.");
  expect(r.subjects).toEqual([{ control: "any", token: null, keyword: ["flying"], type: "creature", subtype: "gargoyle", stats: stats(3, 4), self: true }]);
  // "protection from red" stays its own grant: its colour word would read as the animated permanent's colour.
  expect(r.kinds).toContain("keyword-grant");
});

test("Tawnos's Tinkering: the target class the clause named, plus the 0/0 result", () => {
  const r = animates("Tawnos's Tinkering", "Sorcery", "Put two +1/+1 counters on target artifact, creature, or land you control. Untap that permanent. If it isn't a creature, it becomes a 0/0 creature in addition to its other types.");
  expect(r.subjects).toEqual([{ control: "you", token: null, type: ["creature", "artifact", "land"], scope: "target", stats: stats(0, 0) }]);
});

// Haunted Screen's stored subject also carries scope "all", read off the plural 'types' of "in addition to its other types": a class claim for one card, left off a pronoun's animate.
test("Haunted Screen, Sage of the Maze, Ebony Fly: the stored subjects", () => {
  expect(animates("Haunted Screen", "Artifact", "{T}: Add {W} or {B}.\n{T}, Pay 1 life: Add {G}, {U}, or {R}.\n{7}: Put seven +1/+1 counters on this artifact. It becomes a 0/0 Spirit creature in addition to its other types. Activate only once.").subjects)
    .toEqual([{ control: "any", token: null, type: "creature", subtype: "spirit", stats: stats(0, 0) }]);
  expect(animates("Sage of the Maze", "Creature — Human Wizard", "{T}: Add two mana in any combination of colors.\n{T}: Until end of turn, target land you control becomes an X/X Citizen creature with haste in addition to its other types, where X is twice the number of Gates you control. Activate only as a sorcery.\nTap an untapped Gate you control: Untap this creature.").subjects)
    .toEqual([{ control: "you", token: null, keyword: ["haste"], type: ["creature", "land"], subtype: "citizen", scope: "target" }]);
  expect(animates("Ebony Fly", "Artifact", "This artifact enters tapped.\n{T}: Add {C}.\n{4}: Roll a d6. Until end of turn, you may have this artifact become an X/X Insect artifact creature with flying, where X is the result.\nWhenever this artifact attacks, another target attacking creature gains flying until end of turn.").subjects)
    .toEqual([{ control: "any", token: null, keyword: ["flying"], type: ["creature", "artifact"], allTypes: ["artifact", "creature"], subtype: "insect", self: true }]);
});

test("a Vehicle that becomes an artifact creature is still a Vehicle (Voyager Glidecar's stored subtype)", () => {
  const r = animates("Voyager Glidecar", "Artifact — Vehicle", "When this Vehicle enters, scry 1.\nTap three other untapped creatures you control: Until end of turn, this Vehicle becomes an artifact creature and gains flying. Put a +1/+1 counter on it.\nCrew 1");
  expect(r.subjects).toEqual([{ control: "any", token: null, type: ["creature", "artifact"], allTypes: ["artifact", "creature"], subtype: "vehicle", self: true }]);
});

// An UPCOMING card has no stored reading: derive reads the grammar alone, and its animate used to carry no creature type. Worf is in the corpus with no clause doc (clauseSource grammar).
test("a grammar-only card's animate derives the creature type it becomes (Worf, Intelligence Contractor; I'm a Doctor, Not a . . .)", () => {
  expect(animates("Worf, Intelligence Contractor", "Legendary Creature — Klingon Warrior Spy", "When Worf enters, for each opponent, gain control of up to one target creature that player controls with mana value 3 or less until end of turn. Untap those creatures. Until end of turn, they become Warriors in addition to their other types and gain haste.").subjects[0])
    .toMatchObject({ subtype: "warrior", scope: "all" });
  expect(animates("I'm a Doctor, Not a . . .", "Instant", "Put a +1/+1 counter on target creature you control. Untap it. Until end of turn, it gets +1/+1 and becomes a Doctor. (It loses all other creature types.)").subjects[0])
    .toMatchObject({ control: "you", type: "creature", subtype: "doctor", scope: "target" });
});

// claude-mem #33838: the store has no animate shape for a colour, a supertype or a choice (its objects for these are modify-pt, grant-ability and other), so none is read into the animate.
test("'becomes blue', 'are colorless', 'are no longer snow' and 'the color of your choice' add no colour or snow to the animate", () => {
  for (const [text, bad] of [
    ["Whenever this creature blocks or becomes blocked by a creature, that creature becomes green.", "colors"],
    ["All permanents are colorless.", "colors"],
    ["All lands are no longer snow.", "snow"],
    ["Lands you control and land cards in your library are basic.", "basic"],
  ] as const) {
    const r = animates("Colour", "Enchantment", text);
    for (const s of r.subjects) expect(s ?? {}, text).not.toHaveProperty(bad);
  }
});

// `staticEdges` (matcher) takes a static's subject as WHO IT APPLIES TO. "All lands are 2/2 creatures" with the result in the subject would be the union creature-or-land, every creature in the deck.
test("a static keeps the target alone and the separate grants", () => {
  const revolt = animates("Nature's Revolt", "Enchantment", "All lands are 2/2 creatures that are still lands.");
  expect(revolt.subjects).toEqual([{ control: "any", token: null, type: "land", scope: "all" }]);
  expect(animates("Blood Moon", "Enchantment", "Nonbasic lands are Mountains.").subjects).toEqual([{ control: "any", token: null, type: "land", scope: "all", basic: false }]);
  // A self static loses its subject in derive and the grant folded into it would go too (Warden of the Wall's flying): never folded.
  expect(animates("Warden of the Wall", "Artifact", "This artifact enters tapped.\n{T}: Add {C}.\nDuring turns other than yours, this artifact is a 2/3 Gargoyle artifact creature with flying.").kinds).toContain("keyword-grant");
});

test("a plural subtype is a result (Worf's 'become Warriors'), a bare 'colorless sources of damage' is not (Ghostly Flame)", () => {
  expect(animates("Ghostly Flame", "Enchantment", "Black and/or red permanents and spells are colorless sources of damage.").subjects[0]).not.toHaveProperty("subtype");
});

// "in addition to its other types" on the card itself: derive reads "other" as NOT the card (isSelfSubject) and "types" as a class, so the words made every Illusion of it. Left off a self animate.
test("a self animate keeps no 'in addition to its other types'; it stays the card itself (Halcyon Glaze)", () => {
  const r = animates("Halcyon Glaze", "Enchantment", "Whenever you cast a creature spell, this enchantment becomes a 4/4 Illusion creature with flying in addition to its other types until end of turn.");
  expect(r.subjects).toEqual([{ control: "any", token: null, keyword: ["flying"], type: "creature", subtype: "illusion", stats: stats(4, 4), self: true }]);
  // ...and 'it becomes an Aura with enchant creature' (Rageform) claims no creature.
  expect(animates("Rageform", "Enchantment", "When this enchantment enters, it becomes an Aura with enchant creature. Manifest the top card of your library and attach this enchantment to it. (To manifest a card, put it onto the battlefield face down as a 2/2 creature. Turn it face up any time for its mana cost if it's a creature card.)\nEnchanted creature has double strike. (It deals both first-strike and regular combat damage.)").subjects[0]).not.toMatchObject({ type: "creature" });
});

// "it" and "that land" are resolved before the becomes-phrase is put back: the card itself (the Opal cycle's "if this permanent is an enchantment, it becomes ..."), or the class an earlier action named.
test("'it becomes' is the card itself in the Opal cycle, and 'that land becomes' keeps the target class an earlier action named", () => {
  expect(animates("Hidden Predators", "Enchantment", "When an opponent controls a creature with power 4 or greater, if this permanent is an enchantment, it becomes a 4/4 Beast creature.").subjects)
    .toEqual([{ control: "any", token: null, type: "creature", subtype: "beast", stats: stats(4, 4), self: true }]);
  expect(animates("Rootwise Survivor", "Creature — Elf Druid", "Haste\nSurvival — At the beginning of your second main phase, if this creature is tapped, put three +1/+1 counters on up to one target land you control. That land becomes a 0/0 Elemental creature in addition to its other types. It gains haste until your next turn.").subjects)
    .toEqual([{ control: "you", token: null, type: ["creature", "land"], subtype: "elemental", scope: "target", stats: stats(0, 0) }]);
});
