import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./meld-phasing.fixtures.json" with { type: "json" };

/** #1582 parts 2 and 3. Card documents and stored `cardClauses` dumped from Mongo (DERIVE 484 tree, 2026-11-10): `meld-phasing.fixtures.json` (every card whose oracle text says meld, phase or phasing). */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const fx = fixtures as unknown as Record<string, Fx>;
const rowOf = (name: string) => {
  const f = fx[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const emitsOf = (name: string, clause: (c: number) => boolean = () => true) => rowOf(name).tags.abilities.filter((a) => clause(Number(a.clause))).flatMap((a) => (a.emits ?? []).map((e) => ({ ...e, clause: a.clause })));
/** The clause ids whose stored actions include the verb. */
const clausesWith = (name: string, verb: string): number[] =>
  (fx[name]!.canonical as { id: number; actions: { verb: string }[] }[]).filter((c) => c.actions.some((a) => a.verb === verb)).map((c) => c.id);

/** PART 2 -- "EXILE THEM, THEN MELD THEM" EXILES THE PAIR, NOT A CLASS. The meld pair is this card and the one card named in the condition: a set the card defined, never `scope: all`, and the result's name is no class. */
const MELDERS = ["Graf Rats", "Hanweir Battlements", "Mishra, Claimed by Gix", "Titania, Voice of Gaea", "Vanille, Cheerful l'Cie", "Urza, Lord Protector", "Gisela, the Broken Blade"];
describe("a meld exiles its pair: a chosen set, no mass", () => {
  test.each(MELDERS)("%s: the exile and leave of the pair are `selection: chosen` with no scope", (name) => {
    const meld = clausesWith(name, "meld");
    expect(meld.length).toBe(1);
    const e = emitsOf(name, (c) => meld.includes(c)).filter((x) => x.verb === "exiled" || x.verb === "leaves");
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) {
      expect(x.subject.selection, `${name} ${x.verb}`).toBe("chosen");
      expect(x.subject.scope, `${name} ${x.verb}`).toBeUndefined();
    }
  });
  /** The exile keeps what is true of the pair: its types (the card's own and the partner's "a creature named"), nontoken, no subtype read off a name; a creature exile stays a creature exile (own-name.test.ts: Syr Vondam, Soulherder, Hero of Bretagard hear Graf Rats). */
  test.each([
    ["Graf Rats", "creature"], ["Mishra, Claimed by Gix", "creature"], ["Vanille, Cheerful l'Cie", "creature"], ["Gisela, the Broken Blade", "creature"],
    ["Titania, Voice of Gaea", ["creature", "land"]], ["Hanweir Battlements", ["land", "creature"]], ["Urza, Lord Protector", ["creature", "artifact"]],
  ])("%s: the pair is exiled as %j, nontoken, with no subtype", (name, type) => {
    const meld = clausesWith(name, "meld");
    const e = emitsOf(name, (c) => meld.includes(c)).filter((x) => x.verb === "exiled" || x.verb === "leaves");
    for (const x of e) {
      expect([x.subject.type].flat().sort(), `${name} ${x.verb}`).toEqual([type].flat().sort());
      expect(x.subject.token, `${name} ${x.verb}`).toBe(false);
      expect(x.subject.subtype, `${name} ${x.verb}`).toBeUndefined();
    }
  });
  test.each(MELDERS)("%s: the melded permanent enters with no mass and no class read off its name", (name) => {
    const meld = clausesWith(name, "meld");
    const e = emitsOf(name, (c) => meld.includes(c)).filter((x) => x.verb === "enters");
    expect(e.length).toBe(1);
    expect(e[0]!.subject.scope).toBeUndefined();
    expect(e[0]!.subject.subtype).toBeUndefined();
    expect(e[0]!.subject.type).toBeUndefined();
  });
  test("CONTROL: a card that only reminds 'Melds with' derives no meld pair", () => {
    for (const name of ["Midnight Scavengers", "Hanweir Garrison", "Bruna, the Fading Light"].filter((n) => fx[n])) {
      expect(emitsOf(name).filter((x) => x.subject.selection === "chosen")).toEqual([]);
    }
  });
  test("CONTROL: a card that exiles a class near a meld-like word is untouched (Mishra keeps its own tapped-and-attacking entry)", () => {
    const meld = clausesWith("Mishra, Claimed by Gix", "meld");
    const e = emitsOf("Mishra, Claimed by Gix", (c) => meld.includes(c)).filter((x) => x.verb === "enters");
    expect(e[0]!.subject.entersTapped).toBe(true);
  });
});

/** PART 3 -- A PHASED-OUT PERMANENT DOES NOT LEAVE (CR 702.26d: "The phasing event doesn't actually cause a permanent to change zones or control ... Zone-change triggers don't trigger when a permanent phases in or out").
 *  `phase-out` emits `phases-out` and nothing else (emits.ts). At DERIVE 484 no card read otherwise (census below: 82 cards say meld, phase or phasing, 51 with a stored phase-out action), so this is a guard and not a fix: a
 *  clause whose only business is phasing emits no `leaves` / `exiled` / `dies`, while the real removal printed beside it (Divine Smite's exile of a black permanent, Teferi's Protection exiling itself, the Saga's destroy) stays. */
const REAL_REMOVAL = new Set(["destroy", "exile", "sacrifice", "return", "put", "deal-damage", "counter-spell", "gain-control"]);
const LEAVE_FAMILY = new Set(["leaves", "exiled", "dies"]);
const phasers = Object.keys(fx).filter((n) => clausesWith(n, "phase-out").length > 0);
describe("phasing out is not leaving the battlefield (CR 702.26d)", () => {
  test("the census reaches the whole phase-out family", () => {
    expect(phasers.length).toBeGreaterThanOrEqual(50);
    for (const n of ["The Phasing of Zhalfir", "Teferi's Protection", "Out of Time", "Divine Smite", "Reality Ripple"]) expect(phasers, n).toContain(n);
  });
  test.each(phasers)("%s: a clause that only phases out emits no leave, exile or death", (name) => {
    const canon = fx[name]!.canonical as { id: number; actions: { verb: string }[] }[];
    const onlyPhase = canon.filter((c) => c.actions.some((a) => a.verb === "phase-out") && !c.actions.some((a) => REAL_REMOVAL.has(a.verb))).map((c) => c.id);
    const bad = emitsOf(name, (c) => onlyPhase.includes(c)).filter((e) => LEAVE_FAMILY.has(e.verb));
    expect(bad.map((e) => `${e.verb}@${e.clause}`)).toEqual([]);
  });
  test("a phase-out beside a real exile keeps the exile (Divine Smite: 'if that permanent is black, exile it instead')", () => {
    const e = emitsOf("Divine Smite");
    expect(e.map((x) => x.verb)).toEqual(expect.arrayContaining(["phases-out", "exiled", "leaves"]));
  });
  test("The Phasing of Zhalfir: the phase is no leave, the Saga's destroy is a death", () => {
    const e = emitsOf("The Phasing of Zhalfir");
    expect(e.filter((x) => x.verb === "phases-out").map((x) => x.clause)).toEqual([2]);
    expect(e.filter((x) => LEAVE_FAMILY.has(x.verb)).map((x) => [x.verb, x.clause])).toEqual([["dies", 3]]);
  });
  test("Teferi's Protection phases out the permanents and exiles itself from the stack", () => {
    const e = emitsOf("Teferi's Protection");
    expect(e.some((x) => x.verb === "phases-out" && x.subject.scope === "all")).toBe(true);
    expect(e.some((x) => x.verb === "exiled" && x.subject.self === true)).toBe(true);
  });
  test("Oubliette (its stored clause lost the phase-out, only the tap is kept): no leave of the creature", () => {
    expect(emitsOf("Oubliette").filter((x) => LEAVE_FAMILY.has(x.verb) && x.subject.self !== true)).toEqual([]);
  });
});
