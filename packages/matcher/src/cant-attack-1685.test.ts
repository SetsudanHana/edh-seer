import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/cant-attack-1685.json" with { type: "json" };

/** #1685: a creature whose OWN text says it can't attack (CR 508.1c) or can't block (CR 509.1b) is no attacker or blocker, so it supplies neither the implied `attacks` nor the implied `blocks` event. Production fixtures: the card
 *  documents and the clauses derive reads (stored `cardClauses.canonical`, or the grammar's records for a card derive-corpus reads from its printed text), dumped from Mongo 2026-11-22 (DERIVE 576). */
const F = fixtures as unknown as Record<string, { source: Record<string, unknown>; canonical: ClauseRecord[] }>;
const dc = (name: string): DeckCard => ({
  card: F[name]!.source as unknown as DeckCard["card"],
  tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags,
});
const H = loadHierarchy();
const hellrider = dc("Hellrider"); // "Whenever a creature you control attacks, ..."
const moria = dc("Moria Marauder"); // "Whenever a Goblin or Orc you control deals combat damage to a player, ..."
const shell = dc("Heroes in a Half Shell"); // "Whenever one or more Mutants, Ninjas, and/or Turtles you control deal combat damage to a player, ..."
const noble = dc("Noble Stand"); // "Whenever a creature you control blocks, you gain 2 life."
const heard = (producer: string, consumer: DeckCard, verb: string) => pairReasons(dc(producer), consumer, H).map((r) => r.tag).filter((t) => t.startsWith(verb + ":"));
const selfRestricts = (name: string) => (dc(name).tags?.abilities ?? []).filter((a) => a.effect.kind === "restriction").map((a) => a.selfRestricts === true);

describe("a creature that can't attack or block supplies neither", () => {
  test.each(["Grakk the Pacifist", "Vigean Hydropon"])("%s: no attacks:creature to an attack payoff, no blocks:creature to a block payoff", (producer) => {
    expect(selfRestricts(producer)).toEqual([true]);
    expect(heard(producer, hellrider, "attacks")).toEqual([]);
    expect(heard(producer, noble, "blocks")).toEqual([]);
  });
  test("Gravecrawler (This creature can't block) is no blocker but still attacks", () => {
    expect(heard("Gravecrawler", noble, "blocks")).toEqual([]);
    expect(heard("Gravecrawler", hellrider, "attacks")).not.toEqual([]);
  });
  test("Inkfathom Infiltrator ('can't block and can't be blocked') is no blocker but still attacks", () => {
    expect(heard("Inkfathom Infiltrator", noble, "blocks")).toEqual([]);
    expect(heard("Inkfathom Infiltrator", hellrider, "attacks")).not.toEqual([]);
  });
});

describe("a restriction that is conditional, partial or someone else's changes nothing", () => {
  test("Phyrexian Marauder 'can't attack unless you pay': still attacks (only its can't-block is read)", () => {
    expect(heard("Phyrexian Marauder", hellrider, "attacks")).not.toEqual([]);
    expect(heard("Phyrexian Marauder", noble, "blocks")).toEqual([]);
  });
  test.each(["Ember Beast", "Pipsqueak, Rebel Strongarm"])("%s 'can't attack (or block) alone': still attacks and blocks", (producer) => {
    expect(selfRestricts(producer)).toEqual([]);
    expect(heard(producer, hellrider, "attacks")).not.toEqual([]);
  });
  test("Kulrath Knight's 'creatures your opponents control with counters can't attack or block' is not its own restriction", () => {
    expect(selfRestricts("Kulrath Knight")).toEqual([false]);
    expect(heard("Kulrath Knight", hellrider, "attacks")).not.toEqual([]);
    expect(heard("Kulrath Knight", noble, "blocks")).not.toEqual([]);
  });
  test("Postmortem Professor: can't block, but its attack trigger and its implied attack are untouched", () => {
    expect(heard("Postmortem Professor", noble, "blocks")).toEqual([]);
    expect(heard("Postmortem Professor", hellrider, "attacks")).not.toEqual([]);
  });
});

describe("an ordinary creature is unchanged", () => {
  test("Grizzly Bears attacks and blocks", () => {
    expect(selfRestricts("Grizzly Bears")).toEqual([]);
    expect(heard("Grizzly Bears", hellrider, "attacks")).not.toEqual([]);
    expect(heard("Grizzly Bears", noble, "blocks")).not.toEqual([]);
  });
});

/** CR 510.1a: only an attacking or a blocking creature assigns combat damage, so a creature barred from BOTH supplies no `combat-damage` either; one barred from blocking alone still attacks and connects. */
describe("a creature that can neither attack nor block deals no combat damage", () => {
  test("Grakk the Pacifist (an Orc) is not heard by Moria Marauder's combat-damage payoff", () => {
    expect(heard("Grakk the Pacifist", moria, "combat-damage")).toEqual([]);
  });
  test("Vigean Hydropon (a Mutant) is not heard by Heroes in a Half Shell", () => {
    expect(heard("Vigean Hydropon", shell, "combat-damage")).toEqual([]);
  });
  test("Goblin Raider (a Goblin; 'This creature can't block' only) still supplies combat-damage", () => {
    expect(heard("Goblin Raider", moria, "combat-damage")).not.toEqual([]);
  });
});
