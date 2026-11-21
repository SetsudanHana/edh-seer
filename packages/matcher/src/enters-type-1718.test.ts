import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/enters-type-1718.json" with { type: "json" };

/** #1718: A PUT THAT NAMES ITS THING ONLY ACROSS A CLAUSE BOUNDARY OR IN AN "IF IT'S A <CLASS> CARD" IS A PUT OF THAT CLASS. Otherworldly Journey ("Exile target creature. At the beginning of the next end step, return that card to the battlefield"), Primal Surge
 *  ("If it's a permanent card, you may put it onto the battlefield"), Stitch Together ("Return that card from your graveyard to the battlefield"), Sword of Hearth and Home ("put both cards") stored an `enters` emit with NO type, which no typed self trigger
 *  ("When this creature enters": Mulldrifter, #1698) hears. Cards and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 570), derived here as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
/** The reasons `producer` and `consumer` pair on, as sentences, read from both sides. */
const pair = (producer: string, consumer: string): string[] => {
  const r = analyzeDeckStructured([dc(producer), dc(consumer)], undefined, H, undefined, undefined, undefined, undefined, undefined, [], [], { skipSimulation: true });
  const side = (a: string, b: string) => r.cards.filter((c) => c.name === a).flatMap((c) => c.topPartners.filter((p) => p.name === b).flatMap((p) => p.reasons)).map((x) => `${x.tag} :: ${x.text}`);
  return [...side(producer, consumer), ...side(consumer, producer)];
};
/** The pairs formed through an `enters` event. */
const enters = (p: string, c: string): string[] => pair(p, c).filter((x) => /^enters/.test(x));
const entersTypes = (name: string): unknown[] => dc(name).tags!.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "enters").map((e) => e.subject.type);

describe("canary: Mulldrifter hears a creature returned from exile", () => {
  test("Otherworldly Journey -> Mulldrifter", () => expect(enters("Otherworldly Journey", "Mulldrifter")).not.toEqual([]));
});

describe("each family's put is typed from its antecedent", () => {
  test.each([
    // delayed return after an exile in an earlier clause
    ["Otherworldly Journey", "creature"], ["Long Road Home", "creature"], ["Vanish into Memory", "creature"], ["Koya, Death from Above", "creature"], ["Lae'zel's Acrobatics", "creature"],
    ["Planar Guide", "creature"], ["Mystifying Maze", "creature"], ["Semester's End", ["creature", "planeswalker"]], ["Venser, Visionary Traveler", "permanent"],
    // "if it's a <class> card, put it onto the battlefield"
    ["Primal Surge", "permanent"], ["Clone Shell", "creature"], ["Summoner's Egg", "creature"], ["Archdruid's Charm", "land"], ["Unexpected Results", "land"], ["Thrasios, Triton Hero", "land"],
    // "that card" from a graveyard
    ["Stitch Together", "creature"], ["Revivify", "creature"], ["Magnanimous Magistrate", "creature"],
  ])("%s -> %j", (name, type) => {
    const t = entersTypes(name);
    expect(t.length).toBeGreaterThan(0);
    expect(t[0]).toEqual(type);
  });
  // Sword of Hearth and Home: "put both cards" is two entries, the exiled creature and the searched basic land, so the land keeps its fetch (ramp) reading.
  test("Sword of Hearth and Home -> a creature from exile and a basic land from the library", () => {
    const e = dc("Sword of Hearth and Home").tags!.abilities.flatMap((a) => a.emits ?? []).filter((x) => x.verb === "enters").map((x) => [x.subject.type, x.subject.fromZone, x.subject.basic]);
    expect(e).toEqual([["creature", "exile", undefined], ["land", "library", true]]);
    expect(dc("Sword of Hearth and Home").tags!.landFetch).toBeDefined();
  });
  test.each(["Otherworldly Journey", "Long Road Home", "Stitch Together", "Primal Surge", "Summoner's Egg", "Sword of Hearth and Home"])("%s -> Mulldrifter", (p) => {
    expect(enters(p, "Mulldrifter")).not.toEqual([]);
  });
});

describe("controls", () => {
  test("a land put stays a land: Thrasios / Wild Evocation / Unexpected Results do not pair with Mulldrifter", () => {
    for (const p of ["Thrasios, Triton Hero", "Wild Evocation", "Unexpected Results"]) expect(enters(p, "Mulldrifter"), p).toEqual([]);
  });
  test("a basic-land fetch keeps its (separate) untyped put: Kodama's Reach is untouched", () => expect(entersTypes("Kodama's Reach")).toEqual([undefined]));
  test("a token create is unchanged: Raise the Alarm's Soldiers stay creature tokens", () => expect(entersTypes("Raise the Alarm")).toEqual(["creature"]));
  test("a flicker with a typed antecedent in its own clause is unchanged (Ghostly Flicker)", () => expect(entersTypes("Ghostly Flicker")).toEqual([["creature", "artifact", "land"]]));
  test("a negated condition is not read (Impromptu Raid stays untyped)", () => expect(entersTypes("Impromptu Raid")).toEqual([undefined]));
});
