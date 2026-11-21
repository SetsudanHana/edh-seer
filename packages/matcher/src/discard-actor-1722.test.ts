import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "@edh-seer/tagger/derive-worker";
import type { CardTags } from "@edh-seer/tagger";
import { analyzeDeckStructured, loadHierarchy } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./fixtures/discard-actor-1722.json" with { type: "json" };

/** #1722: AN OPPONENT'S DISCARD FILLS AN OPPONENT'S GRAVEYARD (#1706 made Wight of Precinct Six and Detritivore count only opponents' graveyards). Cabal Conditioning ("any number of target players each discard") and Rottenmouth Viper ("... unless that
 *  player sacrifices ... or discards a card") stored the discard as yours and lost both pairs. Bitter Triumph, Bone Shards and Deadly Visit (`dies {opp, [creature, planeswalker]}`) were reported as pairing with neither; they pair with Wight (a creature card in an
 *  opponent's graveyard) and rightly not with Detritivore (nonbasic LAND cards). Cards and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 569), derived here as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const dc = (name: string): DeckCard => {
  const f = F[name]!;
  const tags: CardTags = deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false }).tags;
  return { card: { _id: name, ...f.source } as unknown as DeckCard["card"], tags };
};
const pair = (producer: string, consumer: string): string[] => {
  const r = analyzeDeckStructured([dc(producer), dc(consumer)], undefined, H, undefined, undefined, undefined, undefined, undefined, [], [], { skipSimulation: true });
  const side = (a: string, b: string) => r.cards.filter((c) => c.name === a).flatMap((c) => c.topPartners.filter((p) => p.name === b).flatMap((p) => p.reasons)).map((x) => `${x.tag} :: ${x.text}`);
  return [...side(producer, consumer), ...side(consumer, producer)];
};
const FILL = /^(?:graveyard-recursion|scales|threshold|enters-graveyard)/;
const fills = (p: string, c: string): string[] => pair(p, c).filter((x) => FILL.test(x));

describe("a discard by another player fills an opponent's graveyard", () => {
  test.each([
    ["Cabal Conditioning", "Wight of Precinct Six"], ["Cabal Conditioning", "Detritivore"],
    ["Rottenmouth Viper", "Wight of Precinct Six"], ["Rottenmouth Viper", "Detritivore"],
    ["Mind Rot", "Wight of Precinct Six"],
  ])("%s -> %s", (p, c) => expect(fills(p, c)).not.toEqual([]));
});

describe("controls: your own discard fills only your graveyard", () => {
  test.each([["Faithless Looting", "Wight of Precinct Six"], ["Faithless Looting", "Detritivore"], ["Wandering Champion", "Wight of Precinct Six"], ["Wandering Champion", "Detritivore"]])("%s -/-> %s", (p, c) => expect(fills(p, c)).toEqual([]));
});

describe("a creature-or-planeswalker kill reaches the creature counter and not the land counter", () => {
  test.each(["Bitter Triumph", "Bone Shards", "Deadly Visit"])("%s -> Wight of Precinct Six", (p) => expect(fills(p, "Wight of Precinct Six")).not.toEqual([]));
  test.each(["Bitter Triumph", "Bone Shards", "Deadly Visit"])("%s -/-> Detritivore", (p) => expect(fills(p, "Detritivore")).toEqual([]));
});
