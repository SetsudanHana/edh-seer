import { describe, expect, test } from "vitest";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./aura-host-control.fixtures.json" with { type: "json" };

/** WHOSE CREATURE THE AURA GOES ON (#1513, CR 704.5m: an Aura attached to an illegal object or to nothing goes to its
 *  owner's graveyard). `chars.enchants` carries `control: "any"` for every plain "Enchant creature" Aura, so the host's
 *  side is read off what the Aura does to it. Fixtures are STORED rows (`cardTagsDerived` by `oracleId` = `cards._id`, DERIVE 452). */
const F = fixtures as unknown as Record<string, DeckCard>;
const H: Hierarchy = {};
const auraDies = (producer: DeckCard, aura: string) =>
  pairReasonsAcrossFaces(producer, F[aura]!, H).filter((r) => r.tag === "dies:aura" || r.tag === "leaves:aura");
/** The same producer with every creature it moves read as `control`. */
const moving = (p: DeckCard, control: "you" | "opp" | "any"): DeckCard => ({
  ...p,
  tags: { ...p.tags!, abilities: p.tags!.abilities.map((a) => ({ ...a, emits: a.emits?.map((e) => e.subject.type === "creature" ? { ...e, subject: { ...e.subject, control } } : e) })) },
});

describe("a producer moving YOUR creature does not feed an Aura that goes on an opponent's", () => {
  test.each(["Bitter Chill", "Cessation", "Despondency", "Sluggishness", "Slow Motion"])("Dawn of the Dead -> %s: no host-leaves reason", (aura) => {
    expect(auraDies(F["Dawn of the Dead"]!, aura)).toEqual([]);
  });
  test.each(["Bitter Chill", "Cessation"])("a sacrifice outlet (Viscera Seer) -> %s: none", (aura) => {
    expect(auraDies(F["Viscera Seer"]!, aura)).toEqual([]);
  });
});

describe("kept", () => {
  test.each(["Rancor", "Aspect of Mongoose", "Undying Rage"])("Dawn of the Dead -> %s still forms its reason (an own-side Aura)", (aura) => {
    expect(auraDies(F["Dawn of the Dead"]!, aura).length).toBeGreaterThan(0);
  });
  test.each(["Bitter Chill", "Cessation", "Slow Motion"])("a removal spell of an opponent's creature (Murder) -> %s", (aura) => {
    expect(auraDies(F["Murder"]!, aura).length).toBeGreaterThan(0);
  });
  test("a producer whose creature side is 'any' still feeds a debuff Aura", () => {
    expect(auraDies(moving(F["Viscera Seer"]!, "any"), "Bitter Chill").length).toBeGreaterThan(0);
  });
  test("an own-side Aura is fed by an opponent-side producer too (not narrowed here)", () => {
    expect(auraDies(F["Murder"]!, "Rancor").length).toBeGreaterThan(0);
  });
  test("Krovikan Whispers (you control the host; the trigger is a drawback) is left as it was", () => {
    expect(auraDies(F["Viscera Seer"]!, "Krovikan Whispers").length).toBeGreaterThan(0);
  });
  test("a printed control is honoured by subjectMatches already (synthetic: Rancor enchanting an opponent's creature / one you control)", () => {
    const on = (control: "opp" | "you"): DeckCard => ({ ...F["Rancor"]!, tags: { ...F["Rancor"]!.tags!, characteristics: { ...F["Rancor"]!.tags!.characteristics, enchants: { ...F["Rancor"]!.tags!.characteristics.enchants!, control } } } });
    expect(pairReasonsAcrossFaces(F["Dawn of the Dead"]!, on("opp"), H).filter((r) => r.tag === "dies:aura")).toEqual([]);
    expect(pairReasonsAcrossFaces(F["Murder"]!, on("you"), H).filter((r) => r.tag === "dies:aura")).toEqual([]);
  });
});
