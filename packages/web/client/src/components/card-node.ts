/** Zoom at which a card's printed text becomes readable: the node's world footprint is 28 units
 *  across (2 * ART_RADIUS), so a 5:7 card is ~39 units tall, and 39 * 6 is ~235 screen px. Below
 *  this the image is smaller than the disc it replaces and buys nothing. */
export const CARD_MODE_Z = 6;

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

/** Flip is picture-only, so this is the only thing it touches. `faceArt` maps a face node id to its
 *  art; a single-faced card has no `face:<id>:1` entry, so a stray flipped id degrades to the front
 *  rather than rendering nothing. */
export function faceArtOf(
  cardId: string,
  cardArt: string | undefined,
  flipped: boolean,
  faceArt: ReadonlyMap<string, string>,
): string | undefined {
  if (!flipped) return cardArt;
  return faceArt.get(`${cardId.replace(/^card:/, "face:")}:1`) ?? cardArt;
}
