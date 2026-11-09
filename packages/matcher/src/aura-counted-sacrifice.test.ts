import { describe, expect, test } from "vitest";
import { deriveCardTags, deriveInputOf } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./aura-counted-sacrifice.fixtures.json" with { type: "json" };

/** #1577: "SACRIFICE ANY NUMBER OF PERMANENTS" IS YOUR CHOICE OF THEM, SO IT CAN BE AN AURA. A counted pick from the whole class (Renounce, Pitiless Carnage, Lich's and Phyrexian Negator's "that many") reaches an Aura's own "put into a graveyard"
 *  trigger the way Saw's "sacrifice a permanent" does; it is no sweep (it proves no subtype: subject.ts `sweepsEveryPermanent`). Oracle text and clause records are the corpus's own (Mongo, 2026-11-09, DERIVE 481). */
type Fx = { source: Record<string, unknown>; canonical: ClauseRecord[] };
const F = fixtures as unknown as Record<string, Fx>;
const H = loadHierarchy();
const D: Record<string, DeckCard> = {};
const card = (name: string): DeckCard => (D[name] ??= { card: F[name]!.source as unknown as DeckCard["card"], tags: deriveCardTags(deriveInputOf(F[name]!.source as never, name, name, F[name]!.canonical)) as CardTags });
const leaveTags = (producer: string, consumer: string) =>
  pairReasons(card(producer), card(consumer), H).filter((r) => r.consumer === consumer && /^(leaves|dies|exiled)\b/.test(r.tag)).map((r) => r.tag);

describe("a counted sacrifice of permanents reaches an Aura's own trigger", () => {
  test.each(["Renounce", "Pitiless Carnage", "Lich", "Phyrexian Negator"])("%s -> Spirit Loop and Parallax Dementia", (producer) => {
    expect(leaveTags(producer, "Spirit Loop").length).toBeGreaterThan(0);
    expect(leaveTags(producer, "Parallax Dementia").length).toBeGreaterThan(0);
  });
  // An Aura you put on an OPPONENT's creature is still your permanent to sacrifice: the host route refuses it (your sacrifice never takes their creature), the Aura's own trigger takes it.
  test.each(["Renounce", "Pitiless Carnage", "Lich", "Phyrexian Negator"])("%s -> Bitter Chill and Slow Motion (Auras on an opponent's creature)", (producer) => {
    expect(leaveTags(producer, "Bitter Chill").length).toBeGreaterThan(0);
    expect(leaveTags(producer, "Slow Motion").length).toBeGreaterThan(0);
  });
  test("CONTROL: an unrestricted sweep still does (Apocalypse -> Reality Acid)", () => {
    expect(leaveTags("Apocalypse", "Reality Acid").length).toBeGreaterThan(0);
  });
});
