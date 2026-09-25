import { Link } from "react-router";
import type { SuggestedCard } from "@edh-seer/matcher/suggest-static";
import { ManaSymbols } from "./ManaSymbols.js";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** Reasons shown before the fold; the rest sit behind "and N more" (spec §2). */
const OPEN_REASONS = 2;
/** Deck cards named in the "connects to" line before it says "and N more". */
const NAMED_CONNECTIONS = 3;

/** WHY IT IS HERE, IN THE ENGINE'S OWN WORDS. A route card's reason is the route itself -- "26 of
 *  your cards reach Ghyrson Starn through it" -- because that sentence IS the claim (the Ghyrson
 *  case, owner 2026-08-27); the cards it names sit behind a fold so the row stays one claim long. */
function Row({ c }: { c: SuggestedCard }) {
  const peek = usePeek();
  const pips = c.identity.length > 0 ? c.identity.map((x) => `{${x}}`).join("") : "{C}";
  const named = c.connections.slice(0, NAMED_CONNECTIONS).join(", ");
  const more = c.connections.length - NAMED_CONNECTIONS;
  return (
    <li className="flex flex-col gap-1.5 py-3 border-b border-(--separator) min-w-0">
      <div className="flex items-center gap-3 flex-wrap min-h-11">
        <Link
          to={`/cards/${c.slug}`}
          onClick={(ev) => { peekOnPlainClick(peek, c.slug, ev); }}
          className="font-semibold hover:text-(--accent) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent) rounded-(--radius)"
        >
          {c.name}
        </Link>
        <span className="text-xs"><ManaSymbols cost={pips} /></span>
        {c.alsoPlan ? (
          <span className="eyebrow text-(--muted) border border-(--separator) rounded-full px-2 py-0.5">also fits your plan</span>
        ) : null}
      </div>
      {c.route ? (
        <>
          <p className="text-sm max-w-[70ch]">
            <span className="tabular-nums">{c.route.from.length}</span> of your cards reach {c.route.to} through it.
          </p>
          <details className="text-sm text-(--muted)">
            <summary className="cursor-pointer min-h-6">which cards</summary>
            <p className="pt-1 max-w-[70ch]">{c.route.from.join(", ")}</p>
          </details>
        </>
      ) : (
        <>
          <p className="text-sm text-(--muted) max-w-[70ch] [overflow-wrap:anywhere]">
            connects to <span className="tabular-nums">{c.connections.length}</span> of your cards: {named}
            {more > 0 ? ` and ${more} more` : ""}
          </p>
          {c.reasons.slice(0, OPEN_REASONS).map((r) => <p key={r} className="text-sm max-w-[70ch]">{r}</p>)}
          {c.reasons.length > OPEN_REASONS ? (
            <details className="text-sm">
              <summary className="cursor-pointer text-(--muted) min-h-6">and {c.reasons.length - OPEN_REASONS} more</summary>
              <div className="flex flex-col gap-1.5 pt-1">
                {c.reasons.slice(OPEN_REASONS).map((r) => <p key={r} className="max-w-[70ch]">{r}</p>)}
              </div>
            </details>
          ) : null}
        </>
      )}
    </li>
  );
}

/** THE CARDS UNDER A FINDING, OR IN "STRENGTHEN WHAT WORKS" (spec §3, AO4). `cards === undefined`
 *  is the wait: the list computes after the report paints, and the wait is said at full strength --
 *  loading is not disabled. An empty list says so rather than padding with staples. */
export function SuggestedCards({ cards, empty, label }: {
  cards: readonly SuggestedCard[] | undefined;
  empty: string;
  /** A `p.eyebrow` over the list ("Cards that fit"); omitted where a heading already names it. */
  label?: string;
}) {
  if (cards === undefined) {
    return (
      <p role="status" className="text-sm text-(--muted) flex items-center gap-2 min-h-11">
        {/* lucide `loader-circle`, drawn inline, never a glyph. */}
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" className="shrink-0 motion-safe:animate-spin">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Finding cards that fit
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1 min-w-0">
      {label ? <p className="eyebrow text-(--muted)">{label}</p> : null}
      {cards.length === 0
        ? <p className="text-sm text-(--muted) max-w-[70ch]">{empty}</p>
        : <ul className="flex flex-col border-t border-(--separator)">{cards.map((c) => <Row key={c.name} c={c} />)}</ul>}
    </div>
  );
}
