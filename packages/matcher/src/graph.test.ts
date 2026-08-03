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

test("artCrop lands in the card node's props when the doc has one, and is absent when it doesn't", () => {
  const withArt = doc({ ...krenko, artCrop: "https://example.com/krenko.jpg" });
  const g = buildGraph([withArt, chieftain]);
  expect(g.nodes.find((n) => n.id === "card:krenko")?.props?.artCrop).toBe("https://example.com/krenko.jpg");
  expect(g.nodes.find((n) => n.id === "card:chieftain")?.props?.artCrop).toBeUndefined();
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

/** Item 1: face-level manaCost. A card-level manaCost is often absent or stale on multi-faced
 *  cards (Scryfall puts the real cost on each face); MANA_SYMBOL must come from the face's own
 *  cost, hung off that face's node, not the card's card-level (often missing) manaCost. */
test("a two-faced card with different mana costs emits MANA_SYMBOL from each face's own cost", () => {
  const mdfc = doc({
    _id: "mdfc", name: "Ulvenwald Captive // Ulvenwald Abomination",
    typeLine: "Creature — Wolf // Creature — Wolf",
    colors: ["G"], colorIdentity: ["G"], manaValue: 2, layout: "transform",
    faces: [
      { name: "Ulvenwald Captive", typeLine: "Creature — Wolf", oracleText: "", colors: ["G"], power: "2", toughness: "2", manaCost: "{1}{G}" },
      { name: "Ulvenwald Abomination", typeLine: "Creature — Wolf", oracleText: "", colors: ["G"], power: "5", toughness: "5" },
    ],
  });
  const g = buildGraph([mdfc]);
  expect(edgesFrom(g, "face:mdfc:0", "MANA_SYMBOL").sort()).toEqual(["mana:1", "mana:G"]);
  expect(edgesFrom(g, "face:mdfc:1", "MANA_SYMBOL")).toEqual([]);
  // No stale/absent card-level fallback double-emits from the card node.
  expect(edgesFrom(g, "card:mdfc", "MANA_SYMBOL")).toEqual([]);
});

/** Item 4: `faces` absent does not mean single-faced -- it means unrefreshed. A combined typeLine
 *  ("A — B // C — D") must be split before it ever reaches `parseTypeLine`, or the parser bakes
 *  "//" and the em dash into junk shared nodes. */
test("a card with no faces but a combined typeLine splits into per-face nodes with no junk tokens", () => {
  const stale = doc({
    _id: "stale", name: "Stale Front // Stale Back",
    typeLine: "Legendary Creature — Human Wizard // Land — Gate",
  });
  const g = buildGraph([stale]);
  expect(edgesFrom(g, "card:stale", "FACE")).toEqual(["face:stale:0", "face:stale:1"]);
  for (const n of g.nodes) {
    expect(n.id).not.toContain("//");
    expect(n.id).not.toContain("—");
  }
  expect(edgesFrom(g, "face:stale:0", "TYPE")).toEqual(["type:creature"]);
  expect(edgesFrom(g, "face:stale:0", "SUBTYPE").sort()).toEqual(["subtype:human", "subtype:wizard"]);
  expect(edgesFrom(g, "face:stale:1", "TYPE")).toEqual(["type:land"]);
  expect(edgesFrom(g, "face:stale:1", "SUBTYPE")).toEqual(["subtype:gate"]);
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

/** A face with no mana cost (a transform back, an adventure's creature half) carries its colour in
 *  `colorIndicator` — the printed dot — rather than in `colors`. Without the fallback such a face
 *  gets no COLOR edges at all, silently. Rare (one card in the live corpus) but wrong. */
test("a face with empty colors falls back to its colorIndicator", () => {
  const indicated = doc({
    _id: "ind", name: "Front // Back", typeLine: "Creature — Human // Creature — Horror",
    colors: ["U"], colorIdentity: ["U"], manaValue: 2, layout: "transform",
    faces: [
      { name: "Front", typeLine: "Creature — Human", oracleText: "", colors: ["U"], manaCost: "{1}{U}" },
      { name: "Back", typeLine: "Creature — Horror", oracleText: "", colors: [], colorIndicator: ["B"] },
    ],
  });
  const g = buildGraph([indicated]);
  expect(edgesFrom(g, "face:ind:0", "COLOR")).toEqual(["color:U"]);
  expect(edgesFrom(g, "face:ind:1", "COLOR")).toEqual(["color:B"]);
});

test("colors wins over colorIndicator when both are present", () => {
  const both = doc({
    _id: "both", name: "Both", typeLine: "Creature — Human",
    faces: [{ name: "Both", typeLine: "Creature — Human", oracleText: "", colors: ["R"], colorIndicator: ["G"] }],
  });
  expect(edgesFrom(buildGraph([both]), "face:both:0", "COLOR")).toEqual(["color:R"]);
});

/** A shared target can be reached from several cards, and each was re-emitting the same edge: seven
 *  Wizard-token makers in one deck produced seven copies of
 *  `token:wizard -SUBTYPE-> subtype:wizard`, double-counting degree in any viewer. */
test("an edge reached from several cards is stored once", () => {
  const part = { component: "token", name: "Wizard", typeLine: "Token Creature — Wizard" };
  const a = doc({ _id: "a", name: "A", typeLine: "Creature — Human", allParts: [part] });
  const b = doc({ _id: "b", name: "B", typeLine: "Creature — Human", allParts: [part] });
  const g = buildGraph([a, b]);
  const subtypeEdges = g.edges.filter((e) => e.from === "token:wizard" && e.to === "subtype:wizard");
  expect(subtypeEdges).toHaveLength(1);
  // Both cards still get their own CREATES edge to the shared token node.
  expect(g.edges.filter((e) => e.kind === "CREATES").map((e) => e.from).sort()).toEqual(["card:a", "card:b"]);
});
