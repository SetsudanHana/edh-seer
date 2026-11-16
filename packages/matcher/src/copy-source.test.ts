import { describe, expect, test } from "vitest";
import { clauseTexts, deriveCardTags, deriveInputOf, grammarClauseRecords } from "@edh-seer/tagger";
import type { CardTags, ClauseRecord } from "@edh-seer/tagger";
import { loadHierarchy, pairReasons } from "./index.js";
import type { DeckCard } from "./types.js";
import fixtures from "./copy-source.fixtures.json" with { type: "json" };

/** #1648: a copier's SOURCE restriction ("from an artifact source", "an ability of an artifact", "of a Chandra planeswalker", "of equipped creature")
 *  is a fact about the ability's source, derived into `effect.subject.abilityOf`; the copy-ability pass read `subject.type`, which no copier carries, so every
 *  activated or triggered ability paired with every copier. Oracle text, type line and colours are the corpus's own (cards.*, DERIVE 530) in the fixtures
 *  file beside this test; every card here derives from its printed text (clauseSource "grammar"). */
type Fx = { typeLine: string; oracleText: string; colors: string[]; colorIdentity: string[]; manaValue: number; power: string | null; toughness: string | null; keywords: string[]; loyalty?: string; clauses?: ClauseRecord[] };
const FX = fixtures as unknown as Record<string, Fx>;
function card(name: string): DeckCard {
  const f = FX[name]!;
  const src = { ...f, name };
  // A MODEL-sourced card (Radiant Performer, Agrus Kos, Goblin Welder) derives from its stored canonical clauses, a grammar card from its printed text, as `derive-corpus` does.
  const g = f.clauses ? undefined : grammarClauseRecords(src as never);
  const tags = deriveCardTags(g ? deriveInputOf(src as never, name, name, g.records, undefined, g.readings) : deriveInputOf({ ...src, clauseTexts: clauseTexts(src as never) } as never, name, name, f.clauses!)) as CardTags;
  return { card: { name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: f.keywords, colors: f.colors, manaValue: f.manaValue } as unknown as DeckCard["card"], tags };
}
const H = loadHierarchy();
const copies = (copier: string, source: string): string[] => pairReasons(card(copier), card(source), H).map((r) => r.tag).filter((t) => t.startsWith("copies:"));
const copySubject = (name: string) => card(name).tags!.abilities.find((a) => a.effect.kind === "copy-ability")!.effect.subject!;

