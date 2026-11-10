import { expect, test } from "vitest";
import { caresAboutCreatureType, deckLandTypes, deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
import type { CardTags } from "@edh-seer/tagger";
import type { Hierarchy } from "./types.js";

const chars = (subtypes: string[]) => ({
  types: ["creature"], subtypes, colors: [], identity: [], cmc: 1,
  power: null, toughness: null, token: false, keywords: [],
});
const tagsWith = (subtypes: string[], abilities: CardTags["abilities"] = []): CardTags => ({
  oracleId: "x", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: chars(subtypes), abilities,
});

const NO_HIERARCHY: Hierarchy = {};

test("deckSubtypeCounts tallies subtypes across all deck cards", () => {
  const counts = deckSubtypeCounts([
    { card: { name: "Adeliz" } as never, tags: tagsWith(["wizard"]) },
    { card: { name: "Naru Meha" } as never, tags: tagsWith(["wizard", "human"]) },
    { card: { name: "Untagged" } as never, tags: null },
  ]);
  expect(counts.get("wizard")).toBe(2);
  expect(counts.get("human")).toBe(1);
});

/** ONE VOTE PER DISTINCT CARD. `inputs` is one entry per COPY, and basic land types ARE subtypes,
 *  so counting slots let a deck's basics outvote the tribe it is built on -- `island` 24 to
 *  `dragon` 22 on the calibration corpus's `draguns`, which made every "choose a creature type"
 *  card in it choose a land and match nothing. */
test("a card's copies vote once, so basics cannot outvote a tribe", () => {
  const dragon = { card: { name: "Icefall Regent" } as never, tags: tagsWith(["dragon"]) };
  const counts = deckSubtypeCounts([
    dragon,
    { card: { name: "Hraesvelgr" } as never, tags: tagsWith(["dragon"]) },
    ...Array.from({ length: 24 }, () => (
      { card: { name: "Island" } as never, tags: tagsWith(["island"]) }
    )),
  ]);
  expect(counts.get("island")).toBe(1);
  expect(counts.get("dragon")).toBe(2);
});

test("resolveChosenTypes substitutes the deck's top subtype and drops chosenType (no type constraint)", () => {
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  const counts = new Map([["wizard", 5], ["human", 2]]);
  const resolved = resolveChosenTypes(tags, counts, NO_HIERARCHY);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("wizard");
  expect(subj.chosenType).toBeUndefined();
});

test("resolveChosenTypes resolves a doubler's WHOSE class too (Roaming Throne)", () => {
  const tags = tagsWith([], [
    { kind: "static", effect: { kind: "trigger-doubling" }, doublesOf: { control: "you", token: null, chosenType: true } },
  ]);
  const resolved = resolveChosenTypes(tags, new Map([["elemental", 9], ["human", 2]]), NO_HIERARCHY);
  expect(resolved.abilities[0].doublesOf).toEqual({ control: "you", token: null, subtype: "elemental" });
});

test("unresolvable chosenType (no deck subtypes) yields a subtype that matches nothing", () => {
  const tags = tagsWith([], [
    { kind: "static", effect: { kind: "pump", subject: { control: "you", token: null, chosenType: true } } },
  ]);
  const resolved = resolveChosenTypes(tags, new Map(), NO_HIERARCHY);
  expect(resolved.abilities[0].effect.subject!.subtype).toBe("__none__");
  expect(resolved.abilities[0].effect.subject!.chosenType).toBeUndefined();
});

test("chosenType with a type constraint picks the top subtype among legal types, not the global top", () => {
  const hierarchy: Hierarchy = { wizard: ["creature"], zombie: ["creature"], treasure: ["artifact"] };
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  // treasure is the global top by far, but it's not a creature subtype.
  const counts = new Map([["treasure", 10], ["wizard", 3], ["zombie", 1]]);
  const resolved = resolveChosenTypes(tags, counts, hierarchy);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("wizard");
  expect(subj.chosenType).toBeUndefined();
});

test("chosenType with a type constraint and no legal candidate resolves to the match-nothing sentinel", () => {
  const hierarchy: Hierarchy = { treasure: ["artifact"] };
  const tags = tagsWith([], [
    {
      kind: "triggered",
      trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, chosenType: true } },
      effect: { kind: "draw-card" },
    },
  ]);
  // Deck has plenty of subtypes, but none of them imply "creature".
  const counts = new Map([["treasure", 10]]);
  const resolved = resolveChosenTypes(tags, counts, hierarchy);
  const subj = resolved.abilities[0].trigger!.subject;
  expect(subj.subtype).toBe("__none__");
  expect(subj.chosenType).toBeUndefined();
});

