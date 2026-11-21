import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./graveyard-whose.fixtures.json" with { type: "json" };

/** #1706: A GRAVEYARD READER SAYS WHOSE GRAVEYARD THE PRINTED TEXT NAMES. Two readers said `you` where the text names another's:
 *   - `scalingSubject` read only "their" and "all graveyards"; "in your OPPONENTS' graveyards" (Wight of Precinct Six, Detritivore, Nighthawk Scavenger, Consuming Aberration) fell through to `you`, while `count.scalesWith` (parseSubject) said `opp`.
 *     Soulless One's "Zombie cards in all graveyards" sits past the 60 characters the counted noun keeps, so it read `you` too.
 *   - a CAST out of "a graveyard" / "any graveyard" / "graveyards" (Havengul Lich, Impulsivity, Quistis Trepe, Halo Forager, Spectral Arcanist, Coram) was filled `you` by the actor default: the caster is you (the `cast` emit), the graveyard it
 *     reads is anyone's. Once #1663 reads an opponent's mill as `opp`, an `any` mill no longer fed a `you` reader and the correct pairs went.
 *  Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 563); derived as derive-corpus derives them (`deriveAsCorpus`). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
/** The control of each graveyard count (`effect.scalingSubject`), with its `count.scalesWith` control. */
const scaling = (name: string) => rowOf(name).tags.abilities.filter((a) => a.effect.scalingSubject?.zone === "graveyard")
  .map((a) => ({ ss: a.effect.scalingSubject!.control, sw: typeof a.count?.scalesWith === "object" ? a.count.scalesWith.control : undefined }));
/** The control of each recursion's graveyard (`effect.subject`), by clause. */
const recursion = (name: string) => rowOf(name).tags.abilities.filter((a) => a.effect.kind === "graveyard-recursion" && a.effect.subject?.zone === "graveyard")
  .map((a) => [a.clause, a.effect.subject!.control] as const);

describe("a graveyard COUNT names whose graveyard it counts", () => {
  test.each([
    ["Wight of Precinct Six", "opp"], // "each creature card in your opponents' graveyards"
    ["Detritivore", "opp"], // "nonbasic land cards in your opponents' graveyards"
    ["Nighthawk Scavenger", "opp"], // "card types among cards in your opponents' graveyards"
    ["Consuming Aberration", "opp"], // "the number of cards in your opponents' graveyards"
    ["Soulless One", "any"], // "Zombies on the battlefield plus ... Zombie cards in all graveyards"
  ])("%s -> %s", (name, want) => expect(scaling(name).map((s) => s.ss)).toEqual([want]));
  test("the opponents' counts agree with count.scalesWith", () => {
    for (const n of ["Wight of Precinct Six", "Detritivore", "Nighthawk Scavenger", "Consuming Aberration"]) expect(scaling(n)).toEqual([{ ss: "opp", sw: "opp" }]);
  });
});

describe("a CAST from 'a graveyard' reads the graveyard as anyone's; the caster stays you", () => {
  test.each([
    ["Havengul Lich"], // "cast target creature card in a graveyard"
    ["Impulsivity"], // "cast target instant or sorcery card from a graveyard"
    ["Quistis Trepe"], // same
    ["Halo Forager"], // same
    ["Spectral Arcanist"], // "an instant or sorcery spell ... from a graveyard"
    ["Coram, the Undertaker"], // "cast a spell from among cards in graveyards that were put there from libraries"
  ])("%s -> recursion over any graveyard", (name) => {
    const r = recursion(name);
    expect(r.length).toBeGreaterThan(0);
    expect(r.map(([, control]) => control)).toEqual(r.map(() => "any"));
  });
  test("Havengul Lich: the cast emit is YOURS, the card it leaves is anyone's", () => {
    const emits = rowOf("Havengul Lich").tags.abilities.flatMap((a) => a.emits ?? []);
    expect(emits.filter((e) => e.verb === "cast").map((e) => e.subject.control)).toEqual(["you"]);
    expect(emits.filter((e) => e.verb === "leaves").map((e) => e.subject.control)).toEqual(["any"]);
  });
});

describe("CONTROLS: a stated possessive is still read from the words", () => {
  test("Master Pakku counts 'Lesson cards in YOUR graveyard': you", () => expect(scaling("Master Pakku")).toEqual([{ ss: "you", sw: "you" }]));
  test("Bonehoard counts 'in all graveyards': any", () => expect(scaling("Bonehoard").map((s) => s.ss)).toEqual(["any"]));
  test("Eldritch Pact / Riverchurn Monument count 'THEIR graveyard' of a target player: opp", () => {
    for (const n of ["Eldritch Pact", "Riverchurn Monument"]) expect(new Set(scaling(n).map((s) => s.ss))).toEqual(new Set(["opp"]));
  });
  test("Nature's Resurgence ('each player ... their graveyard', #1416): any", () => expect(scaling("Nature's Resurgence").map((s) => s.ss)).toEqual(["any"]));
  test("recursion from YOUR graveyard stays you (Neva, Lurrus, Liliana the Necromancer's first loyalty ability)", () => {
    expect(recursion("Neva, Stalked by Nightmares")).toEqual([[2, "you"]]);
    expect(recursion("Lurrus of the Dream-Den").map(([, c]) => c)).toEqual(["you"]);
    expect(recursion("Liliana, the Necromancer")).toEqual([[2, "you"], [3, "any"]]); // "-7: Put up to two creature cards from graveyards onto the battlefield"
  });
  test("a cast or play from YOUR graveyard leaves your graveyard: the leave emit follows the recursion (Zask, Gale, The Eighth Doctor, Abandoned Sarcophagus)", () => {
    for (const n of ["Zask, Skittering Swarmlord", "Gale, Waterdeep Prodigy", "The Eighth Doctor", "Abandoned Sarcophagus"]) {
      expect(new Set(recursion(n).map(([, c]) => c))).toEqual(new Set(["you"]));
      expect(new Set(rowOf(n).tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "leaves").map((e) => e.subject.control))).toEqual(new Set(["you"]));
    }
  });
  test("a put from 'a graveyard' stays any (Animate Dead, Reanimate); Jailbreak keeps its opponent's graveyard and its own", () => {
    expect(recursion("Animate Dead").map(([, c]) => c)).toEqual(["any"]);
    expect(recursion("Reanimate").map(([, c]) => c)).toEqual(["any"]);
    expect(recursion("Jailbreak")).toEqual([[1, "opp"], [2, "you"]]);
  });
});
