/** #1266 protection.text: "can't be countered" handed to OTHER spells is the fact kind `counter-immunity`, and protection for the PLAYER ("you gain protection from", "You have shroud") is a keyword grant,
 *  not the lifegain or the unread `cant` the stored answer filed it as. Real oracle text, read the way derive-corpus reads a card the grammar completes (clauseSource grammar). */
import { describe, expect, test } from "vitest";
import { deriveCardTags } from "./derive.js";
import { deriveInputOf } from "../derive-input.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import type { Ability } from "../schema.js";
import { counterImmunityOf } from "./cant-kinds.js";

function derive(name: string, typeLine: string, oracleText: string, stored?: unknown[]): Ability[] {
  const card = { name, typeLine, oracleText, keywords: [] as string[] };
  if (stored) return deriveCardTags(deriveInputOf(card as never, "x", name, stored as never, undefined, undefined)).abilities;
  const g = grammarClauseRecords(card as never);
  expect(g.complete, `${name}: the grammar reads it`).toBe(true);
  return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
}
const immune = (abilities: Ability[]) => abilities.filter((a) => a.effect.kind === "counter-immunity");
const shape = (a: Ability) => ({ kind: a.kind, subject: a.effect.subject, ...(a.counterImmunity ? { ci: a.counterImmunity } : {}) });