test("chosenType with an OR type constraint (string[]) considers subtypes legal for any listed type", () => {
  const hierarchy: Hierarchy = { wizard: ["creature"], treasure: ["artifact"] };
  const tags = tagsWith([], [
    {
      kind: "static",
      effect: {
        kind: "pump",
        subject: { type: ["artifact", "creature"], control: "you", token: null, chosenType: true },
      },
    },
  ]);
  const counts = new Map([["treasure", 2], ["wizard", 1]]);
  const resolved = resolveChosenTypes(tags, counts, hierarchy);
  expect(resolved.abilities[0].effect.subject!.subtype).toBe("treasure");
});

// OWNER RULING 2026-09-16 (recall v6 #197): an untyped land put resolves against the deck's lands.
test("deckLandTypes lists the deck's land subtypes, and the basics alone", () => {
  const land = (types: string[], subtypes: string[]): CardTags => ({
    ...tagsWith(subtypes), characteristics: { ...chars(subtypes), types },
  });
  const out = deckLandTypes([
    { card: { name: "Mountain" } as never, tags: land(["basic", "land"], ["mountain"]) },
    { card: { name: "Smoldering Marsh" } as never, tags: land(["land"], ["swamp", "mountain"]) },
    { card: { name: "Grizzly Bears" } as never, tags: tagsWith(["bear"]) },
    { card: { name: "Untagged" } as never, tags: null },
  ]);
  expect(out).toEqual({ any: ["mountain", "swamp"], basic: ["mountain"] });
});

// #1360: a chosen COLOUR is not a chosen type. Heraldic Banner's "creatures you control of the chosen color" must
// never become "creatures you control of the deck's top subtype".
test("resolveChosenTypes never resolves a chosenColor subject to a subtype, and a chosenType beside it still resolves", () => {
  const counts = new Map([["elf", 5], ["goblin", 2]]);
  const color = { type: "creature", control: "you", token: null, scope: "all", chosenColor: true } as never;
  const type = { type: "creature", control: "you", token: null, chosenType: true } as never;
  const resolved = resolveChosenTypes(tagsWith(["artifact"], [
    { kind: "static", effect: { kind: "pump", subject: color } },
    { kind: "static", effect: { kind: "pump", subject: type } },
  ] as never), counts, NO_HIERARCHY);
  const [c, t] = resolved.abilities.map((a) => a.effect.subject!);
  expect(c!.subtype).toBeUndefined();
  expect(c!.chosenColor).toBe(true);
  expect(t!.subtype).toBeDefined();
  expect(t!.chosenType).toBeUndefined();
});

// #1360 round 2: a chosen colour is one of the five, so a colourless object is never in it. Real corpus cards (2026-11-01):
// Shard of the Nightbringer is black, Canoptek Spyder / Sol Ring / Metallic Mimic are colourless artifacts.
import { subjectMatches } from "./subject.js";
import type { SubjectFilter } from "@edh-seer/tagger";

const obj = (colors: string[], type: string): SubjectFilter => ({ control: "you", token: null, type, colors });
const SHARD = obj(["B"], "creature");
const SPYDER = obj([], "creature");
const resolveOne = (subject: SubjectFilter, identity?: string[]): SubjectFilter =>
  resolveChosenTypes(tagsWith([], [{ kind: "static", effect: { kind: "pump", subject } }] as never), new Map(), NO_HIERARCHY, identity).abilities[0]!.effect.subject!;
const cagedSun: SubjectFilter = { type: "creature", control: "you", token: null, scope: "all", chosenColor: true } as never;

test("Caged Sun in a mono-black deck pumps Shard of the Nightbringer and not Canoptek Spyder", () => {
  const s = resolveOne(cagedSun, ["B"]);
  expect(s.colors).toEqual(["B"]);
  expect(s.chosenColor).toBeUndefined();
  expect(subjectMatches(SHARD, s, NO_HIERARCHY)).toBe(true);
  expect(subjectMatches(SPYDER, s, NO_HIERARCHY)).toBe(false);
});

test("a multicolour deck resolves to any-of its identity", () => {
  const s = resolveOne(cagedSun, ["W", "U", "B"]);
  expect(subjectMatches(obj(["U"], "creature"), s, NO_HIERARCHY)).toBe(true);
  expect(subjectMatches(obj(["R"], "creature"), s, NO_HIERARCHY)).toBe(false);
});

test("Prism Ring does not fire on Sol Ring, resolved or not", () => {
  const ring: SubjectFilter = { type: "spell", control: "you", token: null, chosenColor: true } as never;
  const solRing = obj([], "spell");
  expect(subjectMatches(solRing, resolveOne(ring, ["G"]), NO_HIERARCHY)).toBe(false);
  expect(subjectMatches(solRing, resolveOne(ring), NO_HIERARCHY)).toBe(false);
  expect(subjectMatches(obj(["G"], "spell"), resolveOne(ring), NO_HIERARCHY)).toBe(true);
});

