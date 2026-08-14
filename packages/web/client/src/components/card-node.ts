/** Zoom at which a card's printed text becomes recognisable: the node's world footprint is 28
 *  units across (2 * ART_RADIUS), so a 5:7 card is ~39 units tall, and 39 * 4 is ~157 screen px.
 *  Recognisable, not readable -- the previous 6 (~235px) made card mode arrive too late when
 *  scrolling. Below this the image is smaller than the disc it replaces and buys nothing. */
export const CARD_MODE_Z = 4;

/** The wheel's zoom ceiling. MUST stay above CARD_MODE_Z: it used to be written as
 *  `CARD_MODE_Z + 2` at the call site, which silently tied the two together -- and before that it
 *  was a flat 5, BELOW the then-threshold of 6, which made card mode unreachable by scrolling and
 *  clamped cam.z straight back under the threshold the moment the wheel moved. The constraint is
 *  MAX_Z > CARD_MODE_Z; the offset is not load-bearing. */
export const MAX_Z = 8;

export type RenderMode = "miniature" | "card";

/** Render is a function of the camera, NOT of a mode enum. The mode control animates cam.z and the
 *  scroll wheel changes it directly -- one input, so the two can never disagree about what is on
 *  screen. */
export function renderModeFor(z: number): RenderMode {
  return z >= CARD_MODE_Z ? "card" : "miniature";
}

/** Scryfall serves every size off one path shape: .../<size>/<face>/<a>/<b>/<id>.jpg. The corpus
 *  stores art_crop, so the full card is a segment rewrite rather than a new field and a re-ingest.
 *  Anchored to a path segment so a URL whose id happens to contain "art_crop" is left alone. */
export function cardImageUrl(artCrop: string): string {
  return artCrop.replace(/\/art_crop\//, "/normal/");
}

/** Zoom at which the card under the cursor is worth fetching AHEAD of card mode.
 *
 *  Card mode's image is a different file from the disc's, so crossing `CARD_MODE_Z` used to START a
 *  fetch — the card you zoomed in to read arrived as a placeholder and filled in afterwards.
 *
 *  The obvious fix (fetch `normal` once and crop it for the disc too) was BUILT AND REJECTED on
 *  measurement, and this is the alternative. Two findings killed it. `normal` is ~1.5x the bytes of
 *  `art_crop` (Sol Ring 71KB vs 44KB, Birds of Paradise 83KB vs 56KB), so a 100-card deck's opening
 *  load goes ~5.0MB -> ~7.5MB to save ~75KB per card actually zoomed into: break-even is ~33 cards
 *  entered in card mode one at a time, against a handful in practice. And a fixed crop box out of
 *  the full card is wrong wherever the art is not the standard full-width panel — rendered against
 *  the true art_crop, a Saga's disc showed its CHAPTER TEXT, and ~507 corpus cards (1.5%) are
 *  side-mounted or rotated (saga 188, split 135, battle 39, class 34, flip 26, leveler 26, case 13).
 *
 *  So the discs keep `art_crop` and only the card being approached pays for its full image. 0.6 of
 *  the threshold is far enough in that the intent is unambiguous — nobody is at 2.4x by accident —
 *  while leaving room to finish the fetch before the card is drawn. Prefetch is per-HOVER, so a
 *  whole-deck view fetches nothing extra however long the pointer wanders. */
export const PREFETCH_Z = CARD_MODE_Z * 0.6;

/** Should the hovered card's full image be fetched now? Zoom only: WHICH card is the caller's
 *  business, and the loader already dedupes repeat requests for the same URL. */
export function shouldPrefetchCard(z: number): boolean {
  return z >= PREFETCH_Z;
}

/** Is this world position inside the canvas right now?
 *
 *  Used to bound which cards get their FULL image warmed while zooming in. Hover alone was not
 *  enough and the reason is mechanical: a wheel zoom need not move the pointer at all, so
 *  `pointermove` may never fire, and when it does it fires at the moment of arrival with no lead
 *  time. Warming everything instead is the ~7.5MB the cropped-disc approach was rejected for
 *  (card-node's PREFETCH_Z comment) — so the set is "what is on screen once the user has clearly
 *  committed to zooming in", which is a couple of dozen cards at most and shrinks as they go
 *  further.
 *
 *  Screen = world * z + pan, the same transform `draw` sets on the context. Generous by one card
 *  radius so a card half-way in still counts: it is the next thing the user will centre. */
export function isOnScreen(
  world: { x: number; y: number },
  cam: { x: number; y: number; z: number },
  dim: { w: number; h: number },
  margin = 0,
): boolean {
  const sx = world.x * cam.z + cam.x;
  const sy = world.y * cam.z + cam.y;
  return sx >= -margin && sx <= dim.w + margin && sy >= -margin && sy <= dim.h + margin;
}
