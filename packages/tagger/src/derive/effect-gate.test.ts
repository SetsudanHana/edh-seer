import { describe, expect, it } from "vitest";
import type { ClauseRecord } from "../canonicalize.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveCardTags } from "./derive.js";
import { effectGates, sentenceGate } from "./effect-gate.js";
import { parseGate } from "./gate.js";

// Real oracle text (Mongo `cards`, 2026-10-27).
const card = (name: string, typeLine: string, oracleText: string, keywords: string[] = []) => ({ name, typeLine, oracleText, keywords });
const VEIL = card("Veil of Summer", "Instant", "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn. (You and they can't be the targets of blue or black spells or abilities your opponents control.)");
const WEATHERLIGHT = card("Weatherlight Compleated", "Legendary Artifact — Vehicle", "Flying\nAs long as Weatherlight Compleated has four or more phyresis counters on it, it's a Phyrexian creature in addition to its other types.\nWhenever a creature you control dies, put a phyresis counter on Weatherlight Compleated. Then draw a card if it has seven or more phyresis counters on it. If it doesn't, scry 1.", ["Scry", "Flying"]);
const BEZA = card("Beza, the Bounding Spring", "Legendary Creature — Elemental Fish", "When Beza enters, create a Treasure token if an opponent controls more lands than you. You gain 4 life if an opponent has more life than you. Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you. Draw a card if an opponent has more cards in hand than you.");
const INSPIRING_CALL = card("Inspiring Call", "Instant", "Draw a card for each creature you control with a +1/+1 counter on it. Those creatures gain indestructible until end of turn. (Damage and effects that say \"destroy\" don't destroy them.)");
const FEDERATION = card("Federation Field Medic", "Creature — Human Doctor", "Vigilance\nWhen this creature enters, choose one —\n• Put a +1/+1 counter on target creature. It gains vigilance until end of turn.\n• Draw a card if you control a permanent with a counter on it.", ["Vigilance"]);
const MEET_AND_GREET = card("Meet and Greet \"Sisay\"", "Legendary Creature — Human", "Whenever you cast a spell, choose one —\n• Flavor — Meet and Greet \"Sisay\" gets +1/+1 until end of turn for each line of flavor text that spell has.\n• History — Create a Treasure token if that spell doesn't share an expansion symbol with a permanent you control or a card in your graveyard.");
const WHAT_MUST_BE_DONE = card("What Must Be Done", "Sorcery", "Choose one —\n• Let the World Burn — Destroy all artifacts and creatures.\n• Release Juno — Return target historic permanent card from your graveyard to the battlefield. It enters with two additional +1/+1 counters on it if it's a creature. (Artifacts, legendaries, and Sagas are historic.)", ["Release Juno", "Let the World Burn"]);
const GLORIOUS_SUNRISE = card("Glorious Sunrise", "Enchantment", "At the beginning of combat on your turn, choose one —\n• Creatures you control get +1/+1 and gain trample until end of turn.\n• Target land gains \"{T}: Add {G}{G}{G}\" until end of turn.\n• Draw a card if you control a creature with power 3 or greater.\n• You gain 3 life.");
const ROADSIDE = card("Roadside Reliquary", "Land", "{T}: Add {C}.\n{2}, {T}, Sacrifice this land: Draw a card if you control an artifact. Draw a card if you control an enchantment.");
const CABAL_RITUAL = card("Cabal Ritual", "Instant", "Add {B}{B}{B}.\nThreshold — Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard.");
const FAMISHED = card("Famished Foragers", "Creature — Human Rogue", "When this creature enters, if an opponent lost life this turn, add {R}{R}{R}.\n{2}{R}, Discard a card: Draw a card.");
const ERRAND_RIDER = card("Errand-Rider of Gondor", "Creature — Human Soldier", "When this creature enters, draw a card. Then if you don't control a legendary creature, put a card from your hand on the bottom of your library.");
const VENSER = card("Venser, Corpse Puppet", "Legendary Creature — Phyrexian Zombie Wizard", "Lifelink, toxic 1\nWhenever you proliferate, choose one —\n• If you don't control a creature named The Hollow Sentinel, create The Hollow Sentinel, a legendary 3/3 colorless Phyrexian Golem artifact creature token.\n• Target artifact creature you control gains flying and lifelink until end of turn.");
const ASININE = card("Asinine Antics", "Sorcery", "You may cast this spell as though it had flash if you pay {2} more to cast it.\nFor each creature your opponents control, create a Cursed Role token attached to that creature. (If you control another Role on it, put that one into the graveyard. Enchanted creature is 1/1.)");
const GRAVETILLER = card("Gravetiller Wurm", "Creature — Wurm", "Trample\nMorbid — This creature enters with four +1/+1 counters on it if a creature died this turn.", ["Trample"]);

