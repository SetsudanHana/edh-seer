import { Link } from "react-router";
import { slugOf } from "@edh-seer/matcher/slug";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** A CARD'S NAME OR ART AS A LINK THAT PEEKS (#1003). A plain click opens the card panel where the
 *  page has one; a modifier or middle click, or a page with no panel, follows the link -- the rule
 *  `peekOnPlainClick` states, here for the places that drew a bare `<Link>` and left the page (the
 *  precon page's swaps and its decklist). */
export function CardLink({ name, slug = slugOf(name), className, children, label }: {
  name: string; slug?: string; className?: string; children: React.ReactNode; label?: string;
}) {
  const peek = usePeek();
  return (
    <Link to={`/cards/${slug}`} className={className} aria-label={label} data-card={name} data-card-slug={slug}
      onClick={(ev) => { peekOnPlainClick(peek, slug, ev); }}>
      {children}
    </Link>
  );
}
