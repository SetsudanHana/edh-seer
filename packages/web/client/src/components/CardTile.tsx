import { Link } from "react-router";
import { printingImageUrl } from "./card-node.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** ONE CARD AS A TILE: the whole card small, the name, its colour pips, and one line about it.
 *
 *  THE WALL OF TEXT (owner, 2026-09-17). The partner list and the search results were columns of
 *  names and sentences with nothing a reader could scan; a player recognises a card by its picture
 *  before its name. The picture is the FULL CARD and never the art crop -- the corpus has no artist
 *  field and the card prints its own credit (`CardArt`, spec D2a) -- at Scryfall's `small` size,
 *  which is the grid size EDHREC and Archidekt already teach.
 *
 *  A CARD WITH NO PICTURE STILL GETS A TILE: the name on a plain surface in the same frame, so a
 *  grid of thirty never has one hole that reads as a broken image.
 *
 *  THE WHOLE TILE IS THE LINK, so the target is the tile and not a line of text, and a plain click
 *  peeks while every other click navigates (`peekOnPlainClick`, the one click rule). Lazy: a page
 *  can carry sixty of these and none of them is the paint the page waits for. */
export function CardTile({ slug, name, art, identity, to, caption, note }: {
  slug: string;
  name: string;
  /** Scryfall printing id; absent when the card has no image. */
  art?: string;
  /** Colour identity, WUBRG order; empty is colourless. */
  identity?: string[];
  /** Where the tile goes; defaults to the card page. */
  to?: string;
  /** One line under the name -- the payoff, the reason, or the matched facet terms. */
  caption?: string;
  /** A stated limit beside the caption, in the eyebrow voice ("engine did not read what it does"). */
  note?: string;
}) {
  const peek = usePeek();
  const src = art ? printingImageUrl(art) : null;
  // TWO SIZES, THE BROWSER PICKS. `small` is 146px wide; at 1920 a results tile is ~230px and the
  // small file upscaled soft (measured on the first preview). `normal` is 488px, plenty for any
  // tile this grid draws, and a phone at two columns still takes the small one.
  const srcSet = art ? `${printingImageUrl(art, "small")} 146w, ${printingImageUrl(art, "normal")} 488w` : undefined;
  const pips = (identity?.length ?? 0) > 0 ? identity!.map((c) => `{${c}}`).join("") : "{C}";
  return (
    <div className="card-tile flex flex-col gap-1.5 min-w-0">
      <Link
        to={to ?? `/cards/${slug}`}
        onClick={(ev) => { peekOnPlainClick(peek, slug, ev); }}
        // THE LINK IS NAMED BY THE CARD, once. Without it a screen reader hears the image's alt, the
        // name and the pips' label as one run-on name for every tile in the grid.
        aria-label={name}
        className="group flex flex-col gap-1.5 rounded-(--radius) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
      >
        {src !== null ? (
          <img
            src={src}
            srcSet={srcSet}
            sizes="(min-width: 1536px) 14vw, (min-width: 1024px) 17vw, (min-width: 640px) 28vw, 45vw"
            alt={`${name} — the card`}
            loading="lazy"
            decoding="async"
            width={146}
            height={204}
            className="w-full aspect-[488/680] rounded-[4.75%_/_3.5%] border border-(--separator) bg-(--surface-secondary) object-cover transition-transform duration-150 ease-out group-hover:-translate-y-0.5 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
          />
        ) : (
          <div
            role="img"
            aria-label={`${name} — no picture`}
            className="w-full aspect-[488/680] rounded-[4.75%_/_3.5%] border border-(--separator) bg-(--surface-secondary) flex items-center justify-center p-3 text-center text-sm text-(--muted)"
          >
            {name}
          </div>
        )}
        <p className="flex items-baseline gap-x-2 min-w-0">
          <span className="font-semibold leading-tight text-(--foreground) group-hover:text-(--accent) group-hover:underline underline-offset-2 line-clamp-2 min-w-0 [overflow-wrap:anywhere]">{name}</span>
          <span className="text-xs shrink-0 ml-auto"><ManaSymbols cost={pips} /></span>
        </p>
      </Link>
      {caption && <p className="text-(--muted) text-sm leading-snug line-clamp-2">{caption}</p>}
      {note && <p className="eyebrow text-(--muted)">{note}</p>}
    </div>
  );
}
