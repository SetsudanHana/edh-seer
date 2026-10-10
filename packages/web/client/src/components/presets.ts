/** Hues and labels the report surfaces still read. The graph's paint modes, role legend and flow
 *  palettes lived here until the Graph page was retired (8cdb94de); with no caller they were deleted
 *  (#1172, owner ruling 2026-10-10) rather than kept honest. */

/** Plain-language names for the categories whose engine key is jargon. "Card selection" means
 *  scry/surveil/look-at-the-top-N -- digging without drawing -- while "impulse draw" is the exiled
 *  cards you may cast, usually only this turn (I5, 2026-08-25: the two were one category, and the
 *  selection pattern's own third alternative was the impulse template). "Stack
 *  interaction" is one letter from "stax" while meaning something unrelated. Shown on hover.
 *  "Stax", "tutor" and "ramp" are Magic slang, not English words, so they get entries too.
 *  "Protection", "draw" and "lands" are left untranslated: they already describe themselves
 *  correctly to a non-Magic player. */
const PLAIN: Record<string, string> = {
  cardSelection: "digging",
  impulseDraw: "cast from exile",
  stackInteraction: "counterspells",
  targetedRemoval: "removal",
  boardWipe: "board wipe",
  burn: "burn & drain",
  stax: "taxes & locks",
  tutor: "deck search",
  ramp: "extra mana",
};

export function subcategoryLabel(category: string): string {
  return PLAIN[category] ?? category;
}

/** THE SIX CARD TYPES, IN SEGMENT ORDER, for the deck waffle (`DeckWaffle`, `lib/waffle.ts`).
 *  Chosen for segments that carry colour and an in-place label; the old board palette failed the
 *  categorical validator here (its artifact grey had chroma 0.018).
 *
 *  THE ORDER IS PART OF THE PALETTE. `enchantment` and `sorcery` are both blues at dE 12.5 in
 *  normal vision, below the floor; they pass only because nothing places them adjacent. Sorting
 *  segments by value at runtime would break that silently. Verified all five checks on adjacent
 *  pairs, dark, surface #16111f. */
export const TYPE_SEGMENT_HUE: Record<string, string> = {
  creature: "#277310",
  enchantment: "#1c8db7",
  artifact: "#c05a72",
  instant: "#5b40f6",
  planeswalker: "#b08e1d",
  sorcery: "#3d7ed6",
};
