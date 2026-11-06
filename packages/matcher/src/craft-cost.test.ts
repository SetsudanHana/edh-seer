import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";

/** THE CRAFT COST (#1500, owner ruling 2026-11-06). Craft (CR 702.167a) is an activated ability whose cost exiles its materials, from the battlefield or a graveyard (702.167b). Market Gnome's
 *  "exiled from the battlefield while you're activating a craft ability" hears only that exile, never an ordinary exile or flicker. Real oracle text (Mongo `cards`, read 2026-11-06). */
const H = loadHierarchy();
function fromText(name: string, typeLine: string, oracleText: string, keywords: string[] = []): DeckCard {
  const card = { name, typeLine, oracleText, keywords };
  const g = grammarClauseRecords(card);
  expect(g.complete, name).toBe(true);
  const tags = deriveCardTags(deriveInputOf(card as never, name, name, g.records, undefined, g.readings)) as CardTags;
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags };
}
/** Not grammar-complete: the STORED reading (Mongo `cardClauses`, `canonical`, verbatim) is derived. */
function fromRecords(name: string, typeLine: string, oracleText: string, keywords: string[], records: unknown[]): DeckCard {
  const card = { name, typeLine, oracleText, keywords };
  return { card: { ...card, colors: [], manaValue: 0 } as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(card as never, name, name, records as never)) as CardTags };
}

const gnome = fromText("Market Gnome", "Artifact Creature — Gnome", "When this creature dies, you gain 1 life and draw a card.\nWhen this creature is exiled from the battlefield while you're activating a craft ability, you gain 1 life and draw a card.");
const tithing = fromText("Tithing Blade // Consuming Sepulcher", "Artifact // Artifact", "When this artifact enters, each opponent sacrifices a creature of their choice.\nCraft with creature {4}{B} ({4}{B}, Exile this artifact, Exile a creature you control or a creature card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)\n//\nAt the beginning of your upkeep, each opponent loses 1 life and you gain 1 life.", ["Craft", "Transform"]);
const oteclan = fromText("Oteclan Landmark // Oteclan Levitator", "Artifact // Artifact Creature — Golem", "When this artifact enters, scry 2.\nCraft with artifact {2}{W} ({2}{W}, Exile this artifact, Exile another artifact you control or an artifact card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)\n//\nFlying\nWhenever this creature attacks, target attacking creature without flying gains flying until end of turn.", ["Craft", "Transform", "Flying", "Scry"]);
const hulk = fromText("Waterlogged Hulk // Watertight Gondola", "Artifact // Artifact — Vehicle", "{T}: Mill a card. (Put the top card of your library into your graveyard.)\nCraft with Island {3}{U} ({3}{U}, Exile this artifact, Exile an Island you control or an Island card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)\n//\nVigilance\nDescend 8 — This Vehicle can't be blocked as long as there are eight or more permanent cards in your graveyard.\nCrew 1 (Tap any number of creatures you control with total power 1 or more: This Vehicle becomes an artifact creature until end of turn.)", ["Craft", "Vigilance", "Transform", "Descend", "Crew", "Mill"]);
const stonetree = fromText("Kaslem's Stonetree // Kaslem's Strider", "Artifact // Artifact Creature — Golem", "When this artifact enters, look at the top six cards of your library. You may put a land card from among them onto the battlefield tapped. Put the rest on the bottom in a random order.\nCraft with Cave {5}{G} ({5}{G}, Exile this artifact, Exile a Cave you control or a Cave card from your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)\n//\n", ["Craft", "Transform"]);
const throne = fromRecords("Throne of the Grim Captain // The Grim Captain", "Legendary Artifact // Legendary Creature — Skeleton Spirit Pirate", "{T}: Mill two cards.\nCraft with a Dinosaur, a Merfolk, a Pirate, and a Vampire {4} ({4}, Exile this artifact, Exile the four from among permanents you control and/or cards in your graveyard: Return this card transformed under its owner's control. Craft only as a sorcery.)\n//\nMenace, trample, lifelink, hexproof\nWhenever The Grim Captain attacks, each opponent sacrifices a nonland permanent of their choice. Then you may put an exiled creature card used to craft The Grim Captain onto the battlefield under your control tapped and attacking.", ["Lifelink", "Craft", "Transform", "Hexproof", "Trample", "Menace", "Mill"], [
  { id: 1, abilityType: "activated", actions: [{ verb: "mill", object: "two cards", fromZone: null, toZone: null, amount: "2", optional: false }] },
  { id: 2, abilityType: "static", actions: [{ verb: "other", object: "Craft with a Dinosaur, a Merfolk, a Pirate, and a Vampire", fromZone: null, toZone: null, amount: null, optional: false }] },
  { id: 3, abilityType: "none", actions: [{ verb: "none", object: "Menace, trample, lifelink, hexproof", fromZone: null, toZone: null }] },
  { id: 4, abilityType: "triggered", trigger: { event: "attacks", subject: "The Grim Captain", control: "you" }, actions: [{ verb: "sacrifice", object: "a nonland permanent of their choice", fromZone: null, toZone: null, amount: null, optional: false }, { verb: "put", object: "an exiled creature card used to craft The Grim Captain", fromZone: "exile", toZone: "battlefield", amount: null, optional: true }, { verb: "tap", object: "it", fromZone: null, toZone: null, amount: null, optional: false }] },
]);
const swords = fromText("Swords to Plowshares", "Instant", "Exile target creature. Its controller gains life equal to its power.");
const ephemerate = fromText("Ephemerate", "Instant", "Exile target creature you control, then return it to the battlefield under its owner's control.\nRebound (If you cast this spell from your hand, exile it as it resolves. At the beginning of your next upkeep, you may cast this card from exile without paying its mana cost.)", ["Rebound"]);
const cloudshift = fromText("Cloudshift", "Instant", "Exile target creature you control, then return that card to the battlefield under your control.");

