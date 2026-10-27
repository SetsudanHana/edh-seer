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
const VENSER = card("Venser, Corpse Puppet", "Legendary Creature — Phyrexian Zombie Wizard", "Lifelink, toxic 1\nWhenever you proliferate, choose one —\n• If you don't control a creature named The Hollow Sentinel, create The Hollow Sentinel, a legendary 3/3 colorless Phyrexian Golem artifact creature token.\n• Target artifact creature you control gains flying and lifelink until end of turn.");
const ASININE = card("Asinine Antics", "Sorcery", "You may cast this spell as though it had flash if you pay {2} more to cast it.\nFor each creature your opponents control, create a Cursed Role token attached to that creature. (If you control another Role on it, put that one into the graveyard. Enchanted creature is 1/1.)");
const GIANTS_IRE = card("Giant's Ire", "Kindred Sorcery — Giant", "Giant's Ire deals 4 damage to target player or planeswalker. If you control a Giant, draw a card.");
const ARTERIAL_FLOW = card("Arterial Flow", "Sorcery", "Each opponent discards two cards. If you control a Vampire, each opponent loses 2 life and you gain 2 life.");
const UNHOLY_ANNEX = card("Unholy Annex // Ritual Chamber", "Enchantment — Room // Enchantment — Room", "At the beginning of your end step, draw a card. If you control a Demon, each opponent loses 2 life and you gain 2 life. Otherwise, you lose 2 life.\n(You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)\n//\nWhen you unlock this door, create a 6/6 black Demon creature token with flying.\n(You may cast either half. That door unlocks on the battlefield. As a sorcery, you may pay the mana cost of a locked door to unlock it.)");
const LOREHOLD_EXCAVATION = card("Lorehold Excavation", "Enchantment", "At the beginning of your end step, mill a card. If a land card was milled this way, you gain 1 life. Otherwise, this enchantment deals 1 damage to each opponent.\n{5}, Exile a creature card from your graveyard: Create a tapped 3/2 red and white Spirit creature token.");
const OIL_GORGER = card("Oil-Gorger Troll", "Creature — Phyrexian Troll Warrior", "When this creature enters, you gain 3 life. Then if you control a permanent with an oil counter on it, draw a card.");
const HEAVEN_SENT = card("Heaven Sent", "Enchantment — Saga", "\nI, II — Investigate.\nIII — This Saga deals 1 damage to each opponent. Then if an opponent has 0 or less life, draw seven cards. Otherwise, exile this Saga and you may cast it this turn.");
const GOBLIN_BARRAGE = card("Goblin Barrage", "Sorcery", "Kicker—Sacrifice an artifact or Goblin. (You may sacrifice an artifact or Goblin in addition to any other costs as you cast this spell.)\nGoblin Barrage deals 4 damage to target creature. If this spell was kicked, it also deals 4 damage to target player or planeswalker.", ["Kicker"]);
const STRENGTH_OF_NIGHT = card("Strength of Night", "Instant", "Kicker {B} (You may pay an additional {B} as you cast this spell.)\nCreatures you control get +1/+1 until end of turn. If this spell was kicked, Zombie creatures you control get an additional +2/+2 until end of turn.", ["Kicker"]);
const HISTORIAN = card("Historian of Zhalfir", "Creature — Human Wizard", "Whenever this creature attacks, if you control a Teferi planeswalker, draw a card.");
const EXCAVATING_ANURID = card("Excavating Anurid", "Creature — Frog Beast", "When this creature enters, you may sacrifice a land. If you do, draw a card.\nThreshold — As long as there are seven or more cards in your graveyard, this creature gets +1/+1 and has vigilance.");
const PEST_RESCUER = card("Pest Rescuer", "Creature — Dryad Druid", "At the beginning of each upkeep, if you don't control a Pest creature token, create a 1/1 black and green Pest creature token with \"When this token dies, you gain 1 life.\"\nIf you would gain life, you gain that much life plus 1 instead.");
const AGRUS_KOS = card("Agrus Kos, Spirit of Justice", "Legendary Creature — Spirit Detective", "Double strike, vigilance\nWhenever Agrus Kos enters or attacks, choose up to one target creature. If it's suspected, exile it. Otherwise, suspect it. (A suspected creature has menace and can't block.)", ["Double strike", "Vigilance"]);
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

