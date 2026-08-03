import { expect, test } from "vitest";
import type { CardDoc } from "@mtg/data";
import { buildGraph, type CardGraph } from "./graph.js";

const doc = (over: Partial<CardDoc> & { _id: string; name: string; typeLine: string }): CardDoc => ({
  oracleText: "", keywords: [], colors: [], manaValue: 0, colorIdentity: [],
  power: null, toughness: null, tags: { produces: [], cares: [] }, searchNames: [],
  ...over,
});

const krenko = doc({
  _id: "krenko", name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior",
  colors: ["R"], colorIdentity: ["R"], manaValue: 4, power: "3", toughness: "3",
  manaCost: "{2}{R}{R}", layout: "normal", legalities: { commander: "legal" },
  allParts: [{ component: "token", name: "Goblin", typeLine: "Token Creature — Goblin" }],
});

const chieftain = doc({
  _id: "chieftain", name: "Goblin Chieftain", typeLine: "Creature — Goblin",
  colors: ["R"], colorIdentity: ["R"], manaValue: 3, power: "2", toughness: "2",
  keywords: ["Haste"],
});

const edgesFrom = (g: CardGraph, from: string, kind?: string) =>
  g.edges.filter((e) => e.from === from && (kind === undefined || e.kind === kind)).map((e) => e.to);

/** The property that makes this a graph rather than a list of records: two cards must reach the
 *  SAME node, not two equal-looking ones. Everything downstream depends on it. */
test("two cards sharing a subtype reach the same node", () => {
  const g = buildGraph([krenko, chieftain]);
  expect(edgesFrom(g, "face:krenko:0", "SUBTYPE")).toContain("subtype:goblin");
  expect(edgesFrom(g, "face:chieftain:0", "SUBTYPE")).toContain("subtype:goblin");
  expect(g.nodes.filter((n) => n.id === "subtype:goblin")).toHaveLength(1);
});

test("a single-faced card still gets exactly one face node carrying its characteristics", () => {
  const g = buildGraph([krenko]);
  expect(edgesFrom(g, "card:krenko", "FACE")).toEqual(["face:krenko:0"]);
  expect(edgesFrom(g, "face:krenko:0", "SUPERTYPE")).toEqual(["supertype:legendary"]);
  expect(edgesFrom(g, "face:krenko:0", "TYPE")).toEqual(["type:creature"]);
  expect(edgesFrom(g, "face:krenko:0", "POWER")).toEqual(["power:3"]);
  expect(edgesFrom(g, "face:krenko:0", "COLOR")).toEqual(["color:R"]);
});

test("card-level facts hang off the card, not the face", () => {
  const g = buildGraph([krenko]);
  expect(edgesFrom(g, "card:krenko", "IDENTITY")).toEqual(["color:R"]);
  expect(edgesFrom(g, "card:krenko", "CMC")).toEqual(["cmc:4"]);
  expect(edgesFrom(g, "card:krenko", "MANA_SYMBOL").sort()).toEqual(["mana:2", "mana:R"]);
  expect(edgesFrom(g, "card:krenko", "LAYOUT")).toEqual(["layout:normal"]);
});

test("a double-faced card yields two face nodes whose subtypes differ", () => {
  const delver = doc({
    _id: "delver", name: "Delver of Secrets // Insectile Aberration",
    typeLine: "Creature — Human Wizard // Creature — Human Insect",
    colors: ["U"], colorIdentity: ["U"], manaValue: 1, layout: "transform",
    faces: [
      { name: "Delver of Secrets", typeLine: "Creature — Human Wizard", oracleText: "", colors: ["U"], power: "1", toughness: "1" },
      { name: "Insectile Aberration", typeLine: "Creature — Human Insect", oracleText: "", colors: ["U"], power: "3", toughness: "2" },
    ],
  });
  const g = buildGraph([delver]);
  expect(edgesFrom(g, "card:delver", "FACE")).toEqual(["face:delver:0", "face:delver:1"]);
  expect(edgesFrom(g, "face:delver:0", "SUBTYPE").sort()).toEqual(["subtype:human", "subtype:wizard"]);
  expect(edgesFrom(g, "face:delver:1", "SUBTYPE").sort()).toEqual(["subtype:human", "subtype:insect"]);
  expect(edgesFrom(g, "face:delver:1", "POWER")).toEqual(["power:3"]);
});

