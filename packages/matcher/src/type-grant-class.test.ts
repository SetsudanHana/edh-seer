import { expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/type-grant-class.json" with { type: "json" };

/** #1568, owner ruling 2026-11-08: a type grant over a WHOLE NON-CREATURE class ("artifacts you control are Foods / Clues / Equipment in addition to their other types") pairs with the cards that USE the granted
 *  type, not with every artifact that merely receives it. Creature classes (Maskwood Nexus) follow the same rule (ruling extended 2026-11-08). Stored documents and clauses dumped from Mongo 2026-11-08. */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown> & { _id: string }; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const grant = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.tag === "static:type-grant" && r.producer === p && r.consumer === c);

test("the granted type is stamped on the type-grant: food, clue, equipment", () => {
  for (const [n, t] of [["Gourmand's Talent", "food"], ["Ragost, Deft Gastronaut", "food"], ["Senator Peacock", "clue"], ["Dan Lewis", "equipment"]] as const) {
    expect(dc(n).tags!.abilities.find((a) => a.effect.kind === "type-grant")?.grantsType, n).toBe(t);
  }
});

// The ability handed out in the same sentence has the same recipient, and is the same class grant: no static tag at all pairs the producer with Sol Ring.
const staticTags = (p: string, c: string) => pairReasons(dc(p), dc(c), loadHierarchy()).filter((r) => r.producer === p && r.tag.startsWith("static:")).map((r) => r.tag);
test("the ability granted beside the type does not pair with every artifact either: Gourmand's Talent, Senator Peacock, Dan Lewis x Sol Ring have no static pair", () => {
  for (const p of ["Gourmand's Talent", "Senator Peacock", "Dan Lewis", "Ragost, Deft Gastronaut"]) expect(staticTags(p, "Sol Ring"), p).toEqual([]);
});

test("a CARD type granted to the whole board pairs with what uses that type: Enchanted Evening x Eidolon of Blossoms, not x Sol Ring; Encroaching Mycosynth x Sol Ring none", () => {
  expect(grant("Enchanted Evening", "Eidolon of Blossoms")).not.toEqual([]);
  expect(grant("Enchanted Evening", "Sol Ring")).toEqual([]);
  expect(grant("Encroaching Mycosynth", "Grizzly Bears")).toEqual([]);
});

test("Gourmand's Talent pairs with no artifact that merely receives Food: not Sol Ring", () => {
  expect(grant("Gourmand's Talent", "Sol Ring")).toEqual([]);
  expect(grant("Senator Peacock", "Sol Ring")).toEqual([]);
  expect(grant("Dan Lewis", "Sol Ring")).toEqual([]);
});

test("Gourmand's Talent and Ragost pair with a card that uses Food", () => {
  for (const c of ["Peregrin Took", "Gilded Goose"]) {
    expect(grant("Gourmand's Talent", c), c).not.toEqual([]);
    expect(grant("Ragost, Deft Gastronaut", c), c).not.toEqual([]);
  }
  // ...and not with a card that uses Clues only
  expect(grant("Gourmand's Talent", "Tireless Tracker")).toEqual([]);
});

test("Senator Peacock pairs with a Clue payoff, Dan Lewis with an Equipment payoff", () => {
  expect(grant("Senator Peacock", "Tireless Tracker")).not.toEqual([]);
  for (const c of ["Puresteel Paladin", "Adelbert Steiner"]) expect(grant("Dan Lewis", c), c).not.toEqual([]);
  expect(grant("Senator Peacock", "Peregrin Took")).toEqual([]);
});

// Owner ruling 2026-11-08 (extends the class ruling to creatures): a grant over the whole CREATURE class pairs with the cards that USE the granted type, not with every creature it reaches.
test("a named creature type granted to every creature pairs with its payoffs and lords, not with Grizzly Bears: Hivestone, March of the World Ooze, Roshan, Graaz", () => {
  expect(grant("Hivestone", "Grizzly Bears")).toEqual([]);
  expect(grant("Hivestone", "Muscle Sliver")).not.toEqual([]);
  for (const p of ["March of the World Ooze", "Roshan, Hidden Magister", "Graaz, Unstoppable Juggernaut"]) expect(grant(p, "Grizzly Bears"), p).toEqual([]);
  expect(staticTags("Hivestone", "Grizzly Bears")).toEqual([]);
  // The 6/6 base set beside the type grant (#1572) is its own ability and pairs with the 2/2 it upgrades: only the TYPE half is gated here.
  expect(staticTags("March of the World Ooze", "Grizzly Bears")).toEqual(["static:base-pt-set"]);
});

