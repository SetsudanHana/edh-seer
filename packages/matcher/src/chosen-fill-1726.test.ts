import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags, SubjectFilter } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import { graveyardFillMatches } from "./subject.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/chosen-fill-1726.json" with { type: "json" };

/** #1726: A CHOSEN TYPED GRAVEYARD FILL (a tutor put into a graveyard: Buried Alive, Jarad's Orders, Fork in the Road, Realms Uncharted) reaches a consumer that narrows INSIDE its class, as the untyped Entomb does:
 *  Abiding Grace's "creature card with mana value 1", Goryo's Vengeance's "legendary creature", Titania's "Forest". It never reaches a consumer outside the class, and a random fill (a mill) stays strict. Cards and stored
 *  `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 568), derived here as derive-corpus derives them. */
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
  // a double-faced card is reported by its faces ("Kaldring, the Rimestaff")
  const is = (x: string, name: string) => x === name || name.split(" // ").includes(x);
  const side = (a: string, b: string) => r.cards.filter((c) => is(c.name, a)).flatMap((c) => c.topPartners.filter((p) => is(p.name, b)).flatMap((p) => p.reasons)).map((x) => `${x.tag} :: ${x.text}`);
  return [...side(producer, consumer), ...side(consumer, producer)];
};
const FILL = /^(?:graveyard-recursion|scales|threshold|enters-graveyard)/;
const fills = (p: string, c: string): string[] => pair(p, c).filter((x) => FILL.test(x));

describe("a chosen typed fill reaches a consumer that narrows inside its class", () => {
  test.each([
    ["Jarad's Orders", "Abiding Grace"], ["Jarad's Orders", "Disa the Restless"], ["Jarad's Orders", "Corpse Cur"], ["Jarad's Orders", "Revive"], ["Jarad's Orders", "Charred Graverobber"],
    ["Fork in the Road", "Titania, Nature's Force"], ["Fork in the Road", "Jorn, God of Winter // Kaldring, the Rimestaff"],
    ["Buried Alive", "Goryo's Vengeance"], ["Buried Alive", "Abiding Grace"], ["Buried Alive", "Corpse Cur"],
    ["Realms Uncharted", "Lodestone Bauble"], ["Realms Uncharted", "Planar Birth"]
  ])("%s -> %s", (p, c) => {
    expect(fills(p, c)).not.toEqual([]);
  });
});

/** Eerie Ultimatum is three colours and a two-card deck cannot satisfy its mana audit, so its pairs are read at the matcher's own seam: the fill the producer emits against the recursion subject the consumer states. */
const fillOf = (name: string) => (dc(name).tags!.abilities.flatMap((a) => a.emits ?? []).find((e) => e.verb === "enters-graveyard")!).subject as SubjectFilter;
const entered = (name: string) => ({ ...fillOf(name), zone: "graveyard" });
const recursionOf = (name: string) => dc(name).tags!.abilities.find((a) => a.effect?.kind === "graveyard-recursion")!.effect!.subject as SubjectFilter;
describe("Eerie Ultimatum's 'permanent cards with different names' (a count of the fill's own cards, not a card property)", () => {
  test.each(["Jarad's Orders", "Fork in the Road", "Buried Alive"])("%s fill meets it", (p) => {
    expect(graveyardFillMatches(entered(p), recursionOf("Eerie Ultimatum"), H)).toBe(true);
  });
});

describe("derive marks every searched put as from the library", () => {
  test.each(["Realms Uncharted", "Carnivorous Cultivator // Enroot", "Fork in the Road", "Buried Alive"])("%s: the graveyard put says fromZone library (the model stored no origin for Realms and Carnivorous Cultivator)", (n) => {
    expect(fillOf(n).fromZone).toBe("library");
  });
});

describe("it never reaches a consumer outside its class", () => {
  test.each([
    // A BARE "artifact card" demand is outside a creature's class: it is met only if the chosen creature is also an artifact, which only a deck that holds one can say. Deck-gated reach: #1731.
    ["Jarad's Orders", "Ultron's Auxiliary"], ["Jarad's Orders", "Ultron the Annihilator"], ["Buried Alive", "Ultron's Auxiliary"],
    // a keyword no creature carries (awaken is on spells only); an origin that is not the battlefield; a Dragon is a creature, never a land
    ["Buried Alive", "Halimar Tidecaller"], ["Buried Alive", "Yomiji, Who Bars the Way"], ["Entomb", "Yomiji, Who Bars the Way"], ["Jarad's Orders", "Yomiji, Who Bars the Way"],
    ["Scion of the Ur-Dragon", "Planar Birth"], ["Scion of the Ur-Dragon", "Groundskeeper"], ["Scion of the Ur-Dragon", "The Eighth Doctor"],
    ["Fork in the Road", "Abiding Grace"], ["Fork in the Road", "Raise Dead"], ["Fork in the Road", "Goryo's Vengeance"], ["Realms Uncharted", "Raise Dead"],
    ["Jarad's Orders", "Practiced Scrollsmith"], ["Buried Alive", "Practiced Scrollsmith"], ["Jarad's Orders", "Titania, Nature's Force"], ["Buried Alive", "Planar Birth"], ["Jarad's Orders", "Salvaging Station"],
  ])("%s -> %s stays unpaired", (p, c) => {
    expect(fills(p, c)).toEqual([]);
  });
});