/** The grammar path: records from the printed text alone. */
const viaGrammar = (c: ReturnType<typeof card>) => {
  const g = grammarClauseRecords(c);
  return { g, tags: deriveCardTags(deriveInputOf(c as never, "x", c.name, g.records, undefined, g.readings)) };
};
/** The model path: the stored answer (hand-copied from cardClauses) with no grammar readings; derive reads the printed clause text. */
const viaModel = (c: ReturnType<typeof card>, records: ClauseRecord[]) => deriveCardTags(deriveInputOf(c as never, "x", c.name, records));
const act = (verb: string, object: string, extra: Record<string, unknown> = {}) => ({ verb, object, fromZone: null, toZone: null, amount: null, optional: false, ...extra }) as never;
const byKind = (tags: ReturnType<typeof deriveCardTags>, kind: string) => tags.abilities.filter((a) => a.effect.kind === kind);

describe("parseGate reads an effect's condition by the same words as a mana line's (#1357)", () => {
  it("a spell an opponent cast this turn is a turn-event (Veil of Summer)", () => {
    expect(parseGate("an opponent has cast a blue or black spell this turn")).toEqual({ kind: "turn-event", event: "opponent-cast", text: "an opponent has cast a blue or black spell this turn" });
    expect(parseGate("an opponent cast a blue spell this turn")).toMatchObject({ kind: "turn-event", event: "opponent-cast" });
  });
  it("counters on the card itself (Weatherlight Compleated), by the pronoun", () => {
    expect(parseGate("it has seven or more phyresis counters on it")).toEqual({ kind: "counter", counter: "phyresis", need: 7, text: "it has seven or more phyresis counters on it" });
  });
  it("a comparison with an opponent is unknown (Beza), text kept", () => {
    expect(parseGate("an opponent controls more creatures than you")).toEqual({ kind: "unknown", text: "an opponent controls more creatures than you" });
  });
});