test("Heraldic Banner does not pump Metallic Mimic, in a colourless deck either", () => {
  const banner: SubjectFilter = { type: "creature", control: "you", token: null, scope: "all", chosenColor: true } as never;
  const mimic = obj([], "creature");
  expect(subjectMatches(mimic, resolveOne(banner, ["R"]), NO_HIERARCHY)).toBe(false);
  const none = resolveOne(banner, []);
  expect(none.colorCount).toBe("colored");
  expect(subjectMatches(mimic, none, NO_HIERARCHY)).toBe(false);
  expect(subjectMatches(SHARD, none, NO_HIERARCHY)).toBe(true);
});

// #1568: ONLY A CREATURE-TYPE CHOICE IS THE DECK'S CREATURE TYPE. Cloud Key chooses a card type, Extinction Event odd or even, Shimmer a land type, Leori a planeswalker type: none is a creature subtype of the deck.
test("resolveChosenTypes resolves a creature-type choice and leaves every other kind exactly as it was", () => {
  const counts = new Map([["elf", 5], ["goblin", 2]]);
  const hierarchy: Hierarchy = { elf: ["creature"], goblin: ["creature"] };
  const subj = (chosenKind?: string) => ({ type: "creature", control: "you", token: null, chosenType: true, ...(chosenKind ? { chosenKind } : {}) }) as never;
  const resolved = resolveChosenTypes(tagsWith([], [
    { kind: "static", effect: { kind: "cost-reduction", subject: subj("creature-type") } },
    { kind: "static", effect: { kind: "cost-reduction", subject: subj("card-type") } },
    { kind: "static", effect: { kind: "cost-reduction", subject: subj("parity") } },
    { kind: "static", effect: { kind: "cost-reduction", subject: subj("land-type") } },
    { kind: "static", effect: { kind: "cost-reduction", subject: subj("planeswalker-type") } },
    { kind: "static", effect: { kind: "cost-reduction", subject: subj() } },
  ] as never), counts, hierarchy);
  const [cre, card, par, land, pw, unknown] = resolved.abilities.map((a) => a.effect.subject!);
  expect(cre).toMatchObject({ subtype: "elf" });
  expect(cre!.chosenType).toBeUndefined();
  for (const s of [card, par, land, pw]) { expect(s!.subtype).toBeUndefined(); expect(s!.chosenType).toBe(true); }
  // no kind recorded (a stored reading from before #1568): the old behaviour, a creature-type choice
  expect(unknown).toMatchObject({ subtype: "elf" });
});

// #1568 part 4 and 5: the printed-text fallback of `caresAboutCreatureType`. Real oracle texts (cards.oracleText, 2026-11-07).
import { printedTextNamesCreatureType as names } from "./chosen-type.js";
const TEXT = {
  kami: "At the beginning of your upkeep, sacrifice this creature unless you pay {G}.\nSoulshift 3 (When this creature dies, you may return target Spirit card with mana value 3 or less from your graveyard to your hand.)",
  harbinger: "Protection from non-Spirit creatures\nSoulshift 4 (When this creature dies, you may return target Spirit card with mana value 4 or less from your graveyard to your hand.)",
  brawler: "Amplify 1 (As this creature enters, put a +1/+1 counter on it for each Zombie card you reveal in your hand.)\nWhenever this creature attacks or blocks, you lose 1 life for each +1/+1 counter on it.",
  brute: "Affinity for outlaws (This spell costs {1} less to cast for each Assassin, Mercenary, Pirate, Rogue, and/or Warlock you control.)\nTrample",
  faerie: "Flying\nProwl {2}{U} (You may cast this for its prowl cost if you dealt combat damage to a player this turn with a Faerie or Rogue.)\nWhen this creature enters, if its prowl cost was paid, draw a card.",
  harlequin: "Freerunning {1}{B} (You may cast this spell for its freerunning cost if you dealt combat damage to a player this turn with an Assassin or commander.)\nWhen this creature enters, you draw a card and you lose 1 life.",
  stepThrough: "Return two target creatures to their owners' hands.\nWizardcycling {2} ({2}, Discard this card: Search your library for a Wizard card, reveal it, put it into your hand, then shuffle.)",
  illuna: "Mutate {3}{R/G}{U}{U} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)\nFlying, trample\nWhenever this creature mutates, exile cards from the top of your library until you exile a nonland permanent card. Put that card onto the battlefield or into your hand.",
  bronco: "Whenever this creature attacks, reveal the top card of your library and put it into your hand. You lose life equal to that card's mana value if this creature isn't saddled. Otherwise, each opponent loses that much life.\nSaddle 3 (Tap any number of other creatures you control with total power 3 or more: This Mount becomes saddled until end of turn. Saddle only as a sorcery.)",
  donal: "Whenever you cast a nonlegendary creature spell with flying, you may copy it, except the copy is a 1/1 Spirit in addition to its other types. Do this only once each turn. (The copy becomes a token.)",
  blade: "Menace\nEquipped creature has base power and toughness 5/5, has menace, and is a black Demon in addition to its other colors and types.\nReconfigure {2}{B}{B} ({2}{B}{B}: Attach to target creature you control; or unattach from a creature. Reconfigure only as a sorcery. While attached, this isn't a creature.)",
  enkira: "When Enkira, Hostile Scavenger enters, create two Walker tokens. (They're 2/2 black Zombie creatures.)\nAs long as Enkira is equipped, it must be blocked if able.\nWhenever Enkira and at least two Zombies attack, Enkira gains indestructible until end of turn.",
  hivestone: "Creatures you control are Slivers in addition to their other creature types.",
  kudo: "Other creatures have base power and toughness 2/2 and are Bears in addition to their other types.",
  monksFist: "Equipped creature gets +1/+0 and is a Monk in addition to its other types.",
  riseFromTheGrave: "Put target creature card from a graveyard onto the battlefield under your control. That creature is a black Zombie in addition to its other colors and types.",
  archdruid: "Other Elf creatures you control get +1/+1.",
};