test("every creature type, or a chosen one, pairs with the cards that care about a creature type: Maskwood Nexus, Arcane Adaptation, Xenograft, Leyline of Transformation", () => {
  for (const p of ["Maskwood Nexus", "Arcane Adaptation", "Xenograft", "Leyline of Transformation"]) {
    expect(grant(p, "Grizzly Bears"), p).toEqual([]);
    expect(grant(p, "Elvish Archdruid"), p).not.toEqual([]);
  }
});

// #1568 final review: a grant of every / the chosen creature type gives a changeling nothing and a card that only EXCLUDES, fights or makes a type no payoff. Read from `usesCreatureType`, not `caresAboutCreatureType` (the chosen-type demand test).
test("every creature type pairs with a card that uses a creature type: Maskwood Nexus x Lord of Atlantis keeps its pair", () => {
  expect(grant("Maskwood Nexus", "Lord of Atlantis")).not.toEqual([]);
});

test("every creature type gives a changeling and a card that excludes, fights, or makes a type nothing: Maskwood Nexus x Changeling Outcast, Rend Flesh, Scorch the Fields, Rusted Relic, Garth One-Eye none", () => {
  for (const c of ["Changeling Outcast", "Rend Flesh", "Scorch the Fields", "Rusted Relic", "Garth One-Eye"]) {
    expect(grant("Maskwood Nexus", c), c).toEqual([]);
    expect(grant("Arcane Adaptation", c), c).toEqual([]);
  }
});

test("a grant that reaches creature spells and cards off the battlefield (Maskwood Nexus, Arcane Adaptation) is used by a tutor and a cost reducer; Xenograft, which reaches the battlefield only, is not", () => {
  for (const c of ["Goblin Matron", "Goblin Warchief"]) {
    expect(grant("Maskwood Nexus", c), c).not.toEqual([]);
    expect(grant("Arcane Adaptation", c), c).not.toEqual([]);
  }
  expect(grant("Xenograft", "Goblin Matron")).toEqual([]);
  expect(grant("Xenograft", "Elvish Archdruid")).not.toEqual([]);
});

test("a card type granted to creatures pairs with what uses it: The Flesh Is Weak x Sol Ring none", () => {
  expect(grant("The Flesh Is Weak", "Sol Ring")).toEqual([]);
  expect(grant("The Flesh Is Weak", "Grizzly Bears")).toEqual([]);
});

// #1568 review 2 (Opus): the grant reaches BATTLEFIELD permanents, so a library search, a graveyard return, a cast trigger or a spell cost reducer that names Equipment does not use the granted type.
test("Dan Lewis does not pair with a card that reads Equipment in the library, a graveyard, on the stack or in a spell's cost", () => {
  for (const c of ["Stoneforge Mystic", "Steelshaper's Gift", "Sram, Senior Edificer", "Danitha Capashen, Paragon", "Galea, Kindler of Hope", "Auriok Survivors"]) expect(grant("Dan Lewis", c), c).toEqual([]);
});

// A maker's trigger or cost still uses the type: "Whenever you sacrifice a Food, create <another token>" is a Food user; only the token it creates is not a use.
test("a trigger that sacrifices the granted type pairs even when the ability makes another token (Confectioner, Ulvenwald Mysteries, Chishiro)", () => {
  expect(grant("Gourmand's Talent", "Experimental Confectioner")).not.toEqual([]);
  expect(grant("Senator Peacock", "Ulvenwald Mysteries")).not.toEqual([]);
  expect(grant("Dan Lewis", "Chishiro, the Shattered Blade")).not.toEqual([]);
});

// Effect-side use: a sacrifice or an attach inside the effect, and forage (which is sacrificing a Food).
test("a sacrifice or attach inside the effect, and forage, count as use (Campsite Cuisine, Pippin's Bravery, Treetop Sentries, Brass Squire, Armory Automaton)", () => {
  for (const c of ["Campsite Cuisine", "Pippin's Bravery", "Treetop Sentries"]) expect(grant("Gourmand's Talent", c), c).not.toEqual([]);
  for (const c of ["Brass Squire", "Armory Automaton"]) expect(grant("Dan Lewis", c), c).not.toEqual([]);
});

// A subtype that comes from the card's own name is no use of the type.
test("Food Fight's own name is no Food use", () => {
  expect(grant("Gourmand's Talent", "Food Fight")).toEqual([]);
});

// The recipient stops at the verb through every path, so the granted type is no class: Hivestone reaches creatures, not Slivers; Ashaya reaches creatures, not Forests; The Flesh Is Weak reaches creatures, not Sol Ring.
test("a type-grant whose sentence has no grant verb leaves the granted type out of its recipient", () => {
  expect(grant("Ashaya, Soul of the Wild", "Grizzly Bears")).toEqual([]);
  expect(grant("Ashaya, Soul of the Wild", "Forest")).toEqual([]);
  expect(grant("The Flesh Is Weak", "Sol Ring")).toEqual([]);
});