describe("CONTROLS: the untyped Entomb and a random mill are as before", () => {
  test("Corpse Cur (infect) still pairs: creatures carry infect", () => {
    expect(fills("Buried Alive", "Corpse Cur")).not.toEqual([]);
  });
  test.each(["Abiding Grace", "Goryo's Vengeance", "Titania, Nature's Force"])("Entomb -> %s still pairs (untyped wildcard)", (c) => {
    expect(fills("Entomb", c)).not.toEqual([]);
  });
  test.each(["Abiding Grace", "Goryo's Vengeance"])("Stitcher's Supplier -> %s still pairs (an untyped mill is a wildcard)", (c) => {
    expect(fills("Stitcher's Supplier", c)).not.toEqual([]);
  });
  test("Stitcher's Supplier -> Practiced Scrollsmith: a mill does not promise a noncreature (#716)", () => {
    expect(fills("Stitcher's Supplier", "Practiced Scrollsmith")).toEqual([]);
  });
});

describe("what a chosen fill cannot be, read at the seam (consumer subjects as derive stores them)", () => {
  const fill = (s: object) => ({ control: "you", token: null, fromZone: "library", zone: "graveyard", ...s }) as never;
  const demand = (s: object) => ({ control: "you", token: null, zone: "graveyard", ...s }) as never;
  const meets = (f: object, d: object) => graveyardFillMatches(fill(f), demand(d), H);
  test("a BASIC land is never legendary or historic, and holds only the five basic land types", () => {
    expect(meets({ type: "land", basic: true }, { historic: true })).toBe(false);
    expect(meets({ type: "land", basic: true }, { type: "land", legendary: true })).toBe(false);
    expect(meets({ type: "land", basic: true }, { subtype: "desert" })).toBe(false);
    expect(meets({ type: "land", basic: true }, { subtype: "forest" })).toBe(true);
    expect(meets({ type: "land", basic: true }, { type: "permanent", snow: true })).toBe(true);
  });
  test("a nonbasic land chosen can be legendary, a Desert or basic", () => {
    expect(meets({ type: "land" }, { historic: true })).toBe(true);
    expect(meets({ type: "land" }, { subtype: "desert" })).toBe(true);
    expect(meets({ type: "land" }, { type: "land", basic: true })).toBe(true);
  });
  test("a land never meets a creature or artifact demand; an artifact fill does not meet 'creature card'", () => {
    expect(meets({ type: "land" }, { type: "creature" })).toBe(false);
    expect(meets({ type: "land" }, { type: "artifact" })).toBe(false);
    expect(meets({ type: "artifact" }, { type: "creature", stats: [{ metric: "mana-value", op: "eq", value: 1 }] })).toBe(false);
  });
  test("a creature fill: inside-class narrowings, an artifact beside it, never 'noncreature', 'basic' or a land", () => {
    expect(meets({ type: "creature" }, { type: "creature", legendary: true, subtype: "lhurgoyf", colors: ["G"], keyword: ["infect"], stats: [{ metric: "mana-value", op: "eq", value: 1 }] })).toBe(true);
    // a bare second type is outside the class (#1731 reads it deck-gated)
    expect(meets({ type: "creature" }, { type: "artifact" })).toBe(false);
    expect(meets({ type: "creature" }, { type: "creature", outlaw: true })).toBe(true);
    expect(meets({ type: "creature" }, { keyword: ["awaken"] })).toBe(false);
    expect(meets({ type: "creature" }, { keyword: ["flying"] })).toBe(true);
    expect(meets({ type: "creature" }, { type: ["artifact", "enchantment", "planeswalker"], notType: ["creature"] })).toBe(false);
    expect(meets({ type: "creature" }, { type: "land", basic: true })).toBe(false);
    expect(meets({ type: "creature" }, { subtype: "forest" })).toBe(false);
  });
  test("a card's own recursion ('this card') is not a chosen card, and 'the same name as' is not a property of the fill", () => {
    expect(meets({ type: "creature" }, { type: "enchantment", self: true })).toBe(false);
    expect(meets({ type: "creature" }, { nameRelation: "same" })).toBe(false);
  });
});

describe("what keeps a fill off the chosen path, and what narrows a permanent+subtype fill", () => {
  test("a card exiled with this, put into its graveyard (Currency Converter), is no choice from a library: 'legendary artifact' stays refused", () => {
    expect(fillOf("Currency Converter").fromZone).toBe("exile");
    expect(graveyardFillMatches(entered("Currency Converter"), recursionOf("Lara Croft, Tomb Raider"), H)).toBe(false);
  });
  test("...while a library artifact fill (Goblin Engineer) meets it", () => {
    expect(graveyardFillMatches(entered("Goblin Engineer"), recursionOf("Lara Croft, Tomb Raider"), H)).toBe(true);
  });
  test("Scion's 'Dragon permanent card' is a Dragon, a creature type: no land, no basic, no historic land", () => {
    const f = entered("Scion of the Ur-Dragon");
    expect(f.subtype).toBe("dragon");
    expect(graveyardFillMatches(f, recursionOf("Groundskeeper"), H)).toBe(false);
    expect(graveyardFillMatches(f, recursionOf("Lara Croft, Tomb Raider"), H)).toBe(false);
  });
});
