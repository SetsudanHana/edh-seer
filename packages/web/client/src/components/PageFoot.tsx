import { Link, useLocation } from "react-router";

/** A PAGE ENDS ON PURPOSE. Without this the partner list simply stops, and a reader who reaches the
 *  bottom of a long one is left facing the site footer's legal text with nothing to do next.
 *
 *  Two destinations and no more: the next card, and the explanation of how any of this was decided.
 *  A reader who doubts a row wants the second one, and doubt is the reaction this product should
 *  make easy to act on. */
export function PageFoot() {
  // A LINK TO THE PAGE YOU ARE ON IS NOT A WAY OUT. "Search the cards" sat in the foot of the card
  // SEARCH page, pointing at itself.
  const { pathname } = useLocation();
  const links = [
    { to: "/cards", label: "Search the cards" },
    { to: "/commanders", label: "Browse commanders" },
  ].filter((l) => l.to !== pathname);
  return (
    <nav className="border-t border-(--separator) pt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {links.map((l) => (
        <Link key={l.to} className="text-(--accent) hover:underline" to={l.to}>{l.label}</Link>
      ))}
      <a className="text-(--accent) hover:underline" href="/how-it-works">How the engine decides</a>
    </nav>
  );
}
