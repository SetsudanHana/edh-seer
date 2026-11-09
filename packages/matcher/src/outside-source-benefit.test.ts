import { describe, expect, test } from "vitest";
import { pairReasonsAcrossFaces } from "./edges.js";
import type { DeckCard, Hierarchy } from "./types.js";
import fixtures from "./outside-source-benefit.fixtures.json" with { type: "json" };

/** The controller of an OUTSIDE source who is GIVEN something is anyone (review of #1581). Swans of Bryn Argoll: "If a source would deal damage to this creature, prevent that damage. The source's controller draws cards equal to the damage
 *  prevented this way." Your own Niv-Mizzet damaging it draws YOU cards, the classic loop. Reading that controller as an opponent lost the pair. Phyrexian Obliterator ("that source's controller sacrifices that many permanents") stays an opponent's.
 *  Fixtures are STORED rows (`cardTagsDerived`, DERIVE 484 after the fix). */
const F = fixtures as unknown as Record<string, DeckCard>;
const H: Hierarchy = {};
const drawers = (a: string, b: string) => pairReasonsAcrossFaces(F[a]!, F[b]!, H).filter((r) => r.tag.startsWith("draw"));
const swansDraws = () => (F["Swans of Bryn Argoll"]!.tags!.abilities).flatMap((x) => x.emits ?? []).filter((e) => e.verb === "draw");

describe("Swans of Bryn Argoll feeds a draw payoff of yours", () => {
  test("its draw is anyone's", () => {
    expect(swansDraws().length).toBeGreaterThan(0);
    expect(swansDraws().map((e) => e.subject.control)).toEqual(swansDraws().map(() => "any"));
  });
  test.each(["Niv-Mizzet, Parun", "Niv-Mizzet, the Firemind"])("Swans of Bryn Argoll -> %s has a draw reason", (niv) => {
    expect(drawers("Swans of Bryn Argoll", niv).length).toBeGreaterThan(0);
  });
});

describe("a cost to the outside source's controller stays an opponent's", () => {
  test("Phyrexian Obliterator's sacrifice is opp", () => {
    const em = F["Phyrexian Obliterator"]!.tags!.abilities.flatMap((x) => x.emits ?? []).filter((e) => e.verb === "sacrifice");
    expect(em.length).toBeGreaterThan(0);
    expect(em.map((e) => e.subject.control)).toEqual(em.map(() => "opp"));
  });
});