const SOURCES = ["Mistrise Village", "Vexing Shusher", "Prodigal Sorcerer", "Chandra's Regulator", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"];
const reached = (copier: string): string[] => SOURCES.filter((s) => copies(copier, s).length > 0);

describe("derive: the source restriction lands in subject.abilityOf", () => {
  test("a trigger's 'an ability of an artifact' (Kurkesh) and 'a loyalty ability of a Chandra planeswalker' (Chandra's Regulator)", () => {
    expect(copySubject("Kurkesh, Onakke Ancient").abilityOf).toEqual({ control: "any", type: "artifact" });
    expect(copySubject("Chandra's Regulator").abilityOf).toEqual({ control: "any", type: "planeswalker", subtype: "chandra" });
  });
  test("a host restriction (the Bracers, Rowan's Talent) is derived as the status `equipped` / `enchanted`", () => {
    expect(copySubject("Illusionist's Bracers").abilityOf?.status).toEqual(["equipped"]);
    expect(copySubject("Battlemage's Bracers").abilityOf?.status).toEqual(["equipped"]);
    expect(copySubject("Rowan's Talent").abilityOf?.status).toEqual(["enchanted"]);
  });
  test("an unrestricted copier derives no abilityOf (Rings of Brighthearth, Gogo)", () => {
    expect(copySubject("Rings of Brighthearth").abilityOf).toBeUndefined();
    expect(copySubject("Gogo, Master of Mimicry").abilityOf).toBeUndefined();
  });
});

describe("match: a copier pairs only with a source its own text allows", () => {
  test("Kurkesh: an artifact's activated ability, never a land's or a creature's", () => {
    expect(reached("Kurkesh, Onakke Ancient")).toEqual(["Chandra's Regulator"]);
  });
  test("Tawnos and Scientist Supreme (artifact source; activated or triggered)", () => {
    expect(reached("Tawnos, Urza's Apprentice")).toEqual(["Chandra's Regulator"]);
    expect(reached("Scientist Supreme of A.I.M.")).toEqual(["Chandra's Regulator"]);
  });
  test("Echo (creature source) and Abstruse Archaic (colorless source)", () => {
    expect(reached("Echo, Perceptive Prodigy")).toEqual(["Vexing Shusher", "Prodigal Sorcerer"]);
    expect(reached("Abstruse Archaic")).toEqual(["Mistrise Village", "Ugin, the Spirit Dragon"]);
  });
  test("The Peregrine Dynamo: another LEGENDARY source", () => {
    expect(reached("The Peregrine Dynamo")).toEqual(["Chandra's Regulator", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"]);
  });
  test("Weaver of Harmony: an enchantment source (Rowan's Talent triggers; no source here activates)", () => {
    expect(copies("Weaver of Harmony", "Rowan's Talent")).toEqual(["copies:triggered"]);
    expect(reached("Weaver of Harmony")).toEqual([]);
  });
  test("Chandra's Regulator: a loyalty ability of a CHANDRA, not of Ugin", () => {
    expect(reached("Chandra's Regulator")).toEqual(["Chandra, Torch of Defiance"]);
  });
  test("host copiers keep their class-wide links (owner 2026-11-15), the TYPE still demanded: creatures for the Bracers, planeswalkers for Rowan's Talent", () => {
    expect(reached("Illusionist's Bracers")).toEqual(["Vexing Shusher", "Prodigal Sorcerer"]);
    expect(reached("Battlemage's Bracers")).toEqual(["Vexing Shusher", "Prodigal Sorcerer"]);
    expect(reached("Rowan's Talent")).toEqual(["Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"]);
  });
  test("an unrestricted copier still reaches every non-mana source (Rings of Brighthearth: activated; Gogo: both kinds)", () => {
    expect(reached("Rings of Brighthearth")).toEqual(["Mistrise Village", "Vexing Shusher", "Prodigal Sorcerer", "Chandra's Regulator", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"]);
    expect(reached("Gogo, Master of Mimicry")).toEqual(reached("Rings of Brighthearth"));
    expect(copies("Rings of Brighthearth", "Sol Ring")).toEqual([]);
  });
});

const REACH = [...SOURCES, "Mother of Runes", "Goblin Welder", "Conclave Sledge-Captain"];
const reaches = (copier: string): string[] => REACH.filter((s) => copies(copier, s).length > 0);

describe("what the copied ability targets, and the keyword it is (#1648)", () => {
  test("derive: the demand lands on the copier's subject", () => {
    expect(copySubject("Ertha Jo, Frontier Mentor").targets).toMatchObject({ anyOf: [{ type: "creature" }, { player: true }] });
    expect(copySubject("Ertha Jo, Frontier Mentor").targetsOnly).toBeUndefined();
    expect(copySubject("Radiant Performer").targetsOnly).toBe(true);
    expect(copySubject("Agrus Kos, Eternal Soldier")).toMatchObject({ targets: { self: true }, targetsOnly: true });
    expect(copySubject("Bill Potts")).toMatchObject({ targets: { self: true }, targetsOnly: true });
    expect(copySubject("Mirror-Shield Hoplite")).toMatchObject({ keyword: ["backup"], abilityKind: ["triggered"] });
  });
  test("Ertha Jo: an activated ability that targets a creature or player (Prodigal, Chandra's -3, Ugin, Mother of Runes; not a spell target or Goblin Welder's artifacts)", () => {
    expect(reaches("Ertha Jo, Frontier Mentor")).toEqual(["Prodigal Sorcerer", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon", "Mother of Runes"]);
  });
  test("Radiant Performer: a single permanent or player target; a spell target and a two-target ability are not", () => {
    expect(reaches("Radiant Performer")).toEqual(["Prodigal Sorcerer", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon", "Mother of Runes"]);
  });
  test("Agrus Kos: an ability that targets only a creature, which could be Agrus Kos", () => {
    expect(reaches("Agrus Kos, Eternal Soldier")).toEqual(["Prodigal Sorcerer", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon", "Mother of Runes"]);
  });
  test("Mirror-Shield Hoplite: only a card that prints backup, as a triggered ability", () => {
    expect(reaches("Mirror-Shield Hoplite")).toEqual(["Conclave Sledge-Captain"]);
    expect(copies("Mirror-Shield Hoplite", "Conclave Sledge-Captain")).toEqual(["copies:triggered"]);
  });
});

describe("Ability.targets read from the head noun, outside quotes, through comma lists (#1648 review)", () => {
  test("a target phrase the grammar leaves untyped keeps its head noun: a spell is not a creature or a permanent", () => {
    expect(copies("Ertha Jo, Frontier Mentor", "Kozilek, the Great Distortion")).toEqual([]);
    expect(copies("Radiant Performer", "Spellstutter Sprite")).toEqual([]);
    expect(copies("Agrus Kos, Eternal Soldier", "Spellstutter Sprite")).toEqual([]);
  });
  test("an ability quoted in a grant is the grantee's, not the granter's", () => {
    expect(copies("Agrus Kos, Eternal Soldier", "Toggo, Goblin Weaponsmith")).toEqual([]);
    expect(copies("Ertha Jo, Frontier Mentor", "Karn, Living Legacy")).toEqual([]);
    expect(copies("Ertha Jo, Frontier Mentor", "Koth of the Hammer")).toEqual([]);
  });
  test("a comma list keeps every noun: Icy Manipulator's 'target artifact, creature, or land' can target a creature", () => {
    expect(copies("Ertha Jo, Frontier Mentor", "Icy Manipulator")).toEqual(["copies:activated"]);
    expect(copies("Radiant Performer", "Icy Manipulator")).toEqual(["copies:activated"]);
    expect(copies("Agrus Kos, Eternal Soldier", "Icy Manipulator")).toEqual(["copies:activated"]);
    expect(copies("Agrus Kos, Eternal Soldier", "Teferi, Time Raveler")).toEqual(["copies:activated"]);
  });
});

/** #1650: "that isn't a mana ability" is a NEGATION of the kind (the legacy `parseSubject` read the word "mana" and dropped the "isn't": Ashnod, Verrak, Dynaheir and Pit Automaton derived `["mana"]`,
 *  claimed `copies:mana` to the mana abilities they cannot copy and missed every activated ability they can); "mana cost" is no mana ability (Magus Lucea Kane, Unbound Flourishing); and the
 *  pronoun "that spell or ability" is not a spell-typed subject (it made `typeMatchesCharacteristics("spell")` drop every ability producer: Bill Potts, Wyll's Reversal, Sunken Palace,
 *  Repeated Reverberation, Magus Lucea Kane, Unbound Flourishing). Oracle text and clauses are the corpus's own (DERIVE 532) in the fixtures file. */
const PAID_SOURCES = ["Forsworn Paladin", "Helix Pinnacle", "Viscera Seer", "Icy Manipulator", "Whispering Shade", "Kalitas, Bloodchief of Ghet", "Uurg, Spawn of Turg", "Lethal Vapors"];
const KIND_SOURCES = [...REACH, "Sol Ring", "Pacesetter Paragon", ...PAID_SOURCES];
const kindReach = (copier: string): string[] => KIND_SOURCES.filter((s) => copies(copier, s).length > 0);

describe("a negated mana ability is the activated kind, never `mana` (#1650)", () => {
  test("derive: Ashnod, Verrak, Dynaheir, Pit Automaton read activated", () => {
    expect(copySubject("Ashnod the Uncaring").abilityKind).toEqual(["activated"]);
    expect(copySubject("Verrak, Warped Sengir").abilityKind).toEqual(["activated"]);
    expect(copySubject("Dynaheir, Invoker Adept").abilityKind).toEqual(["activated"]);
    expect(copySubject("Pit Automaton")).toMatchObject({ abilityKind: ["activated"], keyword: ["exhaust"] });
  });
  test("derive: a mana COST is not a mana ability (Magus Lucea Kane, Unbound Flourishing)", () => {
    expect(copySubject("Magus Lucea Kane").abilityKind).toEqual(["activated"]);
    expect(copySubject("Unbound Flourishing").abilityKind).toEqual(["activated"]);
  });
  test("match: no copier of a non-mana ability claims copies:mana, and none reaches Sol Ring", () => {
    for (const c of ["Ashnod the Uncaring", "Verrak, Warped Sengir", "Dynaheir, Invoker Adept", "Pit Automaton", "Magus Lucea Kane", "Unbound Flourishing"]) {
      expect(copies(c, "Sol Ring")).toEqual([]);
    }
  });
  // THE COPY IS CONDITIONAL (#1650 review): each of these copies only an ability PAID a particular way, read off the producer's derived cost (`Ability.payment`), never its printed text.
  test("derive: the way the ability is paid lands on the copier's subject (`paidWith`)", () => {
    expect(copySubject("Verrak, Warped Sengir").paidWith).toBe("life");
    expect(copySubject("Ashnod the Uncaring").paidWith).toBe("sacrifice");
    expect(copySubject("Unbound Flourishing").paidWith).toBe("x");
    expect(copySubject("Magus Lucea Kane").paidWith).toBe("x");
    expect(copySubject("Sunken Palace").paidWith).toBe("mana");
    expect(copySubject("Dynaheir, Invoker Adept").paidWith).toBe("mana");
    for (const c of ["Rings of Brighthearth", "Gogo, Master of Mimicry", "Pit Automaton", "Bill Potts"]) expect(copySubject(c).paidWith).toBeUndefined();
  });
  test("Verrak: an ability that PAYS LIFE (Forsworn Paladin), not Mother of Runes, Prodigal Sorcerer or a {X} or sacrifice cost", () => {
    expect(kindReach("Verrak, Warped Sengir")).toEqual(["Forsworn Paladin"]);
    expect(copies("Verrak, Warped Sengir", "Mother of Runes")).toEqual([]);
  });
  test("Ashnod: an ability that SACRIFICES something (Viscera Seer), not Prodigal Sorcerer; Phyrexian Altar's mana ability is no ability to copy", () => {
    expect(kindReach("Ashnod the Uncaring")).toEqual(["Viscera Seer", "Uurg, Spawn of Turg"]);
    expect(copies("Ashnod the Uncaring", "Prodigal Sorcerer")).toEqual([]);
  });
  // CEILING in the test's words: "{T}: When you next activate ..." is a delayed trigger the derive does not read, and the effect behind it names the trigger's object ("that ability"),
  // so it claims nothing (#1592): Dynaheir, Pit Automaton and Magus Lucea Kane carry the right demand and meet no producer until that trigger is read.
  test("Dynaheir, Pit Automaton, Magus Lucea Kane: the demand is right and the delayed trigger claims nothing (#1592)", () => {
    for (const c of ["Dynaheir, Invoker Adept", "Pit Automaton", "Magus Lucea Kane"]) {
      expect(card(c).tags!.abilities.find((a) => a.effect.kind === "copy-ability")!.claimsNothing).toBe("refused-trigger");
      expect(kindReach(c)).toEqual([]);
    }
  });
});

describe("a copier of 'that spell or ability' pairs with abilities (#1650)", () => {
  test("derive: no spell type left on the subject", () => {
    for (const c of ["Bill Potts", "Wyll's Reversal", "Sunken Palace", "Repeated Reverberation", "Magus Lucea Kane", "Unbound Flourishing"]) expect(copySubject(c).type).toBeUndefined();
  });
  test("an ability being ACTIVATED is the activated kind (Sunken Palace, Bill Potts); a loyalty ability is loyalty (Repeated Reverberation)", () => {
    expect(copySubject("Sunken Palace").abilityKind).toEqual(["activated"]);
    expect(copySubject("Bill Potts")).toMatchObject({ abilityKind: ["activated"], targets: { self: true }, targetsOnly: true });
    expect(copySubject("Repeated Reverberation").abilityKind).toEqual(["loyalty"]);
    expect(copySubject("Wyll's Reversal").abilityKind).toBeUndefined();
  });
  test("Unbound Flourishing: an ability with {X} in its activation cost (Helix Pinnacle), no other", () => {
    expect(kindReach("Unbound Flourishing")).toEqual(["Helix Pinnacle"]);
    expect(copies("Unbound Flourishing", "Prodigal Sorcerer")).toEqual([]);
  });
  test("derive: Sunken Palace's mana is blue (`paidColors`, read from its own 'Add {U}'); Dynaheir's is any mana", () => {
    expect(copySubject("Sunken Palace").paidColors).toEqual(["U"]);
    expect(copySubject("Dynaheir, Invoker Adept").paidColors).toBeUndefined();
  });
  test("Sunken Palace: an ability whose cost its BLUE mana can pay (generic, {X}, {U}); not {T}-only, loyalty, a {0} cost (no mana can be spent on it), or {B}{B}, {B}{G}, {R}, {R/G}", () => {
    expect(kindReach("Sunken Palace")).toEqual(["Mistrise Village", "Chandra's Regulator", "Pacesetter Paragon", "Forsworn Paladin", "Helix Pinnacle", "Icy Manipulator"]);
    for (const s of ["Prodigal Sorcerer", "Mother of Runes", "Goblin Welder", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon", "Viscera Seer", "Whispering Shade", "Kalitas, Bloodchief of Ghet", "Uurg, Spawn of Turg", "Vexing Shusher", "Lethal Vapors"]) expect(copies("Sunken Palace", s)).toEqual([]);
  });
  test("Repeated Reverberation: a loyalty ability only", () => {
    expect(kindReach("Repeated Reverberation")).toEqual(["Chandra, Torch of Defiance", "Ugin, the Spirit Dragon"]);
  });
  test("Wyll's Reversal: 'with one or more targets' is a demand that the copied ability aims at something", () => {
    expect(copySubject("Wyll's Reversal").targets).toEqual({});
    expect(copies("Wyll's Reversal", "Mistrise Village")).toEqual([]);
    expect(copies("Wyll's Reversal", "Prodigal Sorcerer")).toEqual(["copies:activated"]);
    expect(copies("Wyll's Reversal", "Mother of Runes")).toEqual(["copies:activated"]);
  });
  test("Wyll's Reversal: an ability with a target (not Mistrise Village or Sledge-Captain, whose backup derives no target slot)", () => {
    expect(kindReach("Wyll's Reversal")).toEqual(["Vexing Shusher", "Prodigal Sorcerer", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon", "Mother of Runes", "Goblin Welder", "Forsworn Paladin", "Icy Manipulator", "Kalitas, Bloodchief of Ghet"]);
  });
  test("Bill Potts: an activated ability that could target only a creature (Bill Potts is one)", () => {
    expect(kindReach("Bill Potts")).toEqual(["Prodigal Sorcerer", "Chandra, Torch of Defiance", "Ugin, the Spirit Dragon", "Mother of Runes", "Forsworn Paladin", "Icy Manipulator", "Kalitas, Bloodchief of Ghet"]);
  });
});

describe("review round 3 (#1650)", () => {
  test("a Phyrexian mana symbol is paid with 2 life (CR 107.4f): Verrak reaches Birthing Pod, and still not a plain-mana ability", () => {
    expect(copies("Verrak, Warped Sengir", "Birthing Pod")).toEqual(["copies:activated"]);
    expect(copies("Verrak, Warped Sengir", "Icy Manipulator")).toEqual([]);
  });
  test("a target slot keeps its colour and its negated subtype: Bill Potts (red Human) is no target of 'black creature', 'non-Human creature' or 'blue creature'", () => {
    for (const s of ["Exorcist", "Sigardian Priest", "Slingshot Goblin"]) expect(copies("Bill Potts", s)).toEqual([]);
    expect(copies("Bill Potts", "Akki Drillmaster")).toEqual(["copies:activated"]);
    expect(copies("Bill Potts", "Forsworn Paladin")).toEqual(["copies:activated"]);
  });
  test("derive: Gogo's own ability is marked uncopiable (it prints 'This ability can't be copied'); no other card's ability here is", () => {
    expect(card("Gogo, Master of Mimicry").tags!.abilities.find((a) => a.effect.kind === "copy-ability")!.uncopiable).toBe(true);
    expect(card("Icy Manipulator").tags!.abilities.some((a) => a.uncopiable)).toBe(false);
  });
  test("an ability that can't be copied is no producer: none of Unbound Flourishing, Sunken Palace, Wyll's Reversal or Rings of Brighthearth copies Gogo's ability (Gogo copying THEIR triggers is another pair)", () => {
    for (const c of ["Unbound Flourishing", "Sunken Palace", "Wyll's Reversal", "Rings of Brighthearth"]) expect([c, pairReasons(card(c), card("Gogo, Master of Mimicry"), H).filter((r) => r.consumer === c && r.tag.startsWith("copies:")).map((r) => r.tag)]).toEqual([c, []]);
    expect(copies("Rings of Brighthearth", "Icy Manipulator")).toEqual(["copies:activated"]);
  });
  test("a target phrase with a word the slot does not capture is refused for a SELF demand (Bill Potts): 'attacking creature with flying' (Femeref Archers), 'Vehicle becomes an artifact' (Mech Hangar)", () => {
    for (const s of ["Femeref Archers", "Mech Hangar"]) expect(copies("Bill Potts", s)).toEqual([]);
    for (const s of ["Akki Drillmaster", "Forsworn Paladin"]) expect(copies("Bill Potts", s)).toEqual(["copies:activated"]);
  });
  test("derive: the slot is marked `unread` only when its phrase carries an uncaptured word; Wyll's Reversal ('one or more targets') still admits it", () => {
    const slots = (n: string) => card(n).tags!.abilities.flatMap((a) => a.targets ?? []);
    expect(slots("Femeref Archers").some((x) => x.unread === true)).toBe(true);
    expect(slots("Mech Hangar").some((x) => x.unread === true)).toBe(true);
    expect(slots("Akki Drillmaster").some((x) => x.unread === true)).toBe(false);
    expect(slots("Forsworn Paladin").some((x) => x.unread === true)).toBe(false);
    expect(slots("Exorcist").some((x) => x.unread === true)).toBe(false);
    expect(copies("Wyll's Reversal", "Femeref Archers")).toEqual(["copies:activated"]);
  });
  test("a TOKEN head, a colour the slot does not carry, and a relative tail after the matched phrase are unread: Bill Potts (a nontoken red creature) is refused Dogged Hunter, Magewright's Stone and Lightwielder Paladin", () => {
    for (const s of ["Dogged Hunter", "Magewright's Stone", "Lightwielder Paladin"]) expect([s, copies("Bill Potts", s)]).toEqual([s, []]);
    expect(copies("Bill Potts", "Akki Drillmaster")).toEqual(["copies:activated"]);
    expect(card("Dogged Hunter").tags!.abilities.flatMap((a) => a.targets ?? []).some((x) => x.unread === true)).toBe(true);
    expect(card("Magewright's Stone").tags!.abilities.flatMap((a) => a.targets ?? []).some((x) => x.unread === true)).toBe(true);
  });
});