describe("sentenceGate: the trailing condition of one sentence, and what is no gate", () => {
  it("a trailing if is the condition, verbatim", () => {
    expect(sentenceGate("Draw a card if an opponent has cast a blue or black spell this turn")).toEqual({ shape: "trailing", condition: "an opponent has cast a blue or black spell this turn" });
    expect(sentenceGate("Then draw a card if it has seven or more phyresis counters on it")).toEqual({ shape: "trailing", condition: "it has seven or more phyresis counters on it" });
    expect(sentenceGate("Create two 1/1 blue Fish creature tokens if an opponent controls more creatures than you")).toMatchObject({ shape: "trailing", condition: "an opponent controls more creatures than you" });
  });
  it("a condition about 'you don't control' is a gate; only the bare follow-up 'if you do' / 'if you don't' is not", () => {
    expect(sentenceGate("Sacrifice a creature if you don't control an Ogre")).toMatchObject({ shape: "trailing" });
    expect(sentenceGate("Put it into your hand if you don't")).toEqual({ shape: "exempt" });
    expect(sentenceGate("If you do, draw a card")).toEqual({ shape: "exempt" });
    expect(sentenceGate("This creature attacks each combat if able")).toEqual({ shape: "exempt" });
  });
  it("a cost reduction, an activation or cast restriction, a price of an option and a replacement are no gate", () => {
    expect(sentenceGate("This spell costs {2} less to cast if it targets a permanent with mana value 1").shape).toBe("exempt");
    expect(sentenceGate("Activate only if you control a Swamp").shape).toBe("exempt");
    expect(sentenceGate("Cast this spell only during the declare attackers step and only if you've been attacked this step").shape).toBe("exempt");
    expect(sentenceGate("You may cast this spell as though it had flash if you pay {2} more to cast it").shape).toBe("exempt");
    expect(sentenceGate("Add {B}{B}{B}{B}{B} instead if there are seven or more cards in your graveyard").shape).toBe("exempt");
    expect(sentenceGate("If you would draw a card, draw two cards instead").shape).toBe("exempt");
  });
  it("a condition that LEADS the sentence is not read (the grammar refuses a mode over it)", () => {
    expect(sentenceGate("If you don't control a creature named The Hollow Sentinel, create The Hollow Sentinel")).toEqual({ shape: "leading" });
    expect(sentenceGate("Then if you don't control a legendary creature, put a card from your hand on the bottom of your library")).toEqual({ shape: "leading" });
    expect(sentenceGate("Create a 1/1 black Rat creature token that's tapped and attacking, then if you control five or more Rats, each Rat you control gets +2/+0 until end of turn")).toEqual({ shape: "leading" });
  });
  it("an if inside a quoted ability belongs to the grant, not to the sentence", () => {
    expect(sentenceGate("Creatures you control gain \"Whenever this creature attacks, draw a card if you control a Dragon\" until end of turn")).toEqual({ shape: "none" });
  });
  it("two ifs in a sentence are one unreadable condition, the tail from the first", () => {
    expect(sentenceGate("Creatures your opponents control get -1/-0 until end of turn if {U} was spent to cast this spell, and creatures you control get +1/+0 until end of turn if {R} was spent to cast this spell")).toMatchObject({ shape: "trailing", condition: expect.stringMatching(/^\{U\} was spent .* if \{R\} was spent/) });
  });
});

describe("effectGates: which action's verb finds the gated sentence", () => {
  it("the k-th action of a verb takes the k-th sentence carrying its printed word", () => {
    const body = "Draw a card if you control an artifact. Draw a card if you control an enchantment.";
    expect(effectGates(body, ["draw", "draw"])).toEqual({ gates: ["you control an artifact", "you control an enchantment"], refused: false });
  });
  it("only the ability the condition gates carries it", () => {
    const body = "Return target historic permanent card from your graveyard to the battlefield. It enters with two additional +1/+1 counters on it if it's a creature.";
    expect(effectGates(body, ["return", "add-counter"])).toEqual({ gates: [null, "it's a creature"], refused: false });
  });
  it("a restriction and a static grant are found by the words they print (can't, has), not by the condition's own words", () => {
    expect(effectGates("This creature can't be blocked if you've cast two or more spells this turn.", ["cant"])).toEqual({ gates: ["you've cast two or more spells this turn"], refused: false });
    expect(effectGates("Draw a card if an opponent has cast a blue or black spell this turn. You and permanents you control gain hexproof.", ["draw", "grant-ability"]).gates).toEqual(["an opponent has cast a blue or black spell this turn", null]);
  });
  it("a gated sentence no action finds, and a leading condition, are reported as refused", () => {
    expect(effectGates("Draw a card if you control an artifact.", ["gain-life"]).refused).toBe(true);
    expect(effectGates("If you control a Dragon, draw a card.", ["draw"])).toEqual({ gates: [null], refused: true });
  });
  it("an exempt sentence is neither a gate nor a refusal", () => {
    expect(effectGates("Draw a card. If you do, gain 2 life.", ["draw", "gain-life"])).toEqual({ gates: [null, null], refused: false });
  });
});

