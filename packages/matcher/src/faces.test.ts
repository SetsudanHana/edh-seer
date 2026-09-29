import { test, expect } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { enteringFaceName, faceDeckCards, printedFaces } from "./faces.js";
import type { DeckCard } from "./types.js";

const tags = (over: Partial<CardTags> = {}): CardTags => ({
  oracleId: "o", schemaVersion: 1, promptVersion: 1, model: "t",
  characteristics: {
    types: ["instant", "land"], subtypes: [], supertypes: [], keywords: [],
    colors: ["B"], manaValue: 4, token: false, layout: "modal_dfc",
    faces: [{ types: ["instant"], subtypes: [] }, { types: ["land"], subtypes: [] }],
  },
  abilities: [],
  ...over,
} as unknown as CardTags);

const mdfc = (): DeckCard => ({
  card: {
    name: "Fell the Profane // Fell Mire", typeLine: "Instant // Land", oracleText: "a\nb",
    keywords: [], colors: ["B"], manaValue: 4, layout: "modal_dfc",
    faces: [
      { name: "Fell the Profane", typeLine: "Instant", oracleText: "a", manaCost: "{3}{B}", colors: ["B"] },
      { name: "Fell Mire", typeLine: "Land", oracleText: "b", colors: [] },
    ],
  },
  tags: tags({
    abilities: [
      { effect: { kind: "removal" } },
      { face: 1, effect: { kind: "mana-generation" } },
    ] as unknown as CardTags["abilities"],
  }),
});

test("a single-face card is returned unchanged and unsplit", () => {
  const dc: DeckCard = {
    card: { name: "Sol Ring", typeLine: "Artifact", oracleText: "", keywords: [], colors: [], manaValue: 1 },
    tags: null,
  };
  expect(faceDeckCards(dc)).toEqual([dc]);
});

test("a token node is never split", () => {
  const dc: DeckCard = {
    card: { name: "Treasure", typeLine: "Token Artifact — Treasure", oracleText: "", keywords: [], colors: [], manaValue: 0 },
    tags: null, isToken: true,
  };
  expect(faceDeckCards(dc)).toHaveLength(1);
});

test("a modal DFC splits into one node per printed face, each carrying its own printed fields", () => {
  const [front, back] = faceDeckCards(mdfc());
  expect(front.card.name).toBe("Fell the Profane");
  expect(front.card.typeLine).toBe("Instant");
  expect(front.card.oracleText).toBe("a");
  expect(front.face).toBe(0);
  expect(front.parentName).toBe("Fell the Profane // Fell Mire");
  expect(back.card.name).toBe("Fell Mire");
  expect(back.face).toBe(1);
  expect(back.parentName).toBe("Fell the Profane // Fell Mire");
});

test("each face keeps only the abilities printed on it", () => {
  const [front, back] = faceDeckCards(mdfc());
  expect(front.tags!.abilities.map((a) => a.effect.kind)).toEqual(["removal"]);
  expect(back.tags!.abilities.map((a) => a.effect.kind)).toEqual(["mana-generation"]);
});

test("a face's characteristics are that face's types, not the union", () => {
  const [front, back] = faceDeckCards(mdfc());
  expect(front.tags!.characteristics.types).toEqual(["instant"]);
  expect(back.tags!.characteristics.types).toEqual(["land"]);
});

// TWO QUESTIONS, TWO SOURCES. How many nodes comes from the PRINTED faces (`Card.faces`, every
// layout); what a face SUPPLIES comes from the PLAYABLE faces (`Characteristics.faces`, which lists
// only the front for a transform, CR 712.8a). A playable face keeps its own entry there; a back face
// that is never cast gets an EMPTY list, so `impliedEvents` gives it no `cast` and no `enters`.
test("a transform back face is a node that supplies nothing implied", () => {
  const dc: DeckCard = {
    card: {
      name: "Treasure Map // Treasure Cove", typeLine: "Artifact // Land", oracleText: "", keywords: [],
      colors: [], manaValue: 2, layout: "transform",
      faces: [
        { name: "Treasure Map", typeLine: "Artifact", oracleText: "", colors: [] },
        { name: "Treasure Cove", typeLine: "Land", oracleText: "", colors: [] },
      ],
    },
    tags: tags({
      characteristics: {
        types: ["artifact", "land"], subtypes: [], supertypes: [], keywords: [], colors: [],
        manaValue: 2, token: false, layout: "transform",
        faces: [{ types: ["artifact"], subtypes: [] }],
      },
    } as unknown as Partial<CardTags>),
  };
  const [front, back] = faceDeckCards(dc);
  expect(front.tags!.characteristics.faces).toEqual([{ types: ["artifact"], subtypes: [] }]);
  expect(back.tags!.characteristics.faces).toEqual([]);
});