describe("counter-immunity: a spell class that can't be countered, handed to others (CR 701.6a)", () => {
  test("a static line for a class of spells you control (Rhythm of the Wild, Destiny Spinner's shape)", () => {
    const [a, ...rest] = immune(derive("Rhythm of the Wild", "Enchantment", "Creature spells you control can't be countered.\nNontoken creatures you control have riot. (They enter with your choice of a +1/+1 counter or haste.)"));
    expect(rest).toEqual([]);
    expect(shape(a!)).toMatchObject({ kind: "static", subject: { control: "you", type: "creature" } });
    expect(a!.repeats).toBe("continuous");
  });

  test("symmetric lines count (Peace Talks ruling): Lier, Leyline of Lifeforce, Root Sliver", () => {
    expect(shape(immune(derive("Lier, Disciple of the Drowned", "Legendary Creature — Human Wizard", "Spells can't be countered.\nEach instant and sorcery card in your graveyard has flashback. The flashback cost is equal to that card's mana cost.",
      [{ id: 1, abilityType: "static", actions: [{ verb: "cant", object: "be countered" }] }, { id: 2, abilityType: "static", actions: [{ verb: "grant-ability", object: "flashback with cost equal to that card's mana cost" }] }]))[0]!))
      .toMatchObject({ subject: { control: "any", type: "spell" } });
    expect(shape(immune(derive("Leyline of Lifeforce", "Enchantment", "If this card is in your opening hand, you may begin the game with it on the battlefield.\nCreature spells can't be countered.",
      [{ id: 1, abilityType: "static", actions: [{ verb: "cant", object: "be countered" }] }, { id: 2, abilityType: "static", actions: [{ verb: "cant", object: "be countered" }] }]))[0]!))
      .toMatchObject({ subject: { control: "any", type: "creature" } });
    // the card's own first line is refused; only the Slivers' line derives
    const root = immune(derive("Root Sliver", "Creature — Sliver", "This spell can't be countered.\nSliver spells can't be countered."));
    expect(root).toHaveLength(1);
    expect(root[0]!.effect.subject).toMatchObject({ subtype: "sliver" });
  });

  test("the card's own line is no counter-immunity (owner 2026-11-12): 'This spell', its name", () => {
    expect(immune(derive("Absolute Virtue", "Legendary Creature — Avatar Warrior", "This spell can't be countered.\nFlying\nYou have protection from each of your opponents. (You can't be dealt damage, enchanted, or targeted by anything controlled by your opponents.)"))).toEqual([]);
    expect(immune(derive("Kevin, Questing Dragon", "Legendary Creature — Dragon", "Kevin can't be countered, devour 2\nFlying, mountainwalk, rampage 2, bushido 2, trample over planeswalkers\nDamage can't be prevented.\nPlayers can't gain life."))).toEqual([]);
    expect(immune(derive("Nezahal, Primal Tide", "Legendary Creature — Elder Dinosaur", "This spell can't be countered.\nYou have no maximum hand size."))).toEqual([]);
  });

  test("Hexing Squelcher: the own line is refused, 'Spells you control' derives once", () => {
    const abilities = immune(derive("Hexing Squelcher", "Creature — Goblin Sorcerer", "This spell can't be countered.\nWard—Pay 2 life.\nSpells you control can't be countered.\nOther creatures you control have \"Ward—Pay 2 life.\""));
    expect(abilities).toHaveLength(1);
    expect(abilities[0]!.effect.subject).toMatchObject({ control: "you", type: "spell" });
  });

  test("a compound sentence keeps its subject: the cost reduction is another ability (Thryx, Cunning Nightbonder)", () => {
    const thryx = derive("Thryx, the Sudden Storm", "Legendary Creature — Elemental Giant", "Flash (You may cast this spell any time you could cast an instant.)\nFlying\nSpells you cast with mana value 5 or greater cost {1} less to cast and can't be countered.",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flash" }] }, { id: 2, abilityType: "none", actions: [{ verb: "none", object: "Flying" }] },
        { id: 3, abilityType: "static", actions: [{ verb: "cost-modify", object: "Spells you cast with mana value 5 or greater", amount: "-1" }, { verb: "cant", object: "be countered" }] }]);
    expect(immune(thryx)).toHaveLength(1);
    expect(immune(thryx)[0]!.effect.subject).toMatchObject({ control: "you" });
    const nb = derive("Cunning Nightbonder", "Creature — Human Rogue", "Flash\nSpells with flash you cast cost {1} less to cast and can't be countered.",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flash" }] }, { id: 2, abilityType: "static", actions: [{ verb: "cost-modify", object: "Spells with flash you cast", amount: "-1" }, { verb: "cant", object: "be countered" }] }]);
    expect(immune(nb)).toHaveLength(1);
  });

  test("a type list with a subtype (Taigam) and a power narrowing (Spellbreaker Behemoth)", () => {
    expect(immune(derive("Taigam, Ojutai Master", "Legendary Creature — Human Monk", "Instant, sorcery, and Dragon spells you control can't be countered."))).toHaveLength(1);
    const sb = immune(derive("Spellbreaker Behemoth", "Creature — Beast", "This spell can't be countered.\nCreature spells you control with power 5 or greater can't be countered."));
    expect(sb).toHaveLength(1);
    expect(sb[0]!.effect.subject).toMatchObject({ control: "you", type: "creature" });
  });

  test("abilities too (Spider-Punk) and a source narrowing (Autumn's Veil: by blue or black spells)", () => {
    const sp = immune(derive("Spider-Punk", "Legendary Creature — Spider Human Hero", "Riot (This creature enters with your choice of a +1/+1 counter or haste.)\nOther Spiders you control have riot.\nSpells and abilities can't be countered.\nDamage can't be prevented."));
    expect(sp).toHaveLength(1);
    expect(sp[0]!.counterImmunity).toMatchObject({ abilities: true });
    const av = immune(derive("Autumn's Veil", "Instant", "Spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn."));
    expect(av).toHaveLength(1);
    expect(av[0]!.counterImmunity).toMatchObject({ by: { colors: ["B", "U"] } });
    expect(av[0]!.effect.subject).toMatchObject({ control: "you", type: "spell" });
  });

  test("a spell's rider and a one-spell grant: Veil of Summer, Insist, Savage Summoning, Mistrise Village, Overmaster", () => {
    expect(shape(immune(derive("Veil of Summer", "Instant", "Draw a card if an opponent has cast a blue or black spell this turn. Spells you control can't be countered this turn. You and permanents you control gain hexproof from blue and from black until end of turn."))[0]!))
      .toMatchObject({ kind: "on-cast", subject: { control: "you", type: "spell" } });
    expect(immune(derive("Insist", "Sorcery", "The next creature spell you cast this turn can't be countered.\nDraw a card."))[0]!.counterImmunity).toMatchObject({ next: true });
    expect(immune(derive("Overmaster", "Sorcery", "The next instant or sorcery spell you cast this turn can't be countered.\nDraw a card."))[0]!.counterImmunity).toMatchObject({ next: true });
    const mv = immune(derive("Mistrise Village", "Land", "This land enters tapped unless you control a Mountain or a Forest.\n{T}: Add {U}.\n{U}, {T}: The next spell you cast this turn can't be countered."));
    expect(mv).toHaveLength(1);
    expect(mv[0]!.kind).toBe("activated");
    // "That spell" after a sentence about the next creature spell is the same one spell; the card's own line is not read.
    const ss = immune(derive("Savage Summoning", "Instant", "This spell can't be countered.\nThe next creature spell you cast this turn can be cast as though it had flash. That spell can't be countered. That creature enters with an additional +1/+1 counter on it.",
      [{ id: 1, abilityType: "spell", actions: [{ verb: "cant", object: "be countered" }] }, { id: 2, abilityType: "spell", actions: [{ verb: "grant-ability", object: "the next creature spell you cast this turn can be cast as though it had flash" }, { verb: "cant", object: "be countered" }, { verb: "add-counter", object: "+1/+1", amount: "1" }] }]));
    expect(ss).toHaveLength(1);
    expect(ss[0]!.counterImmunity).toMatchObject({ next: true });
  });

  test("a mana-spend rider: 'that spell can't be countered' (Cavern of Souls, Boseiju, Delighted Halfling)", () => {
    const cavern = derive("Cavern of Souls", "Land", "As this land enters, choose a creature type.\n{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a creature spell of the chosen type, and that spell can't be countered.");
    expect(immune(cavern)).toHaveLength(1);
    expect(immune(cavern)[0]!.counterImmunity).toMatchObject({ next: true });
    expect(cavern.some((a) => a.effect.kind === "mana-generation")).toBe(true);
    expect(immune(derive("Boseiju, Who Shelters All", "Legendary Land", "Boseiju enters tapped.\n{T}, Pay 2 life: Add {C}. If that mana is spent on an instant or sorcery spell, that spell can't be countered."))).toHaveLength(1);
    expect(immune(derive("Delighted Halfling", "Creature — Halfling Citizen", "{T}: Add {C}.\n{T}: Add one mana of any color. Spend this mana only to cast a legendary spell, and that spell can't be countered."))).toHaveLength(1);
  });

  test("a target spell (Vexing Shusher) and a loyalty ability (Domri, Anarch of Bolas)", () => {
    const vs = immune(derive("Vexing Shusher", "Creature — Goblin Shaman", "This spell can't be countered.\n{R/G}: Target spell can't be countered."));
    expect(vs).toHaveLength(1);
    expect(vs[0]!.effect.subject).toMatchObject({ scope: "target" });
    const domri = immune(derive("Domri, Anarch of Bolas", "Legendary Planeswalker — Domri", "Creatures you control get +1/+0.\n+1: Add {R} or {G}. Creature spells you cast this turn can't be countered.\n−2: Target creature you control fights target creature you don't control."));
    expect(domri).toHaveLength(1);
    expect(domri[0]!.effect.subject).toMatchObject({ control: "you", type: "creature" });
  });

  test("a condition on the line is not total: left unread rather than read as unconditional", () => {
    expect(immune(derive("Test Card", "Enchantment", "As long as you control a Forest, spells you control can't be countered."))).toEqual([]);
    expect(immune(derive("Test Card", "Enchantment", "Spells you control can't be countered unless you pay {1}."))).toEqual([]);
  });
});

