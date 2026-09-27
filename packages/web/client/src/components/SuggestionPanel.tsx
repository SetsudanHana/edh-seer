import type { MouseEvent } from "react";
import { Link } from "react-router";
import type { SuggestedCard } from "@edh-seer/matcher/suggest-static";
import { cardImageUrl } from "./card-node.js";

/** Reasons shown before the rest fold away. */
const REASONS = 3;

/** A SUGGESTED CARD IN THE DRAWER (owner, 2026-09-27: "in whole report we open cards in the dock and
 *  on the page with suggestions we open the /cards page"). A suggestion is not in the deck, so the
 *  inspector has no node for it; this says what the report knows instead: why it was suggested,
 *  the slot it can take, the deck cards it works with, and the way to its own page.
 *
 *  ONLY THE ADD'S OWN COUNT. A cut's "works with only 4" counts the links that keep working, the
 *  add's "works with 42" counts every link, and side by side they read as one measure (see
 *  `SwapLine`), so the cut is named, not counted. */
export function SuggestionPanel({ card, replaces, onClose }: {
  card: SuggestedCard;
  /** The cut whose slot it can take, when it came from a swap. */
  replaces?: string;
  onClose: () => void;
}) {
  const src = card.art ? cardImageUrl(card.art) : null;
  const counts = card.fills ? `Counts as ${card.fills.toLowerCase()}`
    : card.answers?.length ? `Answers ${card.answers.map((x) => `${x}s`).join(" and ")}` : null;
  return (
    <div data-testid="suggestion-drawer"
      className="absolute inset-y-2 right-2 left-2 sm:left-auto sm:w-72 sm:max-w-[85vw] overflow-y-auto rounded-(--radius) border border-(--separator) bg-(--surface) p-3 text-sm flex flex-col gap-3">
      <button type="button" onClick={onClose} className="eyebrow self-end text-(--muted)">close</button>
      {src ? <img src={src} alt="" width={488} height={680} className="block aspect-[488/680] h-auto w-full max-w-60 self-center rounded-[4.5%/3.3%] shadow-md shadow-black/40" /> : null}
      <div>
        <h3 className="text-base font-medium">{card.name}</h3>
        <p className="text-xs text-(--muted)">Not in your deck{counts ? ` · ${counts}` : ""}</p>
      </div>
      <div className="flex flex-col gap-1.5 rounded-(--radius) border border-(--accent) p-2.5">
        <span className="eyebrow text-(--accent)">Suggested for this deck</span>
        {replaces ? <p>Can take <b>{replaces}</b>&rsquo;s slot.</p> : null}
        {/* A STAPLE IS SUGGESTED FOR ITS JOB, not its links: "works with 0 of your cards" under Fellwar
          *  Stone read as a reason not to play it (Party Time, 2026-09-27). */}
        {card.connections.length > 0
          ? <p className="text-(--muted)">Works with <span className="tabular-nums">{card.connections.length}</span> of your cards{card.alsoPlan ? ", and fits your plan" : ""}.</p>
          : counts ? <p className="text-(--muted)">Suggested for its job: {counts.charAt(0).toLowerCase() + counts.slice(1)}.</p> : null}
        {card.route ? (
          <p className="text-(--muted)">{card.route.from.length} of your cards {card.route.from.length === 1 ? "reaches" : "reach"} {card.route.to} through it.</p>
        ) : null}
        <ul className="flex flex-col gap-1 text-xs">
          {card.reasons.slice(0, REASONS).map((r) => (
            <li key={r.text}>{r.text}{r.others.length ? <span className="text-(--muted)"> (and {r.others.length} more of your cards)</span> : null}</li>
          ))}
        </ul>
        {card.reasons.length > REASONS ? <p className="text-xs text-(--muted)">…and {card.reasons.length - REASONS} more reasons.</p> : null}
      </div>
      {card.oracle ? (
        <details>
          <summary className="eyebrow text-(--muted) cursor-pointer">card text</summary>
          <p className="mt-1 whitespace-pre-line text-(--muted) text-xs">{card.oracle}</p>
        </details>
      ) : null}
      <Link to={`/cards/${card.slug}`} className="min-h-9 rounded-(--radius) border border-(--separator) px-3 text-center leading-9 hover:border-(--accent) hover:text-(--accent)">
        Open its card page ↗
      </Link>
    </div>
  );
}

/** THE CLICK RULE FOR A SUGGESTED CARD: where a peek exists (a card page) it peeks, as every card
 *  there does; in the report a plain click opens the drawer, like every other card on the page; a
 *  click with a modifier, or outside both, follows the link. */
export function openSuggestedCard(
  drawer: { live: boolean; openSuggestion: (card: SuggestedCard, replaces?: string) => void },
  peekFirst: (ev: MouseEvent<HTMLElement>) => boolean,
  card: SuggestedCard, ev: MouseEvent<HTMLElement>, replaces?: string,
): void {
  if (peekFirst(ev)) return;
  if (!drawer.live || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
  ev.preventDefault();
  drawer.openSuggestion(card, replaces);
}
