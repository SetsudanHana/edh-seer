import { Link } from "react-router";

/** A URL THAT NAMES NO PAGE, AND THE PAGE CANNOT SAY WHICH KIND OF NOTHING IT IS.
 *
 *  The artifact holds the cards that produced at least one event. A slug missing from it is either a
 *  real card with nothing to say -- Sol Ring, whose mana ability is neither an emit nor a trigger --
 *  or a name that is wrong. Separating them would need the whole 34,000-card corpus in the browser.
 *  So it names both and asserts neither.
 *
 *  THE SEARCH IS SEEDED WITH WHAT WAS ASKED FOR, hyphens back to spaces: a truncated or misremembered
 *  name is the likelier of the two cases, and `slugOf` folds the query straight back, so "krenko mob"
 *  finds `krenko-mob-boss`.
 *
 *  IT OWNS THE VIEWPORT IT IS IN. A small block pinned under the header with a screen of nothing
 *  below it reads as a page that failed to load rather than as a considered answer. */
export function NotFound({ slug, kind }: { slug: string; kind: "card" | "commander" }) {
  const typed = slug.replace(/-/g, " ");
  const to = kind === "commander" ? "/commanders" : "/cards";
  return (
    <section className="min-h-[60svh] flex flex-col justify-center gap-6 max-w-[60ch]">
      <div className="flex flex-col gap-3">
        <p className="eyebrow text-(--muted)">no such page</p>
        <h2 className="text-4xl sm:text-5xl font-bold tracking-[-0.02em] break-words">“{typed}”</h2>
      </div>
      <p className="text-(--muted)">
        Either that name is wrong, or the engine found nothing to say about the card
        {kind === "commander" ? " — a commander page exists only for a legendary creature" : ""}
        {kind === "commander" ? " whose oracle text produces an event some other card can answer." : ": a page exists only where the oracle text produces an event some other card can answer. A card that just adds mana, or draws you a card, forms no edges and gets no page."}
      </p>
      <p>
        <Link
          className="inline-flex items-center gap-2 rounded-(--radius) border border-(--accent) px-4 py-2 text-(--accent) hover:bg-(--surface)"
          to={`${to}?q=${encodeURIComponent(typed)}`}
        >
          Search for “{typed}”
          <span aria-hidden="true">→</span>
        </Link>
      </p>
      <p className="text-(--muted) text-sm">
        If you know this card and expected edges from it,{" "}
        <a className="text-(--accent) hover:underline" href="https://github.com/SetsudanHana/edh-seer/issues/new"
          target="_blank" rel="noopener noreferrer">open an issue</a>{" "}
        with the card name — a card read badly is a fixable bug rather than an opinion.
      </p>
    </section>
  );
}