/** What the Gnome's craft trigger hears from `producer`: the reasons that name the Gnome as the consumer of an exile. */
const heardBy = (producer: DeckCard) => pairReasons(producer, gnome, H).filter((r) => r.producer === producer.card.name && r.consumer === "Market Gnome" && r.tag.startsWith("exiled"));

test("Market Gnome's trigger is read, with the craft cost as its narrowing, not refused", () => {
  expect(gnome.tags!.unknownTriggers ?? []).toEqual([]);
  const t = gnome.tags!.abilities.filter((a) => a.clause === 2).map((a) => a.trigger);
  expect(t.length).toBeGreaterThan(0);
  for (const x of t) {
    expect(x?.verbs).toEqual(["exiled"]);
    expect(x?.subject).toMatchObject({ self: true, fromZone: "battlefield", viaCraft: true });
  }
});

test("a craft ability's materials are an exile from the battlefield and the graveyard that carries the craft marker", () => {
  const exiles = tithing.tags!.abilities.filter((a) => a.kind === "activated").flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled");
  expect(exiles.map((e) => [e.subject.type, e.subject.fromZone, e.subject.viaCraft])).toEqual([["creature", "battlefield", true], ["creature", "graveyard", true]]);
});

test("Market Gnome pairs with the craft cards whose materials it can be", () => {
  expect(heardBy(tithing).length).toBeGreaterThan(0); // creature
  expect(heardBy(oteclan).length).toBeGreaterThan(0); // artifact
});

test("Market Gnome pairs with no craft card whose materials exclude it (Island, Cave, a Dinosaur, a Merfolk, a Pirate and a Vampire)", () => {
  expect(heardBy(hulk)).toEqual([]);
  expect(heardBy(stonetree)).toEqual([]);
  expect(heardBy(throne)).toEqual([]);
});

test("an ordinary exile or flicker does not reach Market Gnome's craft trigger (the 266 false pairs)", () => {
  for (const p of [swords, ephemerate, cloudshift]) expect(heardBy(p), p.card.name).toEqual([]);
});

test("a craft exile is a real exile and leave: it still feeds an ordinary leaves payoff (Ninth Bridge Patrol)", () => {
  const patrol = fromText("Ninth Bridge Patrol", "Creature — Dwarf Soldier", "Whenever another creature you control leaves the battlefield, put a +1/+1 counter on this creature.");
  expect(pairReasons(tithing, patrol, H).filter((r) => r.producer === tithing.card.name && r.consumer === "Ninth Bridge Patrol").length).toBeGreaterThan(0);
});