describe("protection for the PLAYER is a keyword grant (#1266)", () => {
  const grants = (abilities: Ability[]) => abilities.filter((a) => a.effect.kind === "keyword-grant");

  test("'you gain protection from ...' is a grant of protection, not lifegain (Seht's Tiger, The One Ring, Teferi's Protection)", () => {
    const tiger = derive("Seht's Tiger", "Creature — Cat", "Flash (You may cast this spell any time you could cast an instant.)\nWhen this creature enters, you gain protection from the color of your choice until end of turn. (You can't be targeted, dealt damage, or enchanted by anything of the chosen color.)",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Flash" }] }, { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "this creature", control: "you" }, actions: [{ verb: "gain-life", object: "protection from the color of your choice until end of turn" }] }]);
    expect(grants(tiger).map((a) => a.grants)).toEqual([["protection"]]);
    expect(grants(tiger)[0]!.grantsSelf).toBeUndefined();
    expect(tiger.some((a) => a.effect.kind === "lifegain")).toBe(false);
    const ring = derive("The One Ring", "Legendary Artifact", "Indestructible\nWhen The One Ring enters, if you cast it, you gain protection from everything until your next turn.",
      [{ id: 1, abilityType: "none", actions: [{ verb: "none", object: "Indestructible" }] }, { id: 2, abilityType: "triggered", trigger: { event: "enters", subject: "The One Ring", control: "you" }, actions: [{ verb: "gain-life", object: "protection from everything until your next turn" }] }]);
    expect(grants(ring).map((a) => a.grants)).toEqual([["protection"]]);
    expect(ring.some((a) => a.effect.kind === "lifegain")).toBe(false);
  });

  test("'You have shroud' that the model filed as `cant | be targeted` is the shroud grant (Solitary Confinement)", () => {
    const sc = derive("Solitary Confinement", "Enchantment", "At the beginning of your upkeep, sacrifice this enchantment unless you discard a card.\nSkip your draw step.\nYou have shroud. (You can't be the target of spells or abilities.)\nPrevent all damage that would be dealt to you.",
      [{ id: 1, abilityType: "triggered", trigger: { event: "upkeep", subject: "you", control: "you" }, actions: [{ verb: "sacrifice", object: "this" }] },
        { id: 2, abilityType: "static", actions: [{ verb: "other", object: "skip your draw step" }] },
        { id: 3, abilityType: "static", actions: [{ verb: "cant", object: "be targeted" }] },
        { id: 4, abilityType: "static", actions: [{ verb: "prevent", object: "all damage that would be dealt to you" }] }]);
    expect(grants(sc).map((a) => a.grants)).toEqual([["shroud"]]);
  });

  test("'You gain hexproof until end of turn' beside a creature grant (Earthshape): a second grant, still no lifegain", () => {
    const e = derive("Earthshape", "Instant", "Earthbend 3. Then each creature you control with power less than or equal to that land's power gains hexproof and indestructible until end of turn. You gain hexproof until end of turn.");
    expect(e.some((a) => a.effect.kind === "lifegain")).toBe(false);
    expect(grants(e).some((a) => a.grants?.includes("hexproof"))).toBe(true);
  });

  test("real life gain is untouched", () => {
    const g = derive("Test Gain", "Instant", "You gain 3 life.", [{ id: 1, abilityType: "spell", actions: [{ verb: "gain-life", object: "3 life" }] }]);
    expect(g.some((a) => a.effect.kind === "lifegain")).toBe(true);
  });
});

describe("the reader is sized for what the rules can say, not only the corpus (#1266)", () => {
  const read = (text: string) => counterImmunityOf("be countered", text, 0);
  test("abilities alone, a nonblue source, a duration, a leading list", () => {
    expect(read("Activated abilities can't be countered.")).toMatchObject({ immunity: { abilities: true } });
    expect(read("Spells you control can't be countered by nonblue spells.")?.immunity).toEqual({ by: { notColors: ["U"] } });
    expect(read("Noncreature spells you control can't be countered until end of turn.")?.who).toBe("noncreature spells you control");
    expect(read("Creature spells you cast can't be countered.")?.who).toBe("creature spells you cast");
  });
  test("refused: the card itself by any word, a condition, an unknown tail, a quoted grant", () => {
    for (const text of [
      "This spell can't be countered.", "This creature can't be countered.", "Kevin can't be countered, devour 2", "Nezahal, Primal Tide can't be countered.",
      "Spells you control can't be countered if you control a Forest.", "As long as you have the city's blessing, spells you control can't be countered.",
      "Spells you control can't be countered unless you pay {2}.", "Spells you control can't be countered by spells your opponents control.",
      "Creatures you control have \"Spells you cast can't be countered.\"", "It can't be countered.",
    ]) expect(read(text), text).toBeUndefined();
  });
  test("the occurrence picks the sentence: the card's own first, the class second (Hexing Squelcher)", () => {
    const text = "This spell can't be countered. Ward—Pay 2 life. Spells you control can't be countered.";
    expect(counterImmunityOf("be countered", text, 0)).toBeUndefined();
    expect(counterImmunityOf("be countered", text, 1)?.who).toBe("spells you control");
  });
  test("a stored object that is another `cant` of the clause is not this kind (Autumn's Veil's targeting ban)", () => {
    expect(counterImmunityOf("be the targets of blue or black spells this turn", "Spells you control can't be countered by blue or black spells this turn, and creatures you control can't be the targets of blue or black spells this turn.", 0)).toBeUndefined();
  });
});