test("a type named ONLY in the reminder of Soulshift, Amplify, Affinity, Prowl, Freerunning or a typecycling is still named", () => {
  expect(names("Kami of the Tended Garden", TEXT.kami)).toBe(true);
  expect(names("Harbinger of Spring", TEXT.harbinger)).toBe(true);
  expect(names("Embalmed Brawler", TEXT.brawler)).toBe(true);
  expect(names("Hellspur Brute", TEXT.brute)).toBe(true);
  expect(names("Latchkey Faerie", TEXT.faerie)).toBe(true);
  expect(names("Merciless Harlequin", TEXT.harlequin)).toBe(true);
  expect(names("Step Through", TEXT.stepThrough)).toBe(true);
});

test("a reminder of any OTHER keyword stays dropped: Mutate's 'non-Human', Saddle's 'Mount', a token's 'Zombie creatures'", () => {
  expect(names("Illuna, Apex of Wishes", TEXT.illuna)).toBe(false);
  expect(names("Caustic Bronco", TEXT.bronco)).toBe(false);
  expect(names("Enkira, Hostile Scavenger", TEXT.enkira.split("\n").slice(0, 2).join("\n"))).toBe(false);
});

test("a type ADDED to ONE thing (a copy, an equipped or reanimated creature) is no kindred (Donal's 'except the copy is a 1/1 Spirit', Blade of the Oni's 'is a black Demon'), a type given to a whole CLASS still is (Hivestone, Kudo), and a type named beside it still is", () => {
  expect(names("Donal, Herald of Wings", TEXT.donal)).toBe(false);
  expect(names("Blade of the Oni", TEXT.blade)).toBe(false);
  expect(names("Monk's Fist", TEXT.monksFist)).toBe(false);
  expect(names("Rise from the Grave", TEXT.riseFromTheGrave)).toBe(false);
  expect(names("Hivestone", TEXT.hivestone)).toBe(true);
  expect(names("Kudo, King Among Bears", TEXT.kudo)).toBe(true);
  // Enkira's Walker tokens are made, and her Zombies are a real care
  expect(names("Enkira, Hostile Scavenger", TEXT.enkira)).toBe(true);
  expect(names("Elvish Archdruid", TEXT.archdruid)).toBe(true);
});

// #1582: THE RESULT OF A MELD IS A NAMED CARD, NOT A TYPE THE MELDER CARES ABOUT. Graf Rats' "meld them into Chittering Host" enters an Eldrazi Horror; that made Graf Rats read as caring about Horrors and pair with every chosen-type payoff (Vanquisher's Banner, Kindred Discovery).
test("an emit of a named card is no creature type the card cares about", () => {
  const enters = (extra: object) => tagsWith(["rat"], [{ kind: "triggered", effect: { kind: "" }, emits: [{ verb: "enters", subject: { control: "you", token: false, type: "creature", subtype: ["eldrazi", "horror"], ...extra } }], clause: 1 } as never]);
  expect(caresAboutCreatureType(enters({}), { name: "Graf Rats" })).toBe(true);
  expect(caresAboutCreatureType(enters({ named: "chittering host" }), { name: "Graf Rats" })).toBe(false);
});
