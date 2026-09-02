import type { DeckReport } from "../types.js";

/** THE PHYSICAL CARDS THE SYNERGY ENGINE COULD NOT READ, as one rule in one place.
 *
 *  `CardSynergy.derived === false` means the card resolved against the corpus and carries no
 *  derived tags: it forms no edge, reaches no theme and no archetype, so every synergy figure
 *  about it is a structural zero rather than a measurement. The rule was written out by hand in
 *  three files before this one existed (`ReportView`'s commander list, `CardList`'s unread grid,
 *  and nothing at all on the two graph surfaces), and a second copy of a claim is how two surfaces
 *  start disagreeing -- which this repo has measured twice already.
 *
 *  KEYED ON THE PHYSICAL CARD (`cardName ?? name`), NOT THE FACE. A multi-face card rates one row
 *  per printed face and both rows carry the same flag, because it is read off the card. The same
 *  key the graph joins on (`WireGraphNode.cardName ?? id`) and the same one `commanderCardNames`
 *  in `GraphView` already uses, so a caller can match a node without a second convention.
 *
 *  ABSENT IS NOT FALSE: the flat engine never sets `derived`, and treating its silence as "unread"
 *  would hatch every mark on every report it produces. */
/** THE RULE ITSELF, for a caller that needs the ROWS rather than the names. `CardList` is the
 *  one: it keeps the FRONT FACE row of an unread multi-face card, not the physical name, because
 *  `artByName` and the card drawer are both keyed on the face name and the physical one would
 *  render a tile with no art and no click. Only the predicate is shared; that dedupe stays its own.
 *
 *  ABSENT IS NOT FALSE — see `unreadCardNames`. */
export const isUnread = (c: DeckReport["cards"][number]): boolean => c.derived === false;

export function unreadCardNames(cards: DeckReport["cards"]): Set<string> {
  return new Set(cards.filter(isUnread).map((c) => c.cardName ?? c.name));
}

/** THE HATCH GEOMETRY, ONE COPY, because the mark is painted twice in two media -- as a CSS
 *  gradient on the graph list's swatch and as canvas strokes on the board's discs -- and a
 *  convention drawn at two pitches is two conventions. Screen pixels: the board divides by the
 *  camera scale so a stripe is the same width at every zoom, which is the only way a reader
 *  learns one mark. */
export const HATCH = { angle: 45, pitch: 8, width: 3 } as const;

/** The CSS half of the mark. `stripe` is a colour the caller owns -- the board reads its own from
 *  the canvas's computed style, so neither side hardcodes a literal from `index.css`. */
export const hatchImage = (stripe: string): string =>
  `repeating-linear-gradient(${HATCH.angle}deg, ${stripe} 0 ${HATCH.width}px, transparent ${HATCH.width}px ${HATCH.pitch}px)`;
