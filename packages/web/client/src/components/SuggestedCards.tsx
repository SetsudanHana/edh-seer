import { useState } from "react";
import { Link } from "react-router";
import type { SuggestedCard } from "@edh-seer/matcher/suggest-static";
import { cardImageUrl } from "./card-node.js";
import { peekOnPlainClick, usePeek } from "./peek.js";

/** "enchantments and artifacts" -- the platform's own list joining, British style. */
const LIST = new Intl.ListFormat("en-GB", { type: "conjunction" });

/** Cards shown before "Show all": a finding asks for "~3" or "~2", and four is a row at every width
 *  from a phone's two columns up (appeal review 2026-09-26). */
export const CARD_CAP = 4;

/** THE CARD, THEN ONE LINE OF WHY (appeal review 2026-09-26). Each row used to print the card's
 *  name, "connects to N of your cards: …", two engine sentences behind "and N more", and the card
 *  text behind another fold -- 22 screens of it on a Krenko deck, and every seat stopped reading.
 *  A player knows a card by its face; what it counts as and its best link are the two facts that
 *  decide it. The card itself, its text and every link are one tap away in the peek. */
function Candidate({ c }: { c: SuggestedCard }) {
  const peek = usePeek();
  const src = c.art ? cardImageUrl(c.art) : null;
  const counts = c.fills ? `Counts as ${c.fills.toLowerCase()}`
    : c.answers?.length ? `Answers ${LIST.format(c.answers.map((x) => `${x}s`))}` : null;
  const why = c.route
    ? `${c.route.from.length} of your cards ${c.route.from.length === 1 ? "reaches" : "reach"} ${c.route.to} through it.`
    : c.reasons[0]?.text;
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <Link
        to={`/cards/${c.slug}`}
        onClick={(ev) => { peekOnPlainClick(peek, c.slug, ev); }}
        aria-label={c.name}
        className="block rounded-[4.5%/3.3%] transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)"
      >
        {src
          ? <img src={src} alt="" loading="lazy" decoding="async" width={488} height={680} className="block aspect-[488/680] h-auto w-full rounded-[4.5%/3.3%] shadow-md shadow-black/40" />
          : <span className="flex aspect-[488/680] w-full items-end rounded-[6%/4.4%] border border-(--separator) bg-(--surface-secondary) p-2 text-xs leading-tight">{c.name}</span>}
      </Link>
      <span className="text-sm font-semibold leading-tight">{c.name.split(" // ")[0]}</span>
      {counts ? <span className="text-xs font-medium">{counts}</span> : null}
      {c.alsoPlan ? <span className="text-xs text-(--muted)">Also fits your plan</span> : null}
      {why ? <span className="line-clamp-3 text-xs text-(--muted)" title={why}>{why}</span> : null}
      {/* THE WHOLE ROUTE stays checkable (spec 2026-09-25): one engine sentence per hop, folded. */}
      {c.route?.chain.length ? (
        <details className="text-xs text-(--muted)">
          <summary className="cursor-pointer min-h-6">How</summary>
          <ol className="flex list-decimal flex-col gap-1 pl-4 pt-1 [overflow-wrap:anywhere]">
            {c.route.chain.map((h, i) => <li key={`${i}-${h.tag}`}>{h.text}</li>)}
          </ol>
        </details>
      ) : null}
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
  return <CandidateGrid cards={cards} empty={empty} label={label} />;
}

function CandidateGrid({ cards, empty, label }: { cards: readonly SuggestedCard[]; empty: string; label?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? cards : cards.slice(0, CARD_CAP);
  return (
    <div className="flex flex-col gap-2 min-w-0">
      {label ? <p className="eyebrow text-(--muted)">{label}</p> : null}
      {cards.length === 0
        ? <p className="text-sm text-(--muted) max-w-[70ch]">{empty}</p>
        : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,11rem))]" aria-label={label}>
            {shown.map((c) => <Candidate key={c.name} c={c} />)}
          </ul>
        )}
      {cards.length > CARD_CAP ? (
        <button type="button" className="min-h-11 self-start rounded-(--radius) border border-(--separator) px-4 text-sm" onClick={() => setAll(!all)}>
          {all ? "Show fewer" : `Show all ${cards.length}`}
        </button>
      ) : null}
    </div>
  );
}

/** "STRENGTHEN WHAT WORKS" (spec §3, amended 2026-09-25): the cards that grow the deck's own plan,
 *  in two parts. Routes lead because a bridge the deck lacks is the larger news -- it joins cards
 *  that already sit in the deck -- then the cards that connect to the plan directly. A part with no
 *  rows is not drawn; both empty is one sentence. */
export function StrengthenLists({ routes, plan }: {
  routes: readonly SuggestedCard[] | undefined;
  plan: readonly SuggestedCard[] | undefined;
}) {
  if (routes === undefined || plan === undefined) return <SuggestedCards cards={undefined} empty="" />;
  if (routes.length === 0 && plan.length === 0) {
    return <p className="text-sm text-(--muted) max-w-[70ch]">Nothing outside the deck connects to two or more of its cards.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {routes.length > 0 ? <SuggestedCards cards={routes} empty="" label="Opens a route" /> : null}
      {plan.length > 0 ? <SuggestedCards cards={plan} empty="" label="Connects to your plan" /> : null}
    </div>
  );
}
