import { Link } from "react-router";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** A CARD'S NAME OR ART AS A LINK THAT PEEKS (#1003). A plain click opens the card panel where the
 *  page has one; a modifier or middle click, or a page with no panel, follows the link -- the rule
 *  `peekOnPlainClick` states, here for the places that drew a bare `<Link>` and left the page (the
 *  precon page's swaps and its decklist). */
export function CardLink({ slug, className, children, label }: {
  slug: string; className?: string; children: React.ReactNode; label?: string;
}) {
  const peek = usePeek();
  return (
    <Link to={`/cards/${slug}`} className={className} aria-label={label}
      onClick={(ev) => { peekOnPlainClick(peek, slug, ev); }}>
      {children}
    </Link>
  );
}