test("all_parts yields a reachable token node carrying its own subtype", () => {
  const g = buildGraph([krenko]);
  expect(edgesFrom(g, "card:krenko", "CREATES")).toEqual(["token:goblin"]);
  expect(edgesFrom(g, "token:goblin", "SUBTYPE")).toEqual(["subtype:goblin"]);
});

/** 24 formats across ~35k cards would be ~835k edges carrying one fact each. */
test("legalities is a card property with no edges", () => {
  const g = buildGraph([krenko]);
  const card = g.nodes.find((n) => n.id === "card:krenko")!;
  expect(card.props?.legalities).toEqual({ commander: "legal" });
  expect(g.edges.some((e) => e.to.startsWith("format:"))).toBe(false);
});

test("a card missing every optional field still produces a card node and one face", () => {
  const bare = doc({ _id: "bare", name: "Bare", typeLine: "Artifact" });
  const g = buildGraph([bare]);
  expect(g.nodes.find((n) => n.id === "card:bare")).toBeDefined();
  expect(edgesFrom(g, "card:bare", "FACE")).toEqual(["face:bare:0"]);
  expect(edgesFrom(g, "face:bare:0", "TYPE")).toEqual(["type:artifact"]);
  expect(edgesFrom(g, "card:bare", "MANA_SYMBOL")).toEqual([]);
  expect(edgesFrom(g, "face:bare:0", "POWER")).toEqual([]);
});

test("non-numeric printed power gets no value node", () => {
  const goyf = doc({ _id: "goyf", name: "Tarmogoyf", typeLine: "Creature — Lhurgoyf", power: "*", toughness: "1+*" });
  const g = buildGraph([goyf]);
  expect(edgesFrom(g, "face:goyf:0", "POWER")).toEqual([]);
  expect(edgesFrom(g, "face:goyf:0", "TOUGHNESS")).toEqual([]);
});

test("two cards sharing a keyword reach the same keyword node", () => {
  const a = doc({ _id: "a", name: "A", typeLine: "Creature — Human", keywords: ["Haste", "Flying"] });
  const b = doc({ _id: "b", name: "B", typeLine: "Creature — Human", keywords: ["Flying"] });
  const g = buildGraph([a, b]);
  expect(edgesFrom(g, "card:a", "KEYWORD").sort()).toEqual(["keyword:flying", "keyword:haste"]);
  expect(edgesFrom(g, "card:b", "KEYWORD")).toEqual(["keyword:flying"]);
  expect(g.nodes.filter((n) => n.id === "keyword:flying")).toHaveLength(1);
});

test("producedMana and manaCost reach the same mana node", () => {
  const land = doc({ _id: "land", name: "Land", typeLine: "Land", producedMana: ["G", "U"] });
  const spell = doc({ _id: "spell", name: "Spell", typeLine: "Instant", manaCost: "{G}" });
  const g = buildGraph([land, spell]);
  expect(edgesFrom(g, "card:land", "PRODUCES").sort()).toEqual(["mana:G", "mana:U"]);
  expect(edgesFrom(g, "card:spell", "MANA_SYMBOL")).toEqual(["mana:G"]);
  expect(g.nodes.filter((n) => n.id === "mana:G")).toHaveLength(1);
});

test("all_parts component kinds map to distinct node kinds and id prefixes", () => {
  const card = doc({
    _id: "multi", name: "Multi", typeLine: "Creature — Human",
    allParts: [
      { component: "token", name: "Goblin", typeLine: "Token Creature — Goblin" },
      { component: "combo_piece", name: "Combo Card", typeLine: "Creature — Human" },
      { component: "meld_part", name: "Meld Part", typeLine: "Creature — Human" },
      { component: "meld_result", name: "Meld Result", typeLine: "Creature — Human" },
    ],
  });
  const g = buildGraph([card]);
  expect(edgesFrom(g, "card:multi", "CREATES")).toEqual(["token:goblin"]);
  expect(edgesFrom(g, "card:multi", "COMBO_PIECE")).toEqual(["related:combo-card"]);
  expect(edgesFrom(g, "card:multi", "MELD_PART")).toEqual(["related:meld-part"]);
  expect(edgesFrom(g, "card:multi", "MELD_RESULT")).toEqual(["related:meld-result"]);

  const byId = (id: string) => g.nodes.find((n) => n.id === id)!;
  expect(byId("token:goblin").kind).toBe("token");
  expect(byId("related:combo-card").kind).toBe("related");
  expect(byId("related:meld-part").kind).toBe("related");
  expect(byId("related:meld-result").kind).toBe("related");
});
