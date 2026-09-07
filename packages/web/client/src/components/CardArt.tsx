import { useState } from "react";
import { cardImageUrl } from "./card-node.js";

/** THE CARD ITSELF, WHOLE.
 *
 *  THE FULL CARD AND NEVER THE CROP, which is a licence line rather than a taste one. Showing an art
 *  crop obliges the site to credit the artist, and the corpus has NO artist field -- measured
 *  2026-09-04, 0 of 34,433 cards. The whole card prints that credit itself, bottom-left, which is
 *  the branch spec D2a offers and the only one available here. `cardImageUrl` rewrites Scryfall's
 *  `/art_crop/` path segment to `/normal/`; it is the same function the graph's card mode uses, so
 *  the two cannot drift about which image this product shows.
 *
 *  IT ALSO CARRIES THE ORACLE TEXT, which is why the pages around it stopped printing a second copy.
 *  THAT IS WHY THE SECOND FACE HAS TO BE REACHABLE. A transforming card's back is a different
 *  creature with different rules text, and with the image as the page's only copy of that text, a
 *  card page showing only the front had no way to read half the card (owner, 2026-09-08).
 *
 *  FLIP, NOT BOTH AT ONCE. Two stacked images is less code, and on a phone the rail sits ABOVE the
 *  card's name -- a second image there pushes the whole page down by another card's height before
 *  the reader has seen what the page is about. A flip is the affordance every other Magic tool
 *  already teaches, and it costs one piece of state.
 *
 *  Lazy and async: it is never the reason a page takes longer to become readable, and the aspect
 *  ratio is fixed so nothing below it moves when the picture lands. */
export function CardArt(
  { artCrop, backArtCrop = null, name }:
  { artCrop: string | null; backArtCrop?: string | null; name: string },
) {
  const [back, setBack] = useState(false);
  if (!artCrop) return null;

  // THE FACE NAMES ARE ALREADY IN THE CARD NAME. Scryfall writes a two-faced card as
  // "Front // Back" and `slugOf` folds the same string, so the halves need no field of their own --
  // and the button can say WHICH side it turns to rather than the bare word "flip", which on a page
  // showing one card is a control whose result you have to click to discover.
  const [front, other] = name.split(" // ");
  const showing = back && backArtCrop !== null;
  const facing = showing ? other ?? name : front ?? name;
  // A URL `cardImageUrl` refuses is not an image this app will request -- the same answer it gives
  // for a card Scryfall has no picture of, because a broken frame and a missing one read alike and
  // only one of them is worth reserving space for.
  const src = cardImageUrl(showing ? backArtCrop! : artCrop);
  if (src === null) return null;

  return (
    <div className="flex flex-col gap-2 items-start">
      <img
        src={src}
        alt={`${facing} — the card, including its rules text and artist credit`}
        loading="lazy"
        decoding="async"
        width={488}
        height={680}
        className="w-40 sm:w-56 lg:w-full shrink-0 aspect-[488/680] rounded-[4.75%_/_3.5%] border border-(--separator)"
      />
      {backArtCrop !== null && other !== undefined && (
        // A REAL BUTTON, so Tab reaches it and Space and Enter both work, with `aria-pressed`
        // carrying the state a sighted reader gets from the picture. `min-h-11` is the 44px
        // recommended target, not the 24px floor: this sits under an image on a phone, where the
        // thumb is the only pointer there is.
        <button
          type="button"
          aria-pressed={showing}
          onClick={() => { setBack((b) => !b); }}
          className="inline-flex items-center gap-2 min-h-11 rounded-(--radius) border border-(--separator) px-3 py-1.5 text-sm text-(--muted) hover:border-(--accent) hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" />
          </svg>
          Flip to {showing ? front : other}
        </button>
      )}
    </div>
  );
}
