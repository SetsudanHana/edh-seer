import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import { synthesizeTokenTags } from "./token-tags.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/block-grants-1708.json" with { type: "json" };

/** #1708: A GRANT TO "EACH CREATURE YOU CONTROL" AND A GRANT TO "ARTIFACT SPELLS YOU CAST" REACH NO TOKEN AN OPPONENT HOLDS, and the spell grant reaches no token at all. Brave the Sands, Chief Engineer, Hugh and Quicksilver, Speedster
 *  stored a class of ANY controller, so they paired with the Elephant Generous Gift gives an opponent (#1666) and the Junk Commander Sofia Daguerre gives one. Cards and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 564),
 *  derived here as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
const VANILLA: Record<string, [string, string, string[]]> = {
  Elephant: ["Token Creature — Elephant", "3", ["G"]], Soldier: ["Token Creature — Soldier", "1", ["W"]], Junk: ["Token Artifact — Junk", "", []], Treasure: ["Token Artifact — Treasure", "", []],
};
const tokenTags = (ref: { name: string }): CardTags | null => {
  const v = VANILLA[ref.name];
  return v ? synthesizeTokenTags({ _id: `test-${ref.name}`, name: ref.name, typeLine: v[0], ...(v[1] ? { power: v[1], toughness: v[1] } : {}), colors: v[2], keywords: [], printingIds: [] }) : null;
};
/** The reasons `maker` and `grantor` pair on, as sentences. */
const reasons = (maker: string, grantor: string): string[] => {
  const r = analyzeDeckStructured([dc(maker), dc(grantor)], undefined, H, undefined, undefined, undefined, tokenTags as never, undefined, [], [], { skipSimulation: true });
  return (r.cards.find((c) => c.name === maker)!.topPartners.find((p) => p.name === grantor)?.reasons ?? []).map((x) => `${x.tag} :: ${x.text}`);
};
/** The reasons that name the TOKEN as the one the grant lands on ("Brave the Sands gives Elephant an extra ability"). */
const onToken = (maker: string, grantor: string, token: string): string[] => reasons(maker, grantor).filter((x) => x.includes(` ${token} `));

describe("a grant to YOUR creatures / YOUR spells reaches no token an opponent holds", () => {
  test("Brave the Sands -> Generous Gift's Elephant (the opponent's): its 'can block an additional creature' no longer lands on the Elephant (its vigilance line already read you)", () => {
    expect(onToken("Generous Gift", "Brave the Sands", "Elephant")).toEqual([]);
  });
  test.each(["Chief Engineer", "Hugh, First of Many"])("%s -> Commander Sofia Daguerre's Junk (the opponent's): no pair at all", (g) => {
    expect(reasons("Commander Sofia Daguerre", g)).toEqual([]);
  });
  test("Quicksilver, Speedster -> Generous Gift's Elephant: the flash does not land on the Elephant (the Gift CARD is a spell, and still pairs)", () => {
    expect(onToken("Generous Gift", "Quicksilver, Speedster", "Elephant")).toEqual([]);
  });
});

describe("a grant to SPELLS reaches no token of yours either", () => {
  test.each(["Chief Engineer", "Hugh, First of Many"])("%s -> your Treasure tokens (Unexpected Windfall): a token is never an artifact SPELL", (g) => {
    expect(reasons("Unexpected Windfall", g)).toEqual([]);
  });
});

describe("CONTROLS: what the grant really reaches still pairs", () => {
  test.each(["Chief Engineer", "Hugh, First of Many"])("%s -> Sol Ring, an artifact card you cast", (g) => {
    expect(reasons(g, "Sol Ring").some((x) => x.startsWith("static:keyword-grant"))).toBe(true);
  });
  test("Brave the Sands -> your own Soldier tokens (Raise the Alarm): vigilance AND the extra block both land on them", () => {
    const r = onToken("Raise the Alarm", "Brave the Sands", "Soldier");
    expect(r).toEqual(expect.arrayContaining([expect.stringContaining("vigilance"), expect.stringContaining("an extra ability")]));
  });
  test.each(["Quicksilver, Speedster", "Alchemist's Refuge", "Ride the Avalanche"])("%s -> Sol Ring, a non-instant spell you cast: the flash still pairs", (g) => {
    expect(reasons("Sol Ring", g).some((x) => x.includes("keyword-grant"))).toBe(true);
  });
});

describe("flash granted to an INSTANT is a no-op (CR 702.8a: flash lets you cast it any time you could cast an instant)", () => {
  test.each(["Quicksilver, Speedster", "Alchemist's Refuge", "Ride the Avalanche"])("%s -> Generous Gift / Unexpected Windfall (instants): no keyword-grant pair", (g) => {
    for (const instant of ["Generous Gift", "Unexpected Windfall"]) {
      expect(reasons(instant, g).filter((x) => x.includes("keyword-grant"))).toEqual([]);
    }
  });
});
