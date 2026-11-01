import { expect, test } from "vitest";
import { deckLandTypes, deckSubtypeCounts, resolveChosenTypes } from "./chosen-type.js";
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
