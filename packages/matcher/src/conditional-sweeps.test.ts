import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./conditional-sweeps.fixtures.json" with { type: "json" };

/** #1586 -- A CONDITIONAL SWEEP REACHES THE SUBTYPES ITS CONDITION LEAVES, NOT EVERY ONE. Oracle text and clause records are the corpus's own (Mongo, 2026-11-10); derive carries the condition on the sweep's emit (derive/sweep-narrowing.ts) and
 *  the matcher's `sweepsEveryPermanent` reads it. Consumers: Tiana / Mazzy (an Aura of yours dies), Teysa (a Clue of yours dies), Kirri (returns a Plant), and the self triggers of a Vehicle (Hovership, Fire Nation Warship) and an Equipment (Krovod Haunch). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const card = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const tags = (p: string, c: string): string[] => [...new Set(pairReasons(card(p), card(c), H).filter((r) => r.producer === p && r.consumer === c).map((r) => r.tag))];
const SUBTYPE_CONSUMERS = ["Tiana, Ship's Caretaker", "Mazzy, Truesword Paladin", "Teysa, Opulent Oligarch", "Kirri, Talented Sprout", "Unidentified Hovership", "Krovod Haunch", "Fire Nation Warship"];

describe("CONTROL: an unconditional sweep (Apocalypse) feeds the subtype consumers it always did", () => {
  test("Apocalypse x Kirri / Unidentified Hovership", () => {
    expect(tags("Apocalypse", "Kirri, Talented Sprout")).toContain("graveyard-recursion:plant");
    expect(tags("Apocalypse", "Unidentified Hovership")).toContain("leaves:vehicle");
  });
});

describe("a sweep whose number the player opens (X, counters) keeps every subtype: decided from the oracle text", () => {
  // "Destroy each nonland permanent with mana value X or less" / "equal to the number of charge counters": the player picks the number, so a Plant, an Aura, a Clue of any mana value is reachable.
  test.each(["Karn's Sylex", "Gaze of Granite", "Ratchet Bomb", "Engineered Explosives", "Blast Zone", "The Moment", "The Filigree Sylex"])("%s x Kirri, Tiana, Teysa", (p) => {
    expect(tags(p, "Kirri, Talented Sprout")).toContain("graveyard-recursion:plant");
    expect(tags(p, "Tiana, Ship's Caretaker")).toContain("dies:aura");
    expect(tags(p, "Teysa, Opulent Oligarch")).toContain("dies:clue");
  });
});

describe("a sweep narrowed by a fact of the permanents feeds no subtype consumer", () => {
  test.each(["Mists of Lórien", "Renet, Temporal Apprentice", "Deputy of Detention"])("%s", (p) => {
    for (const c of SUBTYPE_CONSUMERS) expect(tags(p, c), `${p} x ${c}`).toEqual([]);
  });
});

describe("Desynchronization (not historic) bounces a Plant or an Aura, never a Vehicle or a Clue", () => {
  test("x Unidentified Hovership: no leaves:vehicle", () => {
    expect(tags("Desynchronization", "Unidentified Hovership").filter((t) => t.startsWith("leaves"))).toEqual([]);
  });
  test("x Kirri: returns to hand, not the graveyard, so no recursion fill either way", () => {
    expect(tags("Desynchronization", "Kirri, Talented Sprout")).toEqual([]);
  });
});

describe("Urza, Planeswalker -10 spares the artifacts you control", () => {
  test.each(["Teysa, Opulent Oligarch", "Krovod Haunch", "Fire Nation Warship", "Unidentified Hovership"])("x %s (an artifact of yours): no pair", (c) => {
    expect(tags("Urza, Planeswalker", c).filter((t) => t.startsWith("dies") || t.startsWith("leaves"))).toEqual([]);
  });
  test.each(["Tiana, Ship's Caretaker", "Mazzy, Truesword Paladin"])("CONTROL: x %s (an Aura of yours dies): still paired", (c) => {
    expect(tags("Urza, Planeswalker", c)).toContain("dies:aura");
  });
});

describe("Glyph of Reincarnation returns only the creatures it destroyed", () => {
  test.each(["Apocalypse", "Karn's Sylex", "Urza, Planeswalker", "Ratchet Bomb"])("%s x Glyph of Reincarnation: no graveyard-recursion", (p) => {
    expect(tags(p, "Glyph of Reincarnation").filter((t) => t.startsWith("graveyard-recursion"))).toEqual([]);
  });
});
