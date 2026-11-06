import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import { producerEvents } from "./edges.js";
import type { DeckCard } from "./types.js";
import { animatedKindredSentence } from "./sentence.js";

/** AN ANIMATE'S RESULT FEEDS THE KINDRED CARDS THAT REACH IT (#1364 part 2). A permanent that becomes an Elemental / Soldier / Dragon is that kindred while it is a creature, so a lord that names the
 *  kindred reaches it ("Other Soldier creatures get +1/+1": Boros Keyrune's Soldier) and a count of the kindred counts it (Omnath's "number of Elementals you control").
 *  Real oracle text (Mongo `cards`, read 2026-11-06), derived from the grammar's own records. */
const H = loadHierarchy();
function fromText(name: string, typeLine: string, oracleText: string): DeckCard {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
const keyrune = fromText("Boros Keyrune", "Artifact", "{T}: Add {R} or {W}.\n{R}{W}: This artifact becomes a 1/1 red and white Soldier artifact creature with double strike until end of turn. (It deals both first-strike and regular combat damage.)");
const marshal = fromText("Field Marshal", "Creature — Human Soldier", "Other Soldier creatures get +1/+1 and have first strike. (They deal combat damage before creatures without first strike.)");
const brave = fromText("Brave the Wilds", "Sorcery", "Bargain (You may sacrifice an artifact, enchantment, or token as you cast this spell.)\nIf this spell was bargained, target land you control becomes a 3/3 Elemental creature with haste that's still a land.\nSearch your library for a basic land card, reveal it, put it into your hand, then shuffle.");
/** Stored readings (Mongo `cardClauses`, `canonical`, verbatim) for the cards the grammar does not read completely, with the card's REAL oracle text: derive reads `becomes` off that text. */
function fromRecords(name: string, typeLine: string, oracleText: string, records: unknown[]): DeckCard {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(card as never, name, name, records as never)) as CardTags };
}
const gideon = fromRecords("Gideon Jura", "Legendary Planeswalker \u2014 Gideon", "+2: During target opponent's next turn, creatures that player controls attack Gideon Jura if able.\n−2: Destroy target tapped creature.\n0: Until end of turn, Gideon Jura becomes a 6/6 Human Soldier creature that's still a planeswalker. Prevent all damage that would be dealt to him this turn.",
  [{"id": 1, "abilityType": "activated", "actions": [{"verb": "goad", "object": "creatures that player controls", "optional": false, "fromZone": null, "toZone": null}]}, {"id": 2, "abilityType": "activated", "actions": [{"verb": "destroy", "object": "target tapped creature", "optional": false, "fromZone": null, "toZone": null}]}, {"id": 3, "abilityType": "activated", "actions": [{"verb": "animate", "object": "Gideon Jura", "optional": false, "fromZone": null, "toZone": null}, {"verb": "prevent", "object": "all damage that would be dealt to Gideon Jura this turn", "optional": false, "fromZone": null, "toZone": null}]}]);
