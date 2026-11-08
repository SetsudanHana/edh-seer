import { expect, test } from "vitest";
import { chosenKindOf, chosenKindOfText } from "./chosen-kind.js";
import type { Ability, SubjectFilter } from "../schema.js";

// #1568: WHAT was chosen. Real oracle text (corpus 2026-11-07, `cards.oracleText`).
const T = {
  kindredDiscovery: "As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.",
  cloudKey: "As this artifact enters, choose artifact, creature, enchantment, instant, or sorcery.\nSpells you cast of the chosen type cost {1} less to cast.",
  gatheringStone: "As this artifact enters, choose a creature type.\nSpells you cast of the chosen type cost {1} less to cast.",
  stenn: "As Stenn enters, choose a card type other than creature or land.\nSpells you cast of the chosen type cost {1} less to cast.",
  extinctionEvent: "Choose odd or even. Exile each creature with mana value of the chosen quality.",
  shimmer: "As this enchantment enters, choose a land type.\nEach land of the chosen type has phasing.",
  rootsOfLife: "As this enchantment enters, choose Island or Swamp.\nWhenever a land of the chosen type an opponent controls becomes tapped, you gain 1 life.",
  pennant: "As this artifact enters, choose Elemental, Elf, Faerie, Giant, Goblin, Kithkin, Merfolk, or Treefolk.\nWhenever a permanent you control of the chosen type enters, you gain 1 life.",
  sarpadian: "As this artifact enters, choose white Citizen, blue Camarid, black Thrull, red Goblin, or green Saproling.\n{3}, {T}: Create a 1/1 creature token of the chosen color and type.",
  leori: "Whenever Leori deals combat damage to a player, choose a planeswalker type. Until end of turn, whenever you activate an ability of a planeswalker of that type, copy that ability.",
  creeping: "Choose a permanent type. Return all cards of the chosen type from your graveyard to your hand.",
  winding: "Choose creature or land. Reveal the top four cards of your library. Put all cards of the chosen type revealed this way into your hand and the rest into your graveyard.",
  seasonOfGathering: "Choose up to five {P} worth of modes. You may choose the same mode more than once.\n{P}{P} — Choose artifact or enchantment. Destroy all permanents of the chosen type.",
  riptide: "As this artifact enters, choose a color and a creature type.\n{4}, {T}: Create an X/X creature token of the chosen color and type, where X is the number of charge counters on this artifact.",
  storageMatrix: "As long as this artifact is untapped, each player chooses artifact, creature, or land during their untap step. That player can untap only permanents of the chosen type this step.",
  calloused: "You may choose not to untap this creature during your untap step.\nAs this creature enters, an opponent chooses a creature type.\n{T}: Gain control of target creature that isn't of the chosen type for as long as this creature remains tapped.",
};

test("a text's choice is classified by what it says is chosen", () => {
  expect(chosenKindOfText(T.kindredDiscovery)).toBe("creature-type");
  expect(chosenKindOfText(T.gatheringStone)).toBe("creature-type");
  expect(chosenKindOfText(T.riptide)).toBe("creature-type");
  expect(chosenKindOfText(T.calloused)).toBe("creature-type");
  expect(chosenKindOfText(T.pennant)).toBe("creature-type");
  expect(chosenKindOfText(T.sarpadian)).toBe("creature-type");
  expect(chosenKindOfText(T.cloudKey)).toBe("card-type");
  expect(chosenKindOfText(T.stenn)).toBe("card-type");
  expect(chosenKindOfText(T.creeping)).toBe("card-type");
  expect(chosenKindOfText(T.winding)).toBe("card-type");
  expect(chosenKindOfText(T.seasonOfGathering)).toBe("card-type");
  expect(chosenKindOfText(T.storageMatrix)).toBe("card-type");
  expect(chosenKindOfText(T.extinctionEvent)).toBe("parity");
  expect(chosenKindOfText(T.shimmer)).toBe("land-type");
  expect(chosenKindOfText(T.rootsOfLife)).toBe("land-type");
  expect(chosenKindOfText(T.leori)).toBe("planeswalker-type");
});

test("a text that makes no choice, or two different ones, has no kind", () => {
  expect(chosenKindOfText("Creatures you control get +1/+1.")).toBeUndefined();
  expect(chosenKindOfText("As this enters, choose a creature type.\nAt the beginning of your upkeep, choose a card type.")).toBeUndefined();
});

const subject = (s: Partial<SubjectFilter>): SubjectFilter => ({ control: "any", token: null, ...s }) as SubjectFilter;
const ability = (clause: number, s: SubjectFilter): Ability => ({ kind: "static", clause, effect: { kind: "pump", subject: s } } as unknown as Ability);

test("chosenKindOf stamps chosenKind beside chosenType, from the ability's own clause first and the card's text after", () => {
  const [kd] = chosenKindOf([ability(2, subject({ type: "creature", chosenType: true }))], { 1: "As this enchantment enters, choose a creature type.", 2: "Whenever a creature you control of the chosen type enters or attacks, draw a card." }, T.kindredDiscovery);
  expect(kd!.effect.subject).toMatchObject({ chosenType: true, chosenKind: "creature-type" });
  const [ck] = chosenKindOf([ability(2, subject({ type: "spell", chosenType: true }))], { 1: "As this artifact enters, choose artifact, creature, enchantment, instant, or sorcery.", 2: "Spells you cast of the chosen type cost {1} less to cast." }, T.cloudKey);
  expect(ck!.effect.subject).toMatchObject({ chosenType: true, chosenKind: "card-type" });
});

test("two choices on one card: each ability takes the kind of the clause that holds it", () => {
  const both = "As this enters, choose a creature type.\nAt the beginning of your upkeep, choose a card type. Spells of the chosen type cost {1} less.";
  const [a] = chosenKindOf([ability(2, subject({ type: "spell", chosenType: true }))], { 1: "As this enters, choose a creature type.", 2: "At the beginning of your upkeep, choose a card type. Spells of the chosen type cost {1} less." }, both);
  expect(a!.effect.subject!.chosenKind).toBe("card-type");
  const [u] = chosenKindOf([ability(3, subject({ type: "spell", chosenType: true }))], { 3: "Spells of the chosen type cost {1} less." }, both);
  expect(u!.effect.subject!.chosenKind).toBeUndefined();
});

test("a nested chosenType (an exception: 'creatures that aren't of the chosen type') is stamped too, and an ability with no chosenType is returned as it was", () => {
  const plain = ability(1, subject({ type: "creature" }));
  const [x, p] = chosenKindOf([ability(1, subject({ type: "creature", except: [{ chosenType: true }] } as never)), plain], undefined, "Choose a creature type. Destroy all creatures that aren't of the chosen type.");
  expect((x!.effect.subject!.except as SubjectFilter[])[0]).toMatchObject({ chosenType: true, chosenKind: "creature-type" });
  expect(p).toBe(plain);
});
