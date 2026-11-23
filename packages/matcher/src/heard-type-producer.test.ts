import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./heard-type-producer.fixtures.json" with { type: "json" };

/** #1235: A PRODUCER'S OWN TYPE LINE MUST BE ABLE TO BE THE TYPE THE TRIGGER HEARD. A Vehicle is an artifact and no creature until it is crewed
 *  (CR 301.7), so "When Mole Module enters" cannot be what a creature-enters trigger hears; the relation is real (it puts a permanent card onto the
 *  battlefield, or returns creature cards), only the sentence named the wrong object. Oracle text and clause records are the corpus's own (Mongo,
 *  2026-11-23); the tags are derived here, so the cards move with DERIVE_VERSION. */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const card = (name: string): DeckCard => ({ card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const rows = (p: string, c: string) => pairReasons(card(p), card(c), H).filter((r) => r.producer === p && r.consumer === c);
const row = (p: string, c: string, tag: string) => rows(p, c).filter((r) => r.tag === tag);

describe("a producer that cannot be the heard type does not read as the entering object", () => {
  test.each([
    ["Mole Module", "Soul Warden"], // puts a permanent card from the graveyard onto the battlefield
    ["Karn Liberated", "Soul Warden"], // puts the cards it exiled onto the battlefield
    ["Mirror of Life Trapping", "Soul Warden"],
    ["Dune Drifter", "Weftstalker Ardent"], // returns "artifact or creature" cards; the trigger hears creature or artifact
    ["The Mind Stone", "Weftstalker Ardent"], // flickers a nonland permanent
  ])("%s -> %s: the creature-enters row names the creature, not the card", (p, c) => {
    const rs = row(p, c, "enters:creature");
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) {
      expect(r.text).not.toContain(`When ${p} enters`);
      expect(r.text).toContain(`When a creature enters thanks to ${p}`);
    }
  });

  test("Karn Liberated -> Reckless Fireweaver: an artifact enters, not the planeswalker", () => {
    const rs = row("Karn Liberated", "Reckless Fireweaver", "enters:artifact");
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.text).toContain("When an artifact enters thanks to Karn Liberated");
  });

  test("Karn Liberated -> Soul Warden names a creature, not the emit's class", () => {
    for (const r of row("Karn Liberated", "Soul Warden", "enters:creature")) expect(r.text).toContain("When a creature enters thanks to Karn Liberated, Soul Warden gains you 1 life");
  });
});

describe("the noun is the type the tag claims", () => {
  test("Aether Barrier -> Adarkar Valkyrie: dies:creature reads 'a creature dies thanks to', not 'a permanent'", () => {
    const rs = row("Aether Barrier", "Adarkar Valkyrie", "dies:creature");
    expect(rs.length).toBeGreaterThan(0);
    for (const r of rs) expect(r.text).toContain("When a creature dies thanks to Aether Barrier");
  });
});

describe("GUARDS: what can be the heard type keeps its wording", () => {
  test("a Vehicle still enters as an artifact", () => {
    const rs = row("Dune Drifter", "Weftstalker Ardent", "enters:artifact");
    expect(rs.map((r) => r.text)).toContain("When Dune Drifter enters, Weftstalker Ardent deals 1 damage");
    expect(row("Mole Module", "Reckless Fireweaver", "enters:artifact").map((r) => r.text).join("\n")).toContain("When Mole Module enters");
  });
  test("Solemn Simulacrum, an artifact creature, still enters as a creature and as an artifact", () => {
    for (const [c, tag] of [["Soul Warden", "enters:creature"], ["Reckless Fireweaver", "enters:artifact"]] as const) {
      const rs = row("Solemn Simulacrum", c, tag);
      expect(rs.length).toBeGreaterThan(0);
      for (const r of rs) expect(r.text).toContain("When Solemn Simulacrum enters");
    }
  });
  test("Esika's Chariot supplies no creature enters of its own: the Cats it makes are tokens, not the Vehicle", () => {
    for (const r of rows("Esika's Chariot", "Soul Warden")) expect(r.text).not.toContain("When Esika's Chariot enters, Soul Warden");
  });
});
