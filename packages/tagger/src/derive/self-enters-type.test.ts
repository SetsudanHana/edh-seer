import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./self-enters-type.fixtures.json" with { type: "json" };

/** #1698: A NAMED-SELF ENTERS TRIGGER NAMES THE CARD'S OWN TYPE. "When this creature enters" derives `{type: creature, self: true}` because the noun after "this" is the type; "When U.S.S. Voyager enters" / "When Loki's Scepter enters"
 *  names the card and so derived `{self: true}` with no type at all, and a typeless self demand is met by EVERY typeless `enters` emit in the corpus (Kodama's Reach's "put one onto the battlefield tapped", Living Death, Nissa's Pilgrimage):
 *  181 of Voyager's 461 self reasons were cards that cannot put an artifact onto the battlefield. The card's own printed type line stands in (CR 205.2 card types), read on the ability's OWN face: a creature // land
 *  names the creature for its creature half, an Adventure's instant or sorcery half is no permanent and never a self entry.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 561); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const selfEntries = (name: string) => rowOf(name).tags.abilities.filter((a) => a.trigger?.verbs.includes("enters") && a.trigger.subject.self === true);
const typesOf = (name: string) => selfEntries(name).map((a) => a.trigger!.subject.type);

describe("a self enters trigger that names the card carries the card's own type", () => {
  test.each([
    ["U.S.S. Voyager, Lone Wanderer", "artifact"], // grammar
    ["Skyship Weatherlight", "artifact"], // model
    ["Loki's Scepter", "artifact"], // model
    ["Esika's Chariot", "artifact"], // a Vehicle is an artifact whether or not it is crewed
    ["Mjölnir, Hammer of Thor", "artifact"],
    ["Oath of Liliana", "enchantment"],
    ["The Grey Havens", "land"],
    ["Emry, Lurker of the Loch", "creature"],
  ])("%s -> %s", (name, type) => {
    const t = typesOf(name);
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x).toBe(type);
  });
  test("an artifact creature carries both, the creature first (its key stays `enters:creature`)", () => {
    const t = typesOf("Breya, Etherium Shaper");
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x).toEqual(["creature", "artifact"]);
  });
  // Studious First-Year is layout `prepare`; the every-face union would also give `creature`, so this pins the answer, not the face indexing (no corpus MDFC has a self enters trigger on face >= 1 at 562).
  test("a creature // sorcery card's trigger is a creature, not the sorcery beside it (Studious First-Year)", () => {
    const t = typesOf("Studious First-Year // Rampant Growth");
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x).toBe("creature");
  });
  test("a transform front face reads its own face (Brass's Tunnel-Grinder is the artifact, not the land Tecutlan)", () => {
    const a = selfEntries("Brass's Tunnel-Grinder // Tecutlan, the Searing Rift");
    expect(a.length).toBeGreaterThan(0);
    for (const x of a) expect(x.trigger!.subject.type).toBe((x.face ?? 0) === 0 ? "artifact" : "land");
  });
  test("a transform BACK face (no entry in `faces`) reads the every-face union (Tetzin // The Golden-Gear Colossus)", () => {
    const a = selfEntries("Tetzin, Gnome Champion // The Golden-Gear Colossus").filter((x) => (x.face ?? 0) === 1);
    expect(a.length).toBeGreaterThan(0);
    for (const x of a) expect(x.trigger!.subject.type).toEqual(["creature", "artifact"]);
  });
  test("CONTROL: a 'this creature' trigger keeps the type it always had", () => expect(new Set(typesOf("Mulldrifter"))).toEqual(new Set(["creature"])));
});

// The put that follows "exiles all creature cards from their graveyard" ("puts all cards they exiled this way onto the battlefield": Living Death, Living End, Scrap Mastery) is a put of that class, not of every card.
describe("a put of 'all cards they exiled this way' is a put of the class the exile named", () => {
  const puts = (name: string) => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters" && e.subject.fromZone === "exile").map((e) => e.subject.type);
  test.each([["Living Death", "creature"], ["Living End", "creature"], ["Scrap Mastery", "artifact"]])("%s -> %s", (name, type) => {
    const t = puts(name);
    expect(t.length).toBeGreaterThan(0);
    for (const x of t) expect(x).toBe(type);
  });
});