const opal = fromText("Opal Caryatid", "Enchantment", "When an opponent casts a creature spell, if this permanent is an enchantment, it becomes a 2/2 Soldier creature.");
/** Kamahl's Will is not grammar-complete: its STORED reading (Mongo `cardClauses`, verbatim) is derived. */
const kamahlCard = { name: "Kamahl's Will", typeLine: "Instant", oracleText: "Choose one. If you control a commander as you cast this spell, you may choose both instead.\n\u2022 Until end of turn, any number of target lands you control become 1/1 Elemental creatures with vigilance, indestructible, and haste. They're still lands.\n\u2022 Choose target creature you don't control. Each creature you control deals damage equal to its power to that creature.", keywords: [] as string[] };
const kamahl: DeckCard = {
  card: { ...kamahlCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(kamahlCard as never, "Kamahl's Will", "Kamahl's Will", [{ id: 1, abilityType: "spell" }, { id: 2, abilityType: "spell", actions: [{ verb: "animate", object: "any number of target lands you control", optional: false }, { verb: "grant-ability", object: "vigilance", optional: false }, { verb: "grant-ability", object: "indestructible", optional: false }, { verb: "grant-ability", object: "haste", optional: false }] },
    { id: 3, abilityType: "spell", actions: [{ verb: "deal-damage", object: "target creature you don't control", amount: "the total power of each creature you control", optional: false }] }] as never)) as CardTags,
};
const crasher = fromText("Thicket Crasher", "Creature — Elemental Rhino", "Trample (This creature can deal excess combat damage to the player or planeswalker it's attacking.)\nOther Elementals you control have trample.");
const omnath = fromText("Omnath, Locus of the Roil", "Legendary Creature — Elemental", "When Omnath enters, it deals damage to any target equal to the number of Elementals you control.\nLandfall — Whenever a land you control enters, put a +1/+1 counter on target Elemental you control. If you control eight or more lands, draw a card.");
/** Mutavault is not grammar-complete ("all creature types"): its STORED-shape reading (a self animate with the result in the object) is derived. */
const mutaCard = { name: "Mutavault", typeLine: "Land", oracleText: "{T}: Add {C}.\n{1}: This land becomes a 2/2 creature with all creature types until end of turn. It's still a land.", keywords: [] as string[] };
const mutavault: DeckCard = {
  card: { ...mutaCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(mutaCard as never, "Mutavault", "Mutavault", [
    { id: 1, abilityType: "activated", actions: [{ verb: "add-mana", object: "{C}", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 2, abilityType: "activated", actions: [{ verb: "animate", object: "this as a 2/2 creature with all creature types", fromZone: null, toZone: null, amount: null, optional: false }] },
  ] as never)) as CardTags,
};
const crusader = fromText("Akroan Crusader", "Creature — Human Soldier", "Heroic — Whenever you cast a spell that targets this creature, create a 1/1 red Soldier creature token with haste. (It can attack and {T} as soon as it comes under your control.)");
/** Leyline of Resonance is not grammar-complete: its STORED reading (Mongo `cardClauses`, `canonical`, verbatim) is derived. */
const resCard = { name: "Leyline of Resonance", typeLine: "Enchantment", oracleText: "If this card is in your opening hand, you may begin the game with it on the battlefield.\nWhenever you cast an instant or sorcery spell that targets only a single creature you control, copy that spell. You may choose new targets for the copy.", keywords: [] as string[] };
const resonance: DeckCard = {
  card: { ...resCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(resCard as never, "Leyline of Resonance", "Leyline of Resonance", [
    { id: 1, abilityType: "static", actions: [{ verb: "play", object: "this", fromZone: null, toZone: null, amount: null, optional: true }] },
    { id: 2, abilityType: "triggered", trigger: { event: "cast", subject: "an instant or sorcery spell that targets only a single creature you control", control: "you" }, actions: [{ verb: "copy", object: "that spell", fromZone: null, toZone: null, amount: null, optional: false }] },
  ] as never)) as CardTags,
};
/** Cid is not grammar-complete: its STORED reading (Mongo `cardClauses`, `canonical`, verbatim) is derived. */
const cidCard = { name: "Cid, Timeless Artificer", typeLine: "Legendary Creature — Human Artificer", oracleText: "Artifact creatures and Heroes you control get +1/+1 for each Artificer you control and each Artificer card in your graveyard.\nA deck can have any number of cards named Cid, Timeless Artificer.\nCycling {W}{U} ({W}{U}, Discard this card: Draw a card.)", keywords: [] as string[] };
const cid: DeckCard = {
  card: { ...cidCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(cidCard as never, "Cid, Timeless Artificer", "Cid, Timeless Artificer", [
    { id: 1, abilityType: "static", actions: [{ verb: "modify-pt", object: "Artifact creatures and Heroes you control", fromZone: null, toZone: null, amount: "+1/+1 for each Artificer you control and each Artificer card in your graveyard", optional: false }] },
    { id: 2, abilityType: "static", actions: [{ verb: "other", object: "A deck can have any number of cards named Cid, Timeless Artificer", fromZone: null, toZone: null, amount: null, optional: false }] },
    { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Cycling {W}{U}" }] },
  ] as never)) as CardTags,
};
/** Doc Ock's STORED reading (Mongo `cardClauses`, `canonical`, verbatim): a LASTING target animate into an ARTIFACT creature, the shape Cid's type-only lord meets. */
const docCard = { name: "Doc Ock, Evil Inventor", typeLine: "Legendary Creature — Human Scientist Villain", oracleText: "At the beginning of combat on your turn, target noncreature artifact you control becomes an 8/8 Robot Villain artifact creature in addition to its other types.", keywords: [] as string[] };
const docOck: DeckCard = {
  card: { ...docCard, colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(docCard as never, "Doc Ock, Evil Inventor", "Doc Ock, Evil Inventor", [
    { id: 1, abilityType: "triggered", trigger: { event: "begin-combat", subject: "you", control: "you" }, actions: [{ verb: "animate", object: "target noncreature artifact you control becomes an 8/8 Robot Villain artifact creature in addition to its other types", fromZone: null, toZone: null, amount: null, optional: false }] },
  ] as never)) as CardTags,
};
const anthem = fromText("Glorious Anthem", "Enchantment", "Creatures you control get +1/+1.");
const animatedOf = (c: DeckCard) => c.tags!.abilities.find((a) => a.effect.kind === "animate" && a.effect.becomesLasts === true)?.effect.becomes;
const targetingOf = (c: DeckCard): unknown[] => producerEvents(c.tags!).flatMap((e) => (e as { targeting?: unknown[] }).targeting ?? []);
const tagsBetween = (a: DeckCard, b: DeckCard): string[] => pairReasons(a, b, H).map((r) => `${r.producer}>${r.consumer}:${r.tag}`);

test("a TIMED animate makes no kindred (owner 2026-11-06): Boros Keyrune and Gideon Jura, 'until end of turn', are reached by no Soldier lord", () => {
  expect(pairReasons(marshal, keyrune, H).filter((x) => x.consumer === "Boros Keyrune")).toEqual([]);
  expect(pairReasons(marshal, gideon, H).filter((x) => x.consumer === "Gideon Jura")).toEqual([]);
  expect(pairReasons(kamahl, omnath, H).filter((x) => x.tag.startsWith("scales:"))).toEqual([]);
});

test("a LASTING self animate makes one (Opal Caryatid: 'it becomes a 2/2 Soldier creature', no duration, CR 611.2a), and says so", () => {
  const r = pairReasons(marshal, opal, H).filter((x) => x.tag === "static:pump" && x.producer === "Field Marshal" && x.consumer === "Opal Caryatid");
  expect(r).toHaveLength(1);
  expect(r[0]!.text).toMatch(/Opal Caryatid.*Soldier/);
});

test("a TARGET animate's Elemental is reached by an Elemental lord's grant (Brave the Wilds, Thicket Crasher)", () => {
  const r = pairReasons(crasher, brave, H).filter((x) => x.producer === "Thicket Crasher" && x.consumer === "Brave the Wilds");
  expect(r.map((x) => x.tag)).toContain("static:keyword-grant");
});

test("a count of the kindred counts the animator (Omnath's Elementals, Brave the Wilds)", () => {
  expect(pairReasons(brave, omnath, H).some((x) => x.tag === "scales:elemental" && x.producer === "Brave the Wilds" && x.consumer === "Omnath, Locus of the Roil")).toBe(true);
});

test("only a kindred reaches the result: a bare creature lord (Glorious Anthem) and an animate with no creature type (Mutavault, 'all creature types') form no new pair", () => {
  expect(tagsBetween(anthem, keyrune).filter((t) => t.startsWith("Glorious Anthem>Boros Keyrune"))).toEqual([]);
  expect(tagsBetween(marshal, mutavault).filter((t) => t.startsWith("Field Marshal>Mutavault"))).toEqual([]);
  expect(tagsBetween(brave, marshal).filter((t) => t.includes("Brave the Wilds>Field Marshal"))).toEqual([]);
});

test("a lord met by the animated permanent's TYPE alone is no kindred supply (Cid's 'artifact creatures and Heroes' does not reach Doc Ock's Robot Villain artifact creature)", () => {
  expect(animatedOf(docOck)).toMatchObject({ subtype: ["robot", "villain"] });
  expect(tagsBetween(cid, docOck).filter((t) => t.startsWith("Cid, Timeless Artificer>Doc Ock"))).toEqual([]);
});

test("the result is no creature target: Brave the Wilds and Kamahl's Will still meet no heroic consumer and no Leyline of Resonance", () => {
  expect(targetingOf(brave)).toEqual([]);
  for (const c of [brave, keyrune, opal, kamahl]) {
    expect(pairReasons(c, crusader, H).some((r) => r.tag.startsWith("cast:")), c.card.name).toBe(false);
    expect(pairReasons(c, resonance, H).length, c.card.name).toBe(0);
  }
});

test("a lord reaches a card's PRINTED kindred the way it did: Field Marshal and Thicket Crasher's Elemental lord do not cross", () => {
  expect(tagsBetween(marshal, crasher).filter((t) => t.startsWith("Field Marshal>Thicket Crasher"))).toEqual([]);
});

test("the sentences state the animation", () => {
  const text = (a: DeckCard, b: DeckCard, tag: string) => pairReasons(a, b, H).find((x) => x.tag === tag)?.text;
  expect(text(marshal, opal, "static:pump")).toBe("Opal Caryatid can become a Soldier, and Field Marshal gives Soldiers bigger stats");
  expect(text(brave, omnath, "scales:elemental")).toMatch(/Brave the Wilds can make one/);
});

// ---- fix round (#1364 Opus review) ----
const ashling = fromText("Ashling, the Limitless", "Legendary Creature — Elemental Sorcerer", "Elemental permanent spells you cast from your hand gain evoke {4} as you cast them. (If you cast a spell for its evoke cost, it's sacrificed when it enters.)\nWhenever you sacrifice a nontoken Elemental, create a token that's a copy of it. The token gains haste until end of turn. At the beginning of your next end step, sacrifice it unless you pay {W}{U}{B}{R}{G}.");
const doomguide = fromRecords("Solemn Doomguide", "Creature — Tiefling Cleric", "Flying\nEach creature card in your graveyard that's a Cleric, Rogue, Warrior, and/or Wizard has unearth {1}{B}. ({1}{B}: Return the card to the battlefield. The creature gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)",
  [{"id": 1, "abilityType": "none", "actions": [{"verb": "none", "object": "Flying", "fromZone": null, "toZone": null}]}, {"id": 2, "abilityType": "static", "actions": [{"verb": "grant-ability", "object": "unearth {1}{B}", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}]);
const planisphere = fromText("Astrologian's Planisphere", "Artifact — Equipment", "Job select (When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.)\nEquipped creature is a Wizard in addition to its other types and has \"Whenever you cast a noncreature spell and whenever you draw your third card each turn, put a +1/+1 counter on this creature.\"\nDiana — Equip {2}");
const squire = fromRecords("Skyknight Squire", "Creature \u2014 Cat Scout", "Whenever another creature you control enters, put a +1/+1 counter on this creature.\nAs long as this creature has three or more +1/+1 counters on it, it has flying and is a Knight in addition to its other types.",
  [{"id": 1, "abilityType": "triggered", "trigger": {"event": "enters", "subject": "another creature you control", "control": "you"}, "actions": [{"verb": "add-counter", "object": "+1/+1", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}, {"id": 2, "abilityType": "static", "actions": [{"verb": "grant-ability", "object": "flying", "fromZone": null, "toZone": null, "amount": null, "optional": false}, {"verb": "modify-pt", "object": "is a Knight in addition to its other types", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}]);
const clash = fromText("Clash of Realities", "Enchantment", "All Spirits have \"When this permanent enters, you may have it deal 3 damage to target non-Spirit creature.\"\nNon-Spirit creatures have \"When this creature enters, you may have it deal 3 damage to target Spirit creature.\"");
const haunting = fromText("Emergent Haunting", "Enchantment", "At the beginning of your end step, if you haven't cast a spell from your hand this turn and this enchantment isn't a creature, it becomes a 3/3 Spirit creature with flying in addition to its other types.\n{2}{U}: Surveil 1. (Look at the top card of your library. You may put it into your graveyard.)");
const noyan = fromText("Noyan Dar, Roil Shaper", "Legendary Creature — Merfolk Ally", "Whenever you cast an instant or sorcery spell, you may put three +1/+1 counters on target land you control. If you do, that land becomes a 0/0 Elemental creature with haste that's still a land.");
/** Noyan Dar is a 4/4 of mana value 5 (Mongo `cards` / `cardTagsDerived` characteristics): the printed numbers Bello's "mana value 4 or greater ... 4/4" is read against, which the ANIMATED land is not. */
noyan.card = { ...noyan.card, manaValue: 5, power: "4", toughness: "4" } as unknown as DeckCard["card"];
noyan.tags = { ...noyan.tags!, characteristics: { ...noyan.tags!.characteristics, cmc: 5, power: "4", toughness: "4" } };
const bello = fromRecords("Bello, Bard of the Brambles", "Legendary Creature — Raccoon Bard", "During your turn, each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater is a 4/4 Elemental creature in addition to its other types and has indestructible, haste, and \"Whenever this creature deals combat damage to a player, draw a card.\"",
  [{"id": 1, "abilityType": "static", "actions": [{"verb": "animate", "object": "each non-Equipment artifact and non-Aura enchantment you control with mana value 4 or greater as a 4/4 Elemental creature in addition to its other types", "fromZone": null, "toZone": null}, {"verb": "grant-ability", "object": "indestructible", "fromZone": null, "toZone": null}, {"verb": "grant-ability", "object": "haste", "fromZone": null, "toZone": null}]}, {"id": 2, "abilityType": "triggered", "trigger": {"event": "damage-dealt", "subject": "this creature", "control": "you"}, "actions": [{"verb": "draw", "object": "a card", "fromZone": null, "toZone": null, "amount": "1", "optional": false}]}]);
const greatHall = fromText("Great Hall of the Biblioplex", "Land", "{T}: Add {C}.\n{T}, Pay 1 life: Add one mana of any color. Spend this mana only to cast an instant or sorcery spell.\n{5}: If this land isn't a creature, it becomes a 2/4 Wizard creature with \"Whenever you cast an instant or sorcery spell, this creature gets +1/+0 until end of turn.\" It's still a land.");
const champion = fromText("Opal Champion", "Enchantment", "When an opponent casts a creature spell, if this permanent is an enchantment, it becomes a 3/3 Knight creature with first strike.");
const roaring = fromRecords("Roaring Earth", "Enchantment", "Landfall — Whenever a land you control enters, put a +1/+1 counter on target creature or Vehicle you control.\nChannel — {X}{G}{G}, Discard this card: Put X +1/+1 counters on target land you control. It becomes a 0/0 green Spirit creature with haste. It's still a land.",
  [{"id": 1, "abilityType": "triggered", "trigger": {"event": "enters", "subject": "a land you control", "control": "you"}, "actions": [{"verb": "add-counter", "object": "+1/+1", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}, {"id": 2, "abilityType": "activated", "actions": [{"verb": "discard", "object": "this card", "fromZone": null, "toZone": null, "amount": null, "optional": false}, {"verb": "add-counter", "object": "+1/+1", "fromZone": null, "toZone": null, "amount": "X", "optional": false}, {"verb": "animate", "object": "target land you control", "fromZone": null, "toZone": null, "amount": null, "optional": false}, {"verb": "grant-ability", "object": "haste", "fromZone": null, "toZone": null, "amount": null, "optional": false}]}]);
const reasonsFrom = (p: DeckCard, c: DeckCard): string[] => pairReasons(p, c, H).filter((r) => r.producer === p.card.name && r.consumer === c.card.name).map((r) => r.tag);

test("a card- or spell-scoped grant reaches no animated permanent: Ashling's 'Elemental permanent spells you cast from your hand gain evoke' (a hand zone) gives Brave the Wilds nothing", () => {
  expect(reasonsFrom(ashling, brave)).toEqual([]);
  expect(reasonsFrom(ashling, noyan)).toEqual([]);
});

test("a TARGET animate is shaped by what it animates, not by the animator: Bello's 4/4 permanents with mana value 4+ are no Noyan Dar (a creature that animates a LAND)", () => {
  expect(reasonsFrom(bello, noyan)).toEqual([]);
  expect(reasonsFrom(bello, brave)).toEqual([]);
});

test("a grant that works off the battlefield (unearth) reaches no animated permanent: Solemn Doomguide does not reach Great Hall of the Biblioplex", () => {
  expect(reasonsFrom(doomguide, greatHall)).toEqual([]);
});

test("a host-scoped static (an Equipment's 'Equipped creature is a Wizard') is no Wizard lord: Astrologian's Planisphere does not reach Great Hall", () => {
  expect(reasonsFrom(planisphere, greatHall)).toEqual([]);
});

test("a conditional static whose subject is mis-stored as a class (Skyknight Squire's own 'is a Knight' with three counters) reaches no Opal Champion", () => {
  expect(reasonsFrom(squire, champion)).toEqual([]);
});

test("a granted ENTERS trigger never fires for a permanent already on the battlefield: Clash of Realities' 'All Spirits have When this permanent enters' reaches no animated Spirit (Roaring Earth)", () => {
  expect(reasonsFrom(clash, roaring)).toEqual([]);
});

test("an animate with no duration of its own lasts even when its intervening if says 'this turn' (Emergent Haunting)", () => {
  expect(haunting.tags!.abilities.find((a) => a.effect.kind === "animate")?.effect).toMatchObject({ becomes: { subtype: "spirit" }, becomesLasts: true });
});

test("Gideon Jura (a stored reading, real text): `becomes` is read and does NOT last", () => {
  const e = gideon.tags!.abilities.find((a) => a.effect.kind === "animate")!.effect;
  expect(e.becomes).toMatchObject({ type: "creature", subtype: ["human", "soldier"] });
  expect(e.becomesLasts).toBeUndefined();
});

test("the sentence picks a or an from the noun: an Elemental, an Angel, an Imp, an Ape, an Elk, an Illusion, a Soldier", () => {
  const said = (kind: string) => animatedKindredSentence("L", "C", kind, true, "pump");
  for (const k of ["elemental", "angel", "imp", "ape", "elk", "illusion"]) expect(said(k), k).toContain(`C can become an ${k[0]!.toUpperCase()}${k.slice(1)},`);
  expect(said("soldier")).toContain("C can become a Soldier,");
  expect(animatedKindredSentence("L", "C", "elemental", false, "pump")).toContain("turns a permanent into an Elemental,");
});
