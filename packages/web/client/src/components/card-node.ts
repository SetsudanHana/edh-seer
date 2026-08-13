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
