import { describe, expect, test } from "vitest";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./opponent-clone.fixtures.json" with { type: "json" };

/** A CLONE THAT CAN ONLY COPY AN OPPONENT'S CREATURE HAS NO DECK-MATE COPY TARGET (#1689, after #1675). "You may have this creature enter as a copy of a creature an opponent controls" (Malleable Impostor, Mocking Doppelganger, Imposter Mech)
 *  never copies your own creature, so it forms no `static:clone` edge to one. Fixtures are STORED rows (`cardTagsDerived`, Mongo, DERIVE 558). */
const F = fixtures as unknown as Record<string, DeckCard>;
const H: Hierarchy = {};
const clone = (producer: string, consumer: string) =>
  pairReasonsAcrossFaces(F[producer]!, F[consumer]!, H).filter((r) => r.tag === "static:clone" && r.producer === producer && r.consumer === consumer);

describe("a clone of an opponent's creature does not copy a deck-mate", () => {
  test.each(["Malleable Impostor", "Mocking Doppelganger"])("%s -> Mulldrifter: no copy-target edge", (p) => {
    expect(clone(p, "Mulldrifter")).toEqual([]);
  });
  test("Imposter Mech (copies an opponent's creature) -> Mulldrifter: none", () => {
    expect(clone("Imposter Mech", "Mulldrifter")).toEqual([]);
  });
  test.each(["Clone", "Phantasmal Image"])("CONTROL: %s (any creature) still links to Mulldrifter", (p) => {
    expect(clone(p, "Mulldrifter").length).toBeGreaterThan(0);
  });
});
