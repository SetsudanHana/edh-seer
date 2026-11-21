import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./block-grants-1708.fixtures.json" with { type: "json" };

/** #1708: A GRANT'S RECIPIENT KEEPS ITS CONTROL, AND A GRANT TO SPELLS IS NOT A GRANT TO PERMANENTS.
 *  - "can block an additional creature each combat" reaches derive as a grant whose object is the permission alone, so the recipient was read off the OBJECT ("... a creature each combat"): "Each creature you control" lost its `you` (Brave the Sands,
 *    High Ground, Cenn's Tactician) and "This creature" became a class of creatures of any controller, not marked `self` (Foriysian Interceptor, Lairwatch Giant and 15 more); an Equipment's or Aura's host became a class too (Echo Circlet).
 *  - "Artifact spells you cast have convoke" (Chief Engineer, Hugh), "Legendary creature spells you cast have convoke" (We Ride at Dawn) and "you may cast spells as though they had flash" (Quicksilver, Speedster; Radagast) stored an artifact / creature /
 *    spell of ANY controller, in no zone, so the grant paired with a token (an opponent's Junk, your own Treasure). A grant to a spell is a grant to a card on the stack: `control: you`, `zone: stack`.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 564); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const grants = (name: string) => rowOf(name).tags.abilities.filter((a) => a.effect.kind === "keyword-grant");
/** The grant on `clause`: its subject, or "none" when the ability stores no subject at all. */
const subjectOf = (name: string, clause: number) => grants(name).find((a) => a.clause === clause)?.effect.subject;

describe("'each creature you control can block an additional creature' is YOURS", () => {
  test("Brave the Sands (clause 2) reads you, like its vigilance line", () => {
    expect(subjectOf("Brave the Sands", 1)).toMatchObject({ control: "you", type: "creature" });
    expect(subjectOf("Brave the Sands", 2)).toMatchObject({ control: "you", type: "creature", scope: "each" });
  });
  test("High Ground reads you", () => expect(subjectOf("High Ground", 1)).toMatchObject({ control: "you", type: "creature", scope: "each" }));
  test("Cenn's Tactician: 'with a +1/+1 counter on it' is a state the filter cannot hold, so no class (it never was every creature of any controller)", () => {
    const s = subjectOf("Cenn's Tactician", 2);
    expect(s?.type).toBeUndefined();
    expect(s?.scope).toBeUndefined();
  });
});

/** A STATIC KEEPS NO SUBJECT THAT NAMES NO CLASS (`namesItsTargets`): the card's own grant is stored as no subject at all, which forms no edge; `self` is kept only where the ability keeps a subject (an activated grant, Mounted Archers). */
const claimsNoClass = (s: { self?: true; type?: unknown; scope?: unknown } | undefined) => s === undefined || s.self === true;
describe("'this creature can block an additional creature' is the card itself: no class of any controller", () => {
  test.each([["Foriysian Interceptor", 3], ["Lairwatch Giant", 1], ["Palace Guard", 1]] as const)("%s", (name, clause) => {
    const s = grants(name).filter((a) => a.clause === clause).map((a) => a.effect.subject);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(claimsNoClass(x), JSON.stringify(x)).toBe(true);
  });
  test("Foriysian Totem: 'As long as this artifact is a creature, it can block ...' is the card itself", () => {
    expect(claimsNoClass(subjectOf("Foriysian Totem", 3))).toBe(true);
  });
  test("Mounted Archers' activated one keeps its subject, and it is self", () => expect(subjectOf("Mounted Archers", 2)?.self).toBe(true));
});

describe("an Equipment's or Aura's host is no class", () => {
  test("Echo Circlet ('Equipped creature can block an additional creature'): no type, no scope", () => {
    const s = subjectOf("Echo Circlet", 1);
    expect(s?.type).toBeUndefined();
    expect(s?.scope).toBeUndefined();
  });
});

describe("a grant to SPELLS you cast is yours and is no grant to a permanent", () => {
  test.each([
    ["Chief Engineer", { type: "artifact" }],
    ["Hugh, First of Many", { type: "artifact" }],
    ["We Ride at Dawn", { type: "creature", legendary: true }],
  ])("%s: control you, zone stack", (name, want) => {
    const g = grants(name);
    expect(g.length).toBeGreaterThan(0);
    for (const a of g) expect(a.effect.subject).toMatchObject({ control: "you", zone: "stack", ...want });
  });
  test("Quicksilver, Speedster: 'you may cast spells as though they had flash' is YOUR spells", () => {
    expect(subjectOf("Quicksilver, Speedster", 3)).toMatchObject({ control: "you", type: "spell", zone: "stack" });
  });
  test("Radagast: 'the first creature spell you cast each turn ... as though it had flash' is YOUR spell", () => {
    expect(subjectOf("Radagast of Rhosgobel", 1)).toMatchObject({ control: "you", zone: "stack" });
  });
  test("Anhelo ('instant or sorcery spell you cast'), already yours, is now a spell grant too", () => {
    expect(subjectOf("Anhelo, the Painter", 2)).toMatchObject({ control: "you", type: ["instant", "sorcery"], zone: "stack" });
  });
});

describe("CONTROLS: a grant that really is any stays any", () => {
  test("Winged Sliver ('All Sliver creatures have flying') is a class of any controller, on the battlefield", () => {
    const s = subjectOf("Winged Sliver", 1);
    expect(s).toMatchObject({ control: "any", subtype: "sliver", scope: "all" });
    expect(s?.zone).toBeUndefined();
  });
  test("Rolling Stones ('Wall creatures can attack as though they didn't have defender') stays any", () => {
    expect(subjectOf("Rolling Stones", 1)).toMatchObject({ control: "any", subtype: "wall" });
  });
  test("Tidal Barracuda ('Any player may cast spells as though they had flash') names no caster: any", () => {
    expect(subjectOf("Tidal Barracuda", 1)).toMatchObject({ control: "any", type: "spell" });
  });
  test("a lone 'creature spells you cast' stays refused as the whole board (Eirdu, Carrier of Dawn)", () => {
    expect(grants("Eirdu, Carrier of Dawn // Isilu, Carrier of Twilight").map((a) => a.effect.subject)).toEqual([undefined, undefined]);
  });
  test("the 'attack as though it didn't have defender' grants (Felothar) are read as before", () => {
    expect(subjectOf("Felothar the Steadfast", 2)).toBeUndefined();
  });
});
