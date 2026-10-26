import { expect, test } from "vitest";
import { isRestrictionSentence, withoutOncePrefix } from "./restriction.js";

// Every form below is printed on a real card (oracle text from the corpus, 2026-10-26), named beside it.
test("the activation restrictions Oracle prints are riders", () => {
  for (const s of [
    "Activate only as a sorcery.", // Greta
    "Activate only as a sorcery and only once each turn.", // DOT-7 Repair Squad
    "Activate only if you've cast a noncreature spell this turn.", // Doctor Strange
    "Activate only if you control seven or more differently named lands.", // Seven of Nine
    "Activate only once each turn.", // Mindful Biomancer
    "Activate only during your turn.", // Ruthless Waterbender
    "Activate only during your upkeep.", // Eternal Dragon
    "Activate only during your turn, before attackers are declared.", // Hua Tuo
    "Activate only during your turn and only once each turn.", // Vivi Ornitier
    "Activate only as a sorcery and only if you control a Swamp and a Forest.", // shape of Hall of Oracles
    "Activate no more than twice each turn.", // Pit Imp
    "Activate no more than three times each turn.", // Manaforge Cinder
    "Activate only as an instant.", // Rhystic Cave
    "Activate only during combat.", // Najeela
    "Activate only during an opponent's turn, before attackers are declared.", // Nettling Imp
    "Activate only once.", // Duggan
    "Activate this ability only once.", // Riku and Riku
    "Activate only during the declare blockers step, only if you control a creature.", // shape of Grizzled Wolverine
    "Only your opponents may activate this ability and only as a sorcery.", // Detention Vortex
    "Only your opponents may activate this ability and only if you control a Plains.", // Entirely Normal Armchair
    "This ability triggers only once each turn.", // Fang, Fearless l'Cie
    "This ability triggers only once.", // Acrobatic Cheerleader
    "This ability triggers only twice each turn.", // Nadu, Winged Wisdom
    "Do this only once each turn.", // Lucy MacLean
    "You may activate each of those abilities only once each turn.", // The Enigma Jewel
  ]) expect(isRestrictionSentence(s), s).toBe(true);
});

test("a sentence that does something besides restrict is no rider", () => {
  for (const s of [
    "Activate only during your turn and draw a card.",
    "Draw a card. Activate only as a sorcery",
    "Cast this spell only during combat.", // a spell's own restriction: the store records it as a `cant`, so it is not absorbed here
    "Players can cast spells only during their own turns.",
    "Put a +1/+1 counter on target creature.",
    "Activate only as a sorcery and sacrifice this creature.",
    "Only your opponents may activate this ability and draw a card.",
    "Activate only if this card is in your graveyard.", // Loathsome Troll, Carrionette
    "Activate only if ~ is on the battlefield or in your graveyard.", // Skyblade's Boon
    "Activate only as a sorcery and only if this card is exiled.",
  ]) expect(isRestrictionSentence(s), s).toBe(false);
});

test("a permission's once-a-turn prefix is cut, the permission kept", () => {
  expect(withoutOncePrefix("Once during each of your turns, you may play a permanent card you own from outside the game or from your graveyard")).toBe("you may play a permanent card you own from outside the game or from your graveyard");
  expect(withoutOncePrefix("Once each turn, you may cast a spell from the top of your library")).toBe("you may cast a spell from the top of your library");
  expect(withoutOncePrefix("Once during each turn, you may pay {0} rather than pay the mana cost for a spell you cast from exile")).toBe("you may pay {0} rather than pay the mana cost for a spell you cast from exile");
  // Not a permission: left alone.
  expect(withoutOncePrefix("Once each turn, draw a card")).toBe("Once each turn, draw a card");
});