// `faces` absent does not mean single-faced — it can mean a document that was never refreshed. The
// combined type line still says there are two. Same fallback `graph.ts` already ships.
test("a combined type line with no faces still splits", () => {
  expect(printedFaces({
    name: "A // B", typeLine: "Instant // Land", oracleText: "", keywords: [], colors: [], manaValue: 1,
  }).map((f) => f.typeLine)).toEqual(["Instant", "Land"]);
});

// #715: a card putting ITSELF back onto the battlefield enters as the face the rule says -- the
// front by default (CR 712.14), the back when "transformed" (712.14a) -- not the face that printed it.
const jill = (frontText: string, emits: object[]): DeckCard => ({
  card: {
    name: "Jill, Shiva's Dominant // Shiva, Warden of Ice", typeLine: "", oracleText: "", keywords: [],
    colors: ["U"], manaValue: 3, layout: "transform",
    faces: [
      { name: "Jill, Shiva's Dominant", typeLine: "Legendary Creature — Human Noble Warrior", oracleText: frontText, colors: ["U"] },
      { name: "Shiva, Warden of Ice", typeLine: "Legendary Enchantment Creature — Saga Elemental", oracleText: "III — Exile Shiva, then return it to the battlefield (front face up).", colors: ["U"] },
    ],
  },
  tags: tags({
    characteristics: {
      types: ["legendary", "creature", "enchantment"], subtypes: [], supertypes: [], keywords: [], colors: ["U"],
      manaValue: 3, token: false, layout: "transform", faces: [{ types: ["legendary", "creature"], subtypes: [] }],
    },
    abilities: [
      { kind: "activated", effect: { kind: "flicker" }, emits },
      { face: 1, kind: "triggered", effect: { kind: "flicker" }, emits: [{ verb: "enters", subject: { control: "any", token: null, fromZone: "exile", self: true } }] },
    ],
  } as unknown as Partial<CardTags>),
});
const reEntry = { verb: "enters", subject: { control: "any", token: null, fromZone: "exile", self: true } };

test("a transformed self re-entry carries the BACK face's types and name", () => {
  const [front, back] = faceDeckCards(jill("Exile Jill, then return it to the battlefield transformed.",
    [{ ...reEntry, subject: { ...reEntry.subject, transformed: true } }]));
  const e = front.tags!.abilities[0]!.emits![0]!;
  expect(e.subject).toMatchObject({ type: ["legendary", "enchantment", "creature"], subtype: ["saga", "elemental"] });
  expect(enteringFaceName(front, e)).toBe("Shiva, Warden of Ice");
  // Shiva's chapter III has no "transformed": Jill comes back front face up.
  const back0 = back.tags!.abilities[0]!.emits![0]!;
  expect(back0.subject).toMatchObject({ type: ["legendary", "creature"], subtype: ["human", "noble", "warrior"] });
  expect(enteringFaceName(back, back0)).toBe("Jill, Shiva's Dominant");
});

test("a face that says 'transformed' but whose re-entry was not marked stays untyped", () => {
  // A phrasing derive missed must refuse, not read as the front face.
  const [front] = faceDeckCards(jill("Exile Jill, then return her to the battlefield transformed.", [reEntry]));
  const e = front.tags!.abilities[0]!.emits![0]!;
  expect(e.subject.type).toBeUndefined();
  expect(enteringFaceName(front, e)).toBeUndefined();
});
