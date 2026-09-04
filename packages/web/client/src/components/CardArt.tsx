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
 *
 *  Lazy and async: it is never the reason a page takes longer to become readable, and the aspect
 *  ratio is fixed so nothing below it moves when the picture lands. */
export function CardArt({ artCrop, name }: { artCrop: string | null; name: string }) {
  if (!artCrop) return null;
  return (
    <img
      src={cardImageUrl(artCrop)}
      alt={`${name} — the card, including its rules text and artist credit`}
      loading="lazy"
      decoding="async"
      width={488}
      height={680}
      className="w-40 sm:w-56 shrink-0 aspect-[488/680] rounded-[4.75%_/_3.5%] border border-(--separator)"
    />
  );
}