describe("derive stamps Ability.gate on the ability its sentence made, with conditionCares where the deck can supply the condition (#1357)", () => {
  it("Veil of Summer (grammar and model): the draw is a turn-event gate, the rest of the spell is ungated", () => {
    const model = viaModel(VEIL, [{ id: 1, abilityType: "spell", actions: [act("draw", "a card"), act("cant", "be countered"), act("grant-ability", "hexproof from blue and from black")] }]);
    for (const tags of [viaGrammar(VEIL).tags, model]) {
      const draw = byKind(tags, "draw-card");
      expect(draw).toHaveLength(1);
      expect(draw[0]!.gate).toEqual({ kind: "turn-event", event: "opponent-cast", text: "an opponent has cast a blue or black spell this turn" });
      expect(draw[0]!.conditionCares).toBeUndefined();
      expect(tags.abilities.filter((a) => a.effect.kind !== "draw-card").every((a) => a.gate === undefined)).toBe(true);
    }
  });
  it("Weatherlight Compleated (grammar and model): the draw is a counter gate with the counter demand; the counter placed and the scry are ungated", () => {
    const model = viaModel(WEATHERLIGHT, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying" } as never] },
      { id: 2, abilityType: "static", actions: [act("grant-ability", "Phyrexian creature type in addition to its other types")] },
      { id: 3, abilityType: "triggered", trigger: { event: "dies", subject: "a creature you control", control: "you" }, actions: [act("add-counter", "phyresis", { amount: "1" }), act("draw", "a card", { amount: "1" }), act("scry", "1", { amount: "1" })] },
    ]);
    for (const tags of [viaGrammar(WEATHERLIGHT).tags, model]) {
      const gated = tags.abilities.filter((a) => a.gate !== undefined);
      expect(gated.map((a) => a.effect.kind)).toEqual(["draw-card"]);
      expect(gated[0]!.gate).toEqual({ kind: "counter", counter: "phyresis", need: 7, text: "it has seven or more phyresis counters on it" });
      expect(gated[0]!.conditionCares).toEqual(["counter-added:any"]);
    }
  });
  it("Beza: four effects, four unknown gates (an opponent comparison), each its own sentence's text", () => {
    const { tags } = viaGrammar(BEZA);
    const gated = tags.abilities.filter((a) => a.gate !== undefined);
    expect(gated.map((a) => a.gate)).toEqual([
      { kind: "unknown", text: "an opponent controls more lands than you" },
      { kind: "unknown", text: "an opponent has more life than you" },
      { kind: "unknown", text: "an opponent controls more creatures than you" },
      { kind: "unknown", text: "an opponent has more cards in hand than you" },
    ]);
    expect(gated.every((a) => a.conditionCares === undefined)).toBe(true);
  });
  it("Inspiring Call prints no 'if': the draw SCALES with the creatures that have a counter, and is no gate", () => {
    expect(viaGrammar(INSPIRING_CALL).tags.abilities.every((a) => a.gate === undefined)).toBe(true);
  });
  it("Federation Field Medic: the mode derives the draw WITH its gate and the counter demand; the other mode is ungated", () => {
    const { g, tags } = viaGrammar(FEDERATION);
    expect(g.complete).toBe(true);
    const draw = byKind(tags, "draw-card");
    expect(draw).toHaveLength(1);
    expect(draw[0]!.gate).toEqual({ kind: "unknown", text: "you control a permanent with a counter on it" });
    expect(draw[0]!.conditionCares).toEqual(["counter-added:any"]);
    expect(byKind(tags, "counter-placement").every((a) => a.gate === undefined)).toBe(true);
    expect(JSON.stringify(tags.unclaimed ?? [])).not.toContain("permanent with a counter");
  });
  it("Meet and Greet \"Sisay\": the Treasure of the History mode is gated (unknown), the Flavor mode is not", () => {
    const { g, tags } = viaGrammar(MEET_AND_GREET);
    expect(g.complete).toBe(true);
    const treasure = byKind(tags, "token-generation");
    expect(treasure).toHaveLength(1);
    expect(treasure[0]!.gate).toMatchObject({ kind: "unknown", text: "that spell doesn't share an expansion symbol with a permanent you control or a card in your graveyard" });
    expect(tags.abilities.filter((a) => a !== treasure[0]).every((a) => a.gate === undefined)).toBe(true);
  });
  it("What Must Be Done: the return is kept, and the gate sits on the counters part only (grammar and model)", () => {
    const model = viaModel(WHAT_MUST_BE_DONE, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "" } as never] },
      { id: 2, abilityType: "spell", actions: [act("destroy", "all artifacts and creatures")] },
      { id: 3, abilityType: "spell", actions: [act("return", "target historic permanent card", { fromZone: "graveyard", toZone: "battlefield" }), act("add-counter", "+1/+1", { amount: "two additional" })] },
    ]);
    const { g, tags } = viaGrammar(WHAT_MUST_BE_DONE);
    expect(g.complete).toBe(true);
    for (const t of [tags, model]) {
      const back = byKind(t, "graveyard-recursion");
      expect(back).toHaveLength(1);
      expect(back[0]!.gate).toBeUndefined();
      const counters = byKind(t, "enters-with-counters");
      expect(counters).toHaveLength(1);
      expect(counters[0]!.gate).toEqual({ kind: "unknown", text: "it's a creature" });
    }
  });
  it("Glorious Sunrise and Roadside Reliquary (model): each draw carries its own control gate, the other modes and the sacrifice none", () => {
    const sunrise = viaModel(GLORIOUS_SUNRISE, [
      { id: 1, abilityType: "triggered", trigger: { event: "begin-combat", subject: "you", control: "you" }, actions: [] },
      { id: 2, abilityType: "triggered", actions: [act("modify-pt", "Creatures you control", { amount: "+1/+1" }), act("grant-ability", "Creatures you control", { amount: "trample" })] },
      { id: 3, abilityType: "triggered", actions: [act("grant-ability", "Target land", { amount: "{T}: Add {G}{G}{G}" })] },
      { id: 4, abilityType: "triggered", actions: [act("draw", "a card", { amount: "1", optional: true })] },
      { id: 5, abilityType: "triggered", actions: [act("gain-life", "you", { amount: "3" })] },
    ]);
    expect(byKind(sunrise, "draw-card")[0]!.gate).toEqual({ kind: "control", need: 1, nouns: ["creature"], minPower: 3, text: "you control a creature with power 3 or greater" });
    expect(sunrise.abilities.filter((a) => a.effect.kind !== "draw-card").every((a) => a.gate === undefined)).toBe(true);
    const reliquary = viaModel(ROADSIDE, [
      { id: 1, abilityType: "activated", actions: [act("add-mana", "{C}")] },
      { id: 2, abilityType: "activated", actions: [act("sacrifice", "this land"), act("draw", "a card", { amount: "1", optional: true }), act("draw", "a card", { amount: "1", optional: true })] },
    ]);
    expect(byKind(reliquary, "draw-card").map((a) => a.gate)).toEqual([
      { kind: "control", need: 1, nouns: ["artifact"], text: "you control an artifact" },
      { kind: "control", need: 1, nouns: ["enchantment"], text: "you control an enchantment" },
    ]);
  });
  it("a replacement-style 'enters with ... counters if' is gated like any effect (Gravetiller Wurm: a creature died this turn)", () => {
    const counters = byKind(viaGrammar(GRAVETILLER).tags, "enters-with-counters");
    expect(counters).toHaveLength(1);
    expect(counters[0]!.gate).toEqual({ kind: "turn-event", event: "creature-died", text: "a creature died this turn" });
  });
});

describe("what is not a gate stays byte-identical", () => {
  it("a mana line's own gate is unchanged and its ability is not gated (Cabal Ritual's 'instead if', Famished Foragers' intervening if)", () => {
    const cabal = viaGrammar(CABAL_RITUAL).tags;
    expect(cabal.abilities.every((a) => a.gate === undefined)).toBe(true);
    const foragers = viaGrammar(FAMISHED).tags;
    expect(foragers.abilities.every((a) => a.gate === undefined)).toBe(true);
    expect(foragers.manaLines?.some((l) => l.gate?.kind === "turn-event")).toBe(true);
  });
  it("'if you do' / 'you may cast ... if you pay {2} more' / a leading 'Then if' derive no gate", () => {
    for (const c of [ASININE, ERRAND_RIDER]) expect(viaGrammar(c).tags.abilities.every((a) => a.gate === undefined), c.name).toBe(true);
  });
  it("a MODE that opens with its condition keeps the whole-mode refusal (Venser: the token is not an unconditional one)", () => {
    const { tags } = viaGrammar(VENSER);
    expect(tags.abilities.some((a) => a.effect.kind === "token-generation")).toBe(false);
  });
});
