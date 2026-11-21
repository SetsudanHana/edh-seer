import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import type { SubjectFilter } from "../schema.js";
import fixtures from "./cast-actor.fixtures.json" with { type: "json" };

/** #1691: WHO CASTS IS THE CAST EMIT'S CONTROL (CR 601.2a: the player who proposes the cast becomes the spell's controller). A stored `cast` action has no actor field, so the caster
 *  is read off the words. The grammar reading's opponent rides on the record (#1676: Itazura, Cmdr. Troi); a model-normalized row has only its clause text, which names the caster
 *  ("That opponent may cast the exiled card", Allure of the Unknown; "that opponent may cast the revealed card", Swindler's Scheme). Where the player is anyone (the trigger's "that player",
 *  "its controller" or "its owner" of a target that may be yours) `any` is the only honest reading and stays.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 558); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const casts = (name: string): SubjectFilter[] => rowOf(name).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "cast" && e.subject.self !== true).map((e) => e.subject);

describe("an opponent named as the caster is the cast's control", () => {
  test.each(["Itazura, Lingering Wick", "Cmdr. Troi, Outgoing Empath", "Allure of the Unknown", "Swindler's Scheme"])("%s: the opponent casts", (name) => {
    const s = casts(name);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(x.control).toBe("opp");
  });
  test("an opponent's cast keeps no owner it was never told (Allure: the exiled card is the opponent's own pick from YOUR library)", () => {
    for (const x of casts("Allure of the Unknown")) expect(x.owner).toBeUndefined();
  });
});

describe("a caster who may be you stays any player", () => {
  test.each([
    "Knowledge Pool", "Ian Malcolm, Chaotician", "Possibility Storm", // "that player", whoever the trigger named
    "Spellshift", "Tibalt's Trickery", "Transforming Flourish", // "its controller" of a target that may be yours / a pronoun
    "Release to the Wind", // "its owner" of a target that may be yours
  ])("%s", (name) => {
    const s = casts(name);
    expect(s.length).toBeGreaterThan(0);
    for (const x of s) expect(x.control).toBe("any");
  });
});
