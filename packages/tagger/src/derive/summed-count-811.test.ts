import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import { scalingAlso, scalingSubject } from "./scaling.js";
import fixtures from "./graveyard-whose.fixtures.json" with { type: "json" };

/** #811: A SUMMED COUNT ("X is the number of A plus the number of B") counts BOTH classes. `scalingSubject` read one subject, so Armix's
 *  "artifacts you control plus the number of artifact cards in your graveyard" kept only the graveyard half under a per-permanent basis, which neither the
 *  board-count reader (zone battlefield) nor the graveyard reader (basis per-graveyard) accepts: no demand key at all. `scalingSubject` is the FIRST class,
 *  `scalingAlso` the rest. Source: card documents from Mongo, derive as derive-corpus does for a grammar card (no stored clauses). */
const ARMIX = {
  name: "Armix, Filigree Thrasher", typeLine: "Legendary Artifact Creature — Golem",
  oracleText: "Whenever Armix attacks, you may discard a card. When you do, target creature defending player controls gets -X/-X until end of turn, where X is the number of artifacts you control plus the number of artifact cards in your graveyard.\nPartner (You can have two commanders if both have partner.)",
  keywords: ["Partner"], colors: ["B"], manaValue: 3, colorIdentity: ["B"], power: "3", toughness: "2", manaCost: "{2}{B}", layout: "normal",
};
const HOBBITS_STING = {
  name: "Hobbit's Sting", typeLine: "Instant",
  oracleText: "Hobbit's Sting deals X damage to target creature, where X is the number of creatures you control plus the number of Foods you control.",
  keywords: [], colors: ["W"], manaValue: 2, colorIdentity: ["W"], power: null, toughness: null, manaCost: "{1}{W}", layout: "normal",
};
const rowOf = (source: Record<string, unknown>) => deriveAsCorpus({ doc: { oracleId: String(source.name), name: source.name, canonical: [] } as never, source, isToken: false });
const counted = (source: Record<string, unknown>) => rowOf(source).tags.abilities.filter((a) => a.effect.scalingSubject);

describe("a summed count keeps every class it counts (#811)", () => {
  test("Armix: artifacts you control (battlefield), plus artifact cards in your graveyard", () => {
    const [a] = counted(ARMIX);
    expect(a?.effect.scalingSubject).toMatchObject({ type: "artifact", zone: "battlefield", control: "you" });
    expect(a?.effect.scalingAlso).toMatchObject([{ type: "artifact", zone: "graveyard", control: "you" }]);
  });
  test("Hobbit's Sting: creatures you control, plus Foods you control", () => {
    const [a] = counted(HOBBITS_STING);
    expect(a?.effect.scalingSubject).toMatchObject({ type: "creature", zone: "battlefield" });
    expect(a?.effect.scalingAlso).toMatchObject([{ subtype: "food", zone: "battlefield", control: "you" }]);
  });
  test("a count with no plus has no scalingAlso, and a plus-one is no second class", () => {
    expect(scalingAlso({ verb: "draw", amount: "for each artifact you control" })).toBeUndefined();
    expect(scalingAlso({ verb: "draw", amount: "the number of cards in your hand plus one" })).toBeUndefined();
    expect(scalingSubject({ verb: "draw", amount: "the number of artifacts you control plus the number of artifact cards in your graveyard" })).toMatchObject({ zone: "battlefield" });
  });
});

// Nighthawk Scavenger: "power is equal to 1 plus the number of card types among cards in your opponents' graveyards" has ONE counted class; the constant before the plus is no class and the object's repeat of the amount is no second.
test("a constant plus a count (Nighthawk Scavenger, corpus text) has one class and no scalingAlso", () => {
  type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
  const f = (fixtures as unknown as Record<string, Fx>)["Nighthawk Scavenger"]!;
  expect(f.source.oracleText).toContain("1 plus the number of card types among cards in your opponents' graveyards");
  const row = deriveAsCorpus({ doc: { oracleId: "Nighthawk Scavenger", name: "Nighthawk Scavenger", canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
  const counts = row.tags.abilities.filter((a) => a.effect.scalingSubject);
  expect(counts.length).toBeGreaterThan(0);
  for (const a of counts) {
    expect(a.effect.scalingSubject).toMatchObject({ zone: "graveyard", control: "opp" });
    expect(a.effect.scalingAlso).toBeUndefined();
  }
});