describe("parseGate (#1357 review): tron is the Urza lands only", () => {
  it("two kinds of permanent are a control count of neither, an Urza land pair is tron", () => {
    expect(parseGate("you control an artifact and an enchantment")).toEqual({ kind: "unknown", text: "you control an artifact and an enchantment" });
    expect(parseGate("you control an urza's mine and an urza's tower")).toMatchObject({ kind: "tron" });
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
  it("a condition that LEADS the sentence is read up to its comma (#1357 part 2)", () => {
    expect(sentenceGate("If you don't control a creature named The Hollow Sentinel, create The Hollow Sentinel")).toEqual({ shape: "leading", condition: "you don't control a creature named The Hollow Sentinel" });
    expect(sentenceGate("Then if you don't control a legendary creature, put a card from your hand on the bottom of your library")).toEqual({ shape: "leading", condition: "you don't control a legendary creature" });
    expect(sentenceGate("Create a 1/1 black Rat creature token that's tapped and attacking, then if you control five or more Rats, each Rat you control gets +2/+0 until end of turn")).toEqual({ shape: "leading", condition: "you control five or more Rats" });
  });
  it("an if inside a quoted ability belongs to the grant, not to the sentence", () => {
    expect(sentenceGate("Creatures you control gain \"Whenever this creature attacks, draw a card if you control a Dragon\" until end of turn")).toEqual({ shape: "none" });
  });
  it("two ifs in a sentence are two conditions, each cut at the conjunct that ends it (Unnerving Assault)", () => {
    expect(sentenceGate("Creatures your opponents control get -1/-0 until end of turn if {U} was spent to cast this spell, and creatures you control get +1/+0 until end of turn if {R} was spent to cast this spell")).toEqual({ shape: "trailing", condition: "{U} was spent to cast this spell" });
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
  // Real oracle text, Mongo `cards` 2026-10-27. #1357 review: an "if" gates the action of ITS conjunct, not every action in its sentence.
  it("Quag Feast: the mill is not gated, the destroy after ', then' is", () => {
    const body = "Mill two cards, then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your graveyard.";
    expect(effectGates(body, ["mill", "destroy"]).gates).toEqual([null, "its mana value is less than or equal to the number of cards in your graveyard"]);
  });
  it("Ouphe Vandals: the counter-spell is not gated, the destroy is", () => {
    expect(effectGates("Counter target activated ability from an artifact source and destroy that artifact if it's on the battlefield.", ["counter-spell", "destroy"]).gates).toEqual([null, "it's on the battlefield"]);
  });
  it("Aurelia: each 'gains' takes its own if and the pump takes none", () => {
    const body = "Until end of turn, that creature gets +2/+0, gains trample if it's red, and gains vigilance if it's white.";
    expect(effectGates(body, ["modify-pt", "grant-ability", "grant-ability"])).toEqual({ gates: [null, "it's red", "it's white"], refused: false });
  });
  it("Savage Punch: 'before it fights' is a modifier of the pump, not a conjunct, so the pump keeps its gate", () => {
    const body = "The creature you control gets +2/+2 until end of turn before it fights if you control a creature with power 4 or greater.";
    expect(effectGates(body, ["modify-pt", "fight"]).gates).toEqual(["you control a creature with power 4 or greater", "you control a creature with power 4 or greater"]);
  });
  it("Lucy MacLean: the token is not gated, the draw after ', then' is", () => {
    const body = "you may have target player other than its controller create a token that's a copy of it, then you draw a card if an opponent created a token this way.";
    expect(effectGates(body, ["create", "draw"]).gates).toEqual([null, "an opponent created a token this way"]);
  });
  it("a clone's ', except ... if' rider never gates the copy: Spark Double (each counter its own if), Undercover Operative, Flesh Duplicate, Double Major; Vizier's 'except if' is no gate", () => {
    expect(effectGates("You may have this creature enter as a copy of a creature or planeswalker you control, except it enters with an additional +1/+1 counter on it if it's a creature, it enters with an additional loyalty counter on it if it's a planeswalker, and it isn't legendary.", ["copy", "add-counter", "add-counter"]).gates)
      .toEqual([null, "it's a creature", "it's a planeswalker"]);
    expect(effectGates("You may have this creature enter as a copy of any creature on the battlefield, except it enters with a shield counter on it if you control that creature.", ["copy", "add-counter"]).gates).toEqual([null, "you control that creature"]);
    expect(effectGates("You may have this creature enter as a copy of any creature on the battlefield, except it has vanishing 3 if that creature doesn't have vanishing.", ["copy"]).gates).toEqual([null]);
    expect(effectGates("Copy target creature spell you control, except it isn't legendary if the spell is legendary.", ["copy"]).gates).toEqual([null]);
    expect(effectGates("You may have this creature enter as a copy of any creature on the battlefield, except if this creature was embalmed, the token has no mana cost, it's white, and it's a Zombie in addition to its other types.", ["copy"])).toEqual({ gates: [null], refused: false });
  });
  it("a gated sentence no action finds is reported as refused; a leading condition with an action after it is not", () => {
    expect(effectGates("Draw a card if you control an artifact.", ["gain-life"]).refused).toBe(true);
    expect(effectGates("If you control a Dragon, draw a card.", ["gain-life"]).refused).toBe(true);
    expect(effectGates("If you control a Dragon, draw a card.", ["draw"])).toEqual({ gates: ["you control a Dragon"], refused: false });
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
      // The counter is the card's OWN kind ("put a phyresis counter on Weatherlight Compleated"): no deck supplies it, so no counters demand (#1357 review; the false demand also reached edges.ts' dies-trigger guard).
      expect(gated[0]!.conditionCares).toBeUndefined();
    }
  });
  it("a counter demand is kept only where a deck can supply the counter: Federation (generic), Marcus (another creature's +1/+1), Aven Courier; dropped where the card places its own: Fasting, Steel Dromedary", () => {
    const marcus = viaGrammar(card("Marcus, Mutant Mayor", "Legendary Creature — Mutant Human", "Vigilance, trample\nWhenever a creature you control deals combat damage to a player, draw a card if that creature has a +1/+1 counter on it. If it doesn't, put a +1/+1 counter on it.", ["Vigilance", "Trample"])).tags;
    expect(marcus.abilities.find((a) => a.effect.kind === "draw-card")!.conditionCares).toEqual(["counter-added:any"]);
    const fasting = viaGrammar(card("Fasting", "Enchantment", "At the beginning of your upkeep, put a hunger counter on this enchantment. Then destroy this enchantment if it has five or more hunger counters on it.\nIf you would begin your draw step, you may skip that step instead. If you do, you gain 2 life.\nWhen you draw a card, destroy this enchantment.")).tags;
    expect(fasting.abilities.filter((a) => a.gate !== undefined).every((a) => a.conditionCares === undefined)).toBe(true);
    const dromedary = viaGrammar(card("Steel Dromedary", "Creature — Camel", "This creature enters tapped with two +1/+1 counters on it.\nThis creature doesn't untap during your untap step if it has a +1/+1 counter on it.\nAt the beginning of combat on your turn, you may move a +1/+1 counter from this creature onto target creature.")).tags;
    expect(dromedary.abilities.filter((a) => a.gate !== undefined).every((a) => a.conditionCares === undefined)).toBe(true);
  });
  it("Quag Feast and Aurelia derive the gate on the right ability only", () => {
    const quag = viaGrammar(card("Quag Feast", "Sorcery", "Choose target creature, planeswalker, or Vehicle. Mill two cards, then destroy the chosen permanent if its mana value is less than or equal to the number of cards in your graveyard.")).tags;
    expect(quag.abilities.filter((a) => a.gate !== undefined).map((a) => a.effect.kind)).not.toContain("mill");
    const aureliaCard = card("Aurelia, Exemplar of Justice", "Legendary Creature — Angel", "Flying\nMentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)\nAt the beginning of combat on your turn, choose up to one target creature you control. Until end of turn, that creature gets +2/+0, gains trample if it's red, and gains vigilance if it's white.", ["Flying", "Mentor"]);
    const aurelia = viaModel(aureliaCard, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flying" } as never] },
      { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Mentor" } as never] },
      { id: 3, abilityType: "triggered", trigger: { event: "begin-combat", subject: "you", control: "you" }, actions: [act("modify-pt", "that creature", { amount: "+2/+0" }), act("grant-ability", "that creature", { amount: "trample" }), act("grant-ability", "that creature", { amount: "vigilance" })] },
    ]);
    expect(aurelia.abilities.filter((a) => a.effect.kind === "pump").every((a) => a.gate === undefined)).toBe(true);
    expect(aurelia.abilities.filter((a) => a.gate !== undefined).map((a) => a.gate!.text).sort()).toEqual(["it's red", "it's white"]);
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
  it("'you may cast ... if you pay {2} more' derives no gate", () => {
    expect(viaGrammar(ASININE).tags.abilities.every((a) => a.gate === undefined)).toBe(true);
  });
  it("a MODE that opens with its condition is read, the token gated on it (Venser: not an unconditional one)", () => {
    const { g, tags } = viaGrammar(VENSER);
    expect(g.complete).toBe(true);
    const token = byKind(tags, "token-generation");
    expect(token).toHaveLength(1);
    expect(token[0]!.gate).toEqual({ kind: "unknown", text: "you don't control a creature named the hollow sentinel" });
  });
});

describe("a LEADING condition gates the effect it governs (#1357 part 2)", () => {
  it("Giant's Ire (grammar and model): the damage is ungated, the draw after 'If you control a Giant,' is a control gate", () => {
    const model = viaModel(GIANTS_IRE, [{ id: 1, abilityType: "spell", actions: [act("deal-damage", "target player or planeswalker", { amount: "4" }), act("draw", "a card", { amount: "1" })] }]);
    for (const tags of [viaGrammar(GIANTS_IRE).tags, model]) {
      expect(byKind(tags, "draw-card").map((a) => a.gate)).toEqual([{ kind: "control", need: 1, nouns: ["giant"], text: "you control a giant" }]);
      expect(tags.abilities.filter((a) => a.effect.kind !== "draw-card").every((a) => a.gate === undefined)).toBe(true);
    }
  });
  it("a leading condition governs the whole predicate: Arterial Flow's 'X and Y' are BOTH gated, the discard before the 'if' is not", () => {
    const { g, tags } = viaGrammar(ARTERIAL_FLOW);
    expect(g.complete).toBe(true);
    const gated = tags.abilities.filter((a) => a.gate !== undefined);
    expect(gated.map((a) => a.effect.kind).sort()).toEqual(["lifegain", "player-life-loss"]);
    expect(gated.every((a) => a.gate!.kind === "control" && a.gate!.text === "you control a vampire")).toBe(true);
    expect(byKind(tags, "discard").every((a) => a.gate === undefined)).toBe(true);
    expect(effectGates("If you control a Vampire, each opponent loses 2 life and you gain 2 life.", ["lose-life", "gain-life"]).gates).toEqual(["you control a Vampire", "you control a Vampire"]);
  });
  it("'Then if' (Oil-Gorger Troll, a trigger's effect): the draw is gated on the oil counter, the life gain before it is not; the demand is the counters one", () => {
    const { g, tags } = viaGrammar(OIL_GORGER);
    expect(g.complete).toBe(true);
    expect(byKind(tags, "draw-card").map((a) => a.gate)).toEqual([{ kind: "unknown", text: "you control a permanent with an oil counter on it" }]);
    expect(byKind(tags, "lifegain").every((a) => a.gate === undefined)).toBe(true);
  });
  it("'Then if' ends its condition at the comma, not at the sentence (Heaven Sent)", () => {
    const { tags } = viaGrammar(HEAVEN_SENT);
    expect(byKind(tags, "draw-card")[0]!.gate).toEqual({ kind: "unknown", text: "an opponent has 0 or less life" });
  });
  it("an 'Otherwise' branch is gated on the other branch, unread, never ungated: both branches carry a gate (Unholy Annex, Lorehold Excavation)", () => {
    for (const [c, expected] of [[UNHOLY_ANNEX, "you control a demon"], [LOREHOLD_EXCAVATION, "a land card was milled this way"]] as const) {
      const { tags } = viaGrammar(c);
      const gates = tags.abilities.filter((a) => a.gate !== undefined).map((a) => a.gate!);
      expect(gates.map((x) => x.text), c.name).toContain(expected);
      const other = gates.filter((x) => x.text.startsWith("it is not the case that"));
      expect(other.length, c.name).toBeGreaterThan(0);
      expect(other.every((x) => x.kind === "unknown" && x.text === `it is not the case that ${expected}`), c.name).toBe(true);
    }
    const annex = viaGrammar(UNHOLY_ANNEX).tags;
    expect(byKind(annex, "draw-card").every((a) => a.gate === undefined)).toBe(true);
    expect(annex.abilities.filter((a) => a.conditionCares !== undefined && a.gate?.text.startsWith("it is not the case"))).toEqual([]);
    expect(effectGates("Mill a card. If a land card was milled this way, you gain 1 life. Otherwise, this enchantment deals 1 damage to each opponent.", ["mill", "gain-life", "deal-damage"]).gates)
      .toEqual([null, "a land card was milled this way", "it is not the case that a land card was milled this way"]);
    expect(effectGates("If not, draw a card.", ["draw"]).gates).toEqual(["the condition before it does not hold"]);
  });
  it("an 'Otherwise' after a trailing 'if' is the branch of that condition too (Zurgo Stormrender)", () => {
    expect(effectGates("Draw a card if it was attacking. Otherwise, each opponent loses 1 life.", ["draw", "lose-life"]).gates).toEqual(["it was attacking", "it is not the case that it was attacking"]);
  });
  it("only the 'if's own sentence is gated: a following sentence is not (CEILING)", () => {
    expect(effectGates("If you control a Dragon, draw a card. You gain 2 life.", ["draw", "gain-life"]).gates).toEqual(["you control a Dragon", null]);
  });
  it("a trailing 'if' beats a leading one for the same action", () => {
    expect(effectGates("If you control a Dragon, draw a card if you control an Elf.", ["draw"]).gates).toEqual(["you control an Elf"]);
  });
  it("Goblin Barrage / Strength of Night: a kicked spell is the card's own casting, an unknown gate (like 'was spent'), on the extra effect only", () => {
    const barrage = viaGrammar(GOBLIN_BARRAGE).tags;
    expect(byKind(barrage, "damage").map((a) => a.gate?.text)).toEqual([undefined, "this spell was kicked"]);
    expect(byKind(barrage, "damage")[1]!.gate!.kind).toBe("unknown");
    const night = viaModel(STRENGTH_OF_NIGHT, [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Kicker {B}" } as never] }, { id: 2, abilityType: "spell", actions: [act("modify-pt", "Creatures you control", { amount: "+1/+1" }), act("modify-pt", "Zombie creatures you control", { amount: "+2/+2" })] }]);
    expect(night.abilities.filter((a) => a.effect.kind === "pump").map((a) => a.gate?.text)).toEqual([undefined, "this spell was kicked"]);
  });
  it("a trigger's INTERVENING if is the trigger path's, never a second gate (Historian of Zhalfir, Pest Rescuer's trigger)", () => {
    for (const c of [HISTORIAN, PEST_RESCUER]) expect(viaGrammar(c).tags.abilities.every((a) => a.gate === undefined), c.name).toBe(true);
  });
  it("'If you do' and a replacement 'If you would ... instead' are no gate (Excavating Anurid, Pest Rescuer, Fasting)", () => {
    for (const c of [EXCAVATING_ANURID, PEST_RESCUER]) expect(viaGrammar(c).tags.abilities.every((a) => a.gate === undefined), c.name).toBe(true);
    expect(effectGates("You may sacrifice a land. If you do, draw a card.", ["sacrifice", "draw"])).toEqual({ gates: [null, null], refused: false });
    expect(effectGates("If you would gain life, you gain that much life plus 1 instead.", ["gain-life"])).toEqual({ gates: [null], refused: false });
    expect(effectGates("If a source would deal damage to you, prevent that damage.", ["prevent"])).toEqual({ gates: [null], refused: false });
  });
  it("Agrus Kos (model): the condition is on the TARGET ('it', after 'choose ... target creature'); derive gates the exile on it, the matcher judges that a targeting restriction", () => {
    const tags = viaModel(AGRUS_KOS, [
      { id: 1, abilityType: "none", actions: [{ verb: "none", object: "Double strike, vigilance" } as never] },
      { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "Agrus Kos", control: "you" }, actions: [act("exile", "target creature", { toZone: "exile", optional: true })] },
      { id: 3, abilityType: "triggered", trigger: { event: "attacks", subject: "Agrus Kos", control: "you" }, actions: [act("exile", "target creature", { toZone: "exile", optional: true })] },
    ]);
    expect(tags.abilities.filter((a) => a.gate !== undefined).map((a) => a.gate)).toEqual(Array(3).fill({ kind: "unknown", text: "it's suspected" }));
  });
});
