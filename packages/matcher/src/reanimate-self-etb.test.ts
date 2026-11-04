import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";

/** #1497: recursion that returns a creature CARD from a graveyard feeds another card's own "when this enters" only when that card
 *  can be a creature card in a graveyard: not a token (CR 111.7: a token that has left the battlefield ceases to exist), and for a
 *  transforming card only its FRONT face (a card in a graveyard has only its front face's characteristics, CR 712.8a).
 *  Tag shapes below are the stored `cardTagsDerived` rows of Reanimate, Gray Merchant, Invasion of Amonkhet // Lazotep Convert and the
 *  Outlaws' Merriment Human Rogue token (queried on DERIVE 449). */
const H: Hierarchy = { zombie: ["creature"], rogue: ["creature"] };
const chars = (o: Partial<CardTags["characteristics"]>): CardTags["characteristics"] =>
  ({ types: ["creature"], subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [], ...o });
const dc = (name: string, typeLine: string, oracleText: string, c: CardTags["characteristics"], abilities: CardTags["abilities"], extra: Partial<DeckCard> = {}, faces?: DeckCard["card"]["faces"]): DeckCard => ({
  card: { name, typeLine, oracleText, keywords: [], colors: [], manaValue: 0, ...(faces ? { faces } : {}) } as unknown as DeckCard["card"],
  tags: { oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t", characteristics: c, abilities } as CardTags,
  ...extra,
});
const you = { control: "you", token: null } as const;
const reanimate = dc("Reanimate", "Sorcery", "Put target creature card from a graveyard onto the battlefield under your control. You lose life equal to its mana value.", chars({ types: ["sorcery"] }), [
  { kind: "on-cast", effect: { kind: "graveyard-recursion", subject: { control: "any", token: null, type: "creature", scope: "target", fromZone: "graveyard", zone: "graveyard" } },
    emits: [{ verb: "enters", subject: { ...you, fromZone: "graveyard", type: "creature", scope: "target" } },
      { verb: "leaves", subject: { control: "any", token: null, fromZone: "graveyard", type: "creature", scope: "target", zone: "graveyard" } }] },
] as CardTags["abilities"]);
const enters = (c: CardTags["characteristics"], subject: object, face?: number) =>
  ({ kind: "triggered", ...(face !== undefined ? { face } : {}), trigger: { verbs: ["enters"], subject }, effect: { kind: "damage", subject: { control: "any", token: null, scope: "target" } } }) as unknown as CardTags["abilities"][number];
const entersTags = (p: DeckCard, c: DeckCard) => pairReasonsAcrossFaces(p, c, H).filter((r) => r.tag.startsWith("enters:"));

test("Reanimate still feeds a creature card's own enters trigger (Dread Tiller shape)", () => {
  const tiller = dc("Dread Tiller", "Creature — Zombie", "When this creature enters, ...", chars({ subtypes: ["zombie"] }), [enters(chars({}), { ...you, type: "creature", self: true })]);
  expect(entersTags(reanimate, tiller).length).toBeGreaterThan(0);
});

test("a creature MDFC whose front face is a creature still pairs", () => {
  const faces = [
    { name: "Front", typeLine: "Creature — Zombie", oracleText: "When this creature enters, it deals 1 damage to any target.", colors: [] },
    { name: "Back", typeLine: "Land", oracleText: "{T}: Add {B}.", colors: [] },
  ];
  const mdfc = dc("Front // Back", "Creature — Zombie // Land", "x", chars({ types: ["creature", "land"], faces: [{ types: ["creature"], subtypes: ["zombie"] }, { types: ["land"], subtypes: [] }] } as never),
    [enters(chars({}), { ...you, type: "creature", self: true }, 0)], {}, faces as never);
  expect(entersTags(reanimate, mdfc).length).toBeGreaterThan(0);
});

test("Reanimate does not feed Outlaws' Merriment's Human Rogue token: a token cannot be in a graveyard", () => {
  const rogue = dc("Human Rogue", "Token Creature — Human Rogue", "Haste\nWhen this creature enters the battlefield, it deals 1 damage to any target.",
    chars({ types: ["token", "creature"], subtypes: ["human", "rogue"], token: true, keywords: ["haste"] }),
    [enters(chars({}), { ...you, type: "creature", self: true })], { isToken: true });
  expect(entersTags(reanimate, rogue)).toEqual([]);
});

test("Reanimate does not feed Invasion of Amonkhet // Lazotep Convert: a battle in a graveyard is not a creature card", () => {
  const faces = [
    { name: "Invasion of Amonkhet", typeLine: "Battle — Siege", oracleText: "When this Siege enters, each player mills three cards, then each opponent discards a card and you draw a card.", colors: [] },
    { name: "Lazotep Convert", typeLine: "Creature — Zombie", oracleText: "You may have this creature enter as a copy of any creature card in a graveyard, except it's a 4/4 black Zombie in addition to its other colors and types.", colors: [] },
  ];
  const inv = dc("Invasion of Amonkhet // Lazotep Convert", "Battle — Siege // Creature — Zombie", faces.map((f) => f.oracleText).join("\n//\n"),
    chars({ types: ["battle", "creature"], subtypes: ["siege", "zombie"], layout: "transform", faces: [{ types: ["battle"], subtypes: ["siege"] }] } as never), [
      enters(chars({}), { ...you, subtype: "siege", self: true }),
      { kind: "static", face: 1, effect: { kind: "clone" }, emits: [{ verb: "copy", subject: { control: "any", token: null, type: "creature" } }] },
    ] as CardTags["abilities"], {}, faces as never);
  expect(entersTags(reanimate, inv)).toEqual([]);
});

test("a DAYBOUND card's back face is reachable from a graveyard return (CR 702.145b: at night it enters transformed): Howlpack Piper still pairs", () => {
  const faces = [
    { name: "Howlpack Piper", typeLine: "Creature — Human Werewolf", oracleText: "Daybound", colors: [] },
    { name: "Wildsong Howler", typeLine: "Creature — Werewolf", oracleText: "Whenever this creature enters or transforms into Wildsong Howler, ...", colors: [] },
  ];
  const piper = dc("Howlpack Piper // Wildsong Howler", "Creature — Human Werewolf // Creature — Werewolf", "x",
    chars({ subtypes: ["human", "werewolf"], keywords: ["transform", "daybound", "nightbound"], faces: [{ types: ["creature"], subtypes: ["human", "werewolf"] }] } as never),
    [enters(chars({}), { ...you, type: "creature", self: true }, 1)], {}, faces as never);
  expect(entersTags(reanimate, piper).length).toBeGreaterThan(0);
});
