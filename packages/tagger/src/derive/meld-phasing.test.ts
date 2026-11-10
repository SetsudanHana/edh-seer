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
    ["Graf Rats", "creature"], ["Mishra, Claimed by Gix", ["creature", "artifact"]], ["Vanille, Cheerful l'Cie", "creature"], ["Gisela, the Broken Blade", "creature"],
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
  /** The melded permanent is the RESULT card: its type line from `allParts` (`meld_result`), never a class read off its name ("Brisela, Voice of Nightmares" is an Eldrazi Angel, not a Nightmare; "Urza, Planeswalker" is a planeswalker because the card is). */
  test.each([
    ["Graf Rats", ["creature"]], ["Hanweir Battlements", ["creature"]], ["Mishra, Claimed by Gix", ["artifact", "creature"]],
    ["Titania, Voice of Gaea", ["creature"]], ["Vanille, Cheerful l'Cie", ["creature"]], ["Urza, Lord Protector", ["planeswalker"]], ["Gisela, the Broken Blade", ["creature"]],
  ])("%s: the melded permanent enters as its result card, you control it, nontoken, no mass", (name, type) => {
    const meld = clausesWith(name, "meld");
    const e = emitsOf(name, (c) => meld.includes(c)).filter((x) => x.verb === "enters");
    expect(e.length).toBe(1);
    const s = e[0]!.subject;
    expect(s.scope).toBeUndefined();
    expect(s.control).toBe("you");
    expect(s.token).toBe(false);
    // The entering permanent is ONE named card (the meld_result), which no other card's own enters trigger and no cast or attack consumer can claim (#1582).
    expect(s.named, `${name} result name`).toBe((fx[name]!.source as { allParts: { component: string; name: string }[] }).allParts.find((p) => p.component === "meld_result")!.name.toLowerCase());
    expect([s.type].flat().sort()).toEqual(type);
    expect(s.allTypes).toEqual(type.length > 1 ? type : undefined);
    const parts = (fx[name]!.source as { allParts: { component: string; typeLine: string }[] }).allParts.find((p) => p.component === "meld_result")!;
    expect([s.subtype].flat().sort()).toEqual(parts.typeLine.split("—")[1]!.trim().toLowerCase().split(" ").sort());
  });
  /** The result's PRINTED power, toughness, colours and mana value (the `meld_result` card, `source.meldResult`) stand on the entering permanent: a missing stat is read as 0 and a missing colour passes "nonblack" and "colorless" (Ragnarok 7/6 is no "power 2 or less", Chittering Host no
   *  "colorless"-excluded). A star is 0, a planeswalker has none. */
  test.each(MELDERS)("%s: the melded permanent carries the result's printed stats and colours", (name) => {
    const meld = clausesWith(name, "meld");
    const s = emitsOf(name, (c) => meld.includes(c)).filter((x) => x.verb === "enters")[0]!.subject;
    const r = (fx[name]!.source as { meldResult: { power: string | null; toughness: string | null; colors: string[]; manaValue: number } }).meldResult;
    const num = (v: string | null) => (v === null ? undefined : Number.isFinite(Number(v)) ? Number(v) : 0);
    expect(s.power, `${name} power`).toBe(num(r.power));
    expect(s.toughness, `${name} toughness`).toBe(num(r.toughness));
    expect(s.colors, `${name} colors`).toEqual(r.colors);
    expect(s.manaValue, `${name} manaValue`).toBe(r.manaValue);
  });
  /** The count an ability scaled by is the MASS OBJECT's, but only the ability that exiles or enters the pair has one to drop: Mishra's drain and life gain share clause 1 and keep "X is the number of attacking creatures". */
  test("Mishra's drain and life gain keep what they scale by", () => {
    const meld = clausesWith("Mishra, Claimed by Gix", "meld");
    const abs = rowOf("Mishra, Claimed by Gix").tags.abilities.filter((a) => meld.includes(Number(a.clause)) && (a.effect.kind === "player-life-loss" || a.effect.kind === "lifegain"));
    expect(abs.length).toBe(2);
    for (const a of abs) expect(a.count?.scalesWith, a.effect.kind).toBeDefined();
  });
  /** The pair is NAMED FOR ITS PARTNER (the other `meld_part`), never `self`: a subject that is the card itself is refused by an `other` class payoff (Sludge Strider hears the Dragon Engine) and by the Aura route (Rancor on the melder), and a bare class would be heard by another card's own leaves trigger (Thragtusk). */
  test.each(MELDERS)("%s: the exile and leave of the pair are named for the partner, with no self", (name) => {
    const meld = clausesWith(name, "meld");
    const e = emitsOf(name, (c) => meld.includes(c)).filter((x) => x.verb === "exiled" || x.verb === "leaves");
    const partner = (fx[name]!.source as { allParts: { component: string; name: string }[] }).allParts.find((p) => p.component === "meld_part" && p.name !== name)!.name.toLowerCase();
    expect(e.length).toBeGreaterThan(0);
    for (const x of e) {
      expect(x.subject.named, `${name} ${x.verb}`).toBe(partner);
      expect(x.subject.self, `${name} ${x.verb}`).toBeUndefined();
    }
  });
  test.each(MELDERS)("%s: the pair that is exiled also leaves", (name) => {
    const meld = clausesWith(name, "meld");
    const verbs = emitsOf(name, (c) => meld.includes(c)).map((x) => x.verb);
    expect(verbs).toContain("exiled");
    expect(verbs).toContain("leaves");
  });
  test("Gisela's Brisela is no Nightmare, and the ability no longer scales by a mass of them", () => {
    const abs = rowOf("Gisela, the Broken Blade").tags.abilities.filter((a) => clausesWith("Gisela, the Broken Blade", "meld").includes(Number(a.clause)));
    expect(abs.flatMap((a) => (a.emits ?? []).map((e) => e.subject.subtype)).flat()).not.toContain("nightmare");
    for (const a of abs) expect(a.count?.scalesWith).toBeUndefined();
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
