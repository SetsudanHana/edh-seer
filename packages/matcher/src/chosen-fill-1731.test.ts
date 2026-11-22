import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { loadHierarchy } from "./index.js";
import { creatureCoTypes, pairReasonsAcrossFaces, type ReasonOptions } from "./edges.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/chosen-fill-1731.json" with { type: "json" };

/** #1731: A CHOSEN CREATURE FILL (Buried Alive, Jarad's Orders) is an artifact (or enchantment, or land) card only when the card picked is, so a bare "artifact card" demand (Ultron's Auxiliary: "an artifact card is put into your
 *  graveyard", Trading Post: "return target artifact card") is met only in a deck that holds such a creature. Cards and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 573). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
const FILL = /^(?:graveyard-recursion|scales|threshold|enters-graveyard)/;
/** The fill reasons the pair draws, with the options a deck of `deck` would hand the engine (none: the card-page / pair reading). */
const fills = (p: string, c: string, deck?: string[] | { coTypes: string[] }): string[] => {
  const opts: ReasonOptions = !deck ? {} : { creatureCoTypes: Array.isArray(deck) ? creatureCoTypes(deck.map(dc)) : new Map(deck.coTypes.map((t) => [t, ["elsewhere"]])) };
  return [...pairReasonsAcrossFaces(dc(p), dc(c), H, opts)].map((r) => r.tag).filter((t) => FILL.test(t));
};

describe("a creature fill is an artifact card only in a deck that holds an artifact creature", () => {
  // Ultron the Annihilator and Ultron's Auxiliary are artifact creatures themselves, and the consumer is no evidence for its own demand: only a card OTHER than the pair counts
  test.each([["Buried Alive", "Ultron's Auxiliary"], ["Jarad's Orders", "Ultron the Annihilator"], ["Buried Alive", "Ultron the Annihilator"]])("%s -> %s: the consumer alone in the deck (or beside Llanowar Elves) is no evidence", (p, c) => {
    expect(fills(p, c, [p, c])).toEqual([]);
    expect(fills(p, c, [p, c, "Llanowar Elves"])).toEqual([]);
  });
  test("{Buried Alive, Ultron's Auxiliary, Solemn Simulacrum} pairs: another artifact creature is evidence", () => {
    expect(fills("Buried Alive", "Ultron's Auxiliary", ["Buried Alive", "Ultron's Auxiliary", "Solemn Simulacrum"])).not.toEqual([]);
  });
  test.each([["Buried Alive", "Ultron's Auxiliary"], ["Jarad's Orders", "Ultron the Annihilator"]])("%s -> %s: no artifact creature in the deck's evidence gives no reach", (p, c) => {
    expect(fills(p, c, { coTypes: [] })).toEqual([]);
    expect(fills(p, c, { coTypes: ["enchantment", "land"] })).toEqual([]);
  });
  test.each([["Buried Alive", "Trading Post"], ["Jarad's Orders", "Emry, Lurker of the Loch"]])(
    "%s -> %s: a deck of plain creatures and an artifact that is no creature gives no reach", (p, c) => {
      expect(fills(p, c, [p, c, "Llanowar Elves", "Sol Ring"])).toEqual([]);
    });
  test.each([["Buried Alive", "Ultron's Auxiliary"], ["Jarad's Orders", "Trading Post"]])("%s -> %s: no deck options (card page, compass) is unchanged: no reach", (p, c) => {
    expect(fills(p, c)).toEqual([]);
  });
  test("an enchantment creature in the deck reaches an enchantment demand, not an artifact one", () => {
    const deck = ["Buried Alive", "Eidolon of Countless Battles"];
    expect([...creatureCoTypes(deck.map(dc)).keys()]).toEqual(["enchantment"]);
    expect(fills("Buried Alive", "Ultron's Auxiliary", { coTypes: ["enchantment"] })).toEqual([]);
  });
  test("the co-types are those of non-token creature cards only", () => {
    expect([...creatureCoTypes(["Sol Ring", "Llanowar Elves"].map(dc)).keys()]).toEqual([]);
    expect([...creatureCoTypes(["Dryad Arbor", "Solemn Simulacrum"].map(dc)).keys()].sort()).toEqual(["artifact", "land"]);
  });
});

describe("CONTROLS: what #1726 already reaches stays, with or without deck evidence", () => {
  test.each([["Buried Alive", "Abiding Grace"], ["Buried Alive", "Goryo's Vengeance"], ["Jarad's Orders", "Abiding Grace"]])("%s -> %s pairs with no deck options and in a deck holding an artifact creature", (p, c) => {
    expect(fills(p, c)).not.toEqual([]);
    expect(fills(p, c, [p, c, "Solemn Simulacrum"])).toEqual(fills(p, c));
  });
});
