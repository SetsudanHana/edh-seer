import { useState } from "react";
import type { DeckReport } from "../types.js";
import { CardName, useCardDrawer } from "./card-drawer.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { Explain } from "./Explain.js";
import { distinctiveReason, reasonShapes } from "../lib/reason-shape.js";
// ONE RENDERER ACROSS THE SURFACES (roadmap N6): this file printed "0%" where the CLI floored
// the same cell at "1%". A measured zero is a measurement; the floor belongs on the refusal path.
import { policyBand } from "@edh-seer/engine/percent";
import { cardImageUrl } from "./card-node.js";
import { isUnread } from "../lib/unread.js";

type Category =
  | "ramp" | "draw" | "cardSelection" | "impulseDraw" | "targetedRemoval" | "stackInteraction"
  | "boardWipe" | "burn" | "stax" | "protection" | "tutor" | "lands";

// Exported for this file's own filter chips below. GraphView used to reuse these for its
// role-ring zone labels; the graph names roles itself now (presets.ts's ROLE_GROUPS, which groups
// these same categories into the six a deck is read by) -- these are plain internal exports again.
export const CATEGORY_LABELS: Record<Category, string> = {
  ramp: "Ramp", draw: "Draw", cardSelection: "Card selection", impulseDraw: "Impulse draw", targetedRemoval: "Removal",
  stackInteraction: "Stack interaction", boardWipe: "Board wipes", burn: "Burn & drain", stax: "Stax",
  protection: "Protection", tutor: "Tutors", lands: "Lands",
};
export const CATEGORY_ORDER: Category[] = [
  "ramp", "draw", "cardSelection", "impulseDraw", "targetedRemoval", "stackInteraction",
  "boardWipe", "burn", "stax", "protection", "tutor", "lands",
];

/** THE CARD, NOT ITS NAME. `DESIGN.md` bans illustrated MTG-card CHROME — a frame, foil or
 *  parchment WE draw — and the real printed card is not that: it is the object itself, and all
 *  three named craft peers (Scryfall, Archidekt, Moxfield) show it. The deck graph already carries
 *  this exact override for this exact reason, and its three conditions carry over here:
 *
 *  - **Lazy**, so a 100-row table does not open 100 connections on mount.
 *  - **Never load-bearing**: the name is always present as text beside it, so a reader who never
 *    receives an image loses nothing but recognition speed.
 *  - **A failed fetch degrades to the row, not to a hole** — `onError` removes the element, which
 *    is the same rule `art-loader.ts` keeps for the board.
 *
 *  The crop is `object-position: 50% 22%` because a Magic art crop puts its subject high; centring
 *  it lands on the middle of a torso on most cards. */
function Thumb({ art, alt }: { art?: string; alt: string }) {
  if (!art) return null;
  return (
    <img
      src={art}
      alt={alt}
      loading="lazy"
      width={56}
      height={40}
      className="w-10 h-7 sm:w-14 sm:h-10 shrink-0 rounded-[4px] border border-(--separator) object-cover bg-(--surface-secondary)"
      style={{ objectPosition: "50% 22%" }}
      onError={(e) => e.currentTarget.remove()}
    />
  );
}

/** THE GRID — the whole printed card at its own 488:680 ratio, no frame of ours, one hairline so a
 *  dark card still has an edge.
 *
 *  A TOGGLE AND NEVER THE DEFAULT, which is the measured part. At 175px a printed card's own text
 *  is already unreadable and at 107px on a phone only the art survives, so a grid cannot carry the
 *  rank, the cost, the roles and the connection count the tuner's cut decision is actually made
 *  from. It answers "which cards are these" faster than any table and "which one do I cut" slower
 *  than any table, and the panel says so rather than leaving the reader to find out.
 *
 *  ONE DATUM SURVIVES: the connection count, as a corner pill. Not the name — the card prints its
 *  own — so the caption strip exists only because a 107px card's printed name is illegible. */
function GridCard({
  name, art, count, dim, onOpen,
}: { name: string; art?: string; count?: number; dim?: boolean; onOpen: () => void }) {
  return (
    <figure className="relative m-0 rounded-[7px] overflow-hidden border border-(--separator) bg-(--surface-secondary) aspect-[488/680]">
      <button type="button" onClick={onOpen} className="block w-full h-full text-left" aria-label={name}>
        {art ? (
          <img
            src={cardImageUrl(art)}
            alt={name}
            loading="lazy"
            className={`w-full h-full object-cover transition-[opacity,filter] duration-200 ${
              dim ? "opacity-40 saturate-50 hover:opacity-90 hover:saturate-100" : ""}`}
            onError={(e) => e.currentTarget.remove()}
          />
        ) : null}
      </button>
      {count !== undefined ? (
        <span
          // A BARE NUMBER IN A CORNER IS NOT A DATUM. Every persona who reached the grid on
          // 2026-08-27 asked what it counted, because the only legend sat BELOW the grid where
          // nobody scrolled to it. The label travels with the badge now, and the legend moved above.
          title={`${count} other ${count === 1 ? "card connects" : "cards connect"} to ${name}`}
          aria-label={`${count} connected cards`}
          className={`absolute top-1.5 right-1.5 min-w-[22px] h-[22px] px-1.5 grid place-items-center
          rounded-full border stat-num text-[11px] bg-(--background)/80 backdrop-blur-[2px] ${
          dim ? "border-(--separator) text-(--muted)" : "border-(--accent) text-(--accent)"}`}
        >
          {count}
        </span>
      ) : null}
      <figcaption className="absolute inset-x-0 bottom-0 px-2 pt-5 pb-1.5 pointer-events-none
        bg-gradient-to-t from-(--background) to-transparent">
        <span className="block truncate stat-num text-[11px]">{name}</span>
      </figcaption>
    </figure>
  );
}

/** A column header that sorts. Marked with `aria-sort` on the header cell's own button rather than
 *  a caret glyph alone, so the state is available to a reader who cannot see the accent colour. */
function SortButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`eyebrow ${active ? "text-(--accent)" : ""}`}
    >
      {label}
      {/* AN AUTHORED SVG, NEVER A GLYPH — `DESIGN.md`'s own rule, and `↓` rendered at whatever
        *  weight the reader's font chose beside 11px mono caps. `aria-sort` on the button already
        *  carries the state for a reader who cannot see it. */}
      {active ? (
        <svg aria-hidden="true" width="8" height="9" viewBox="0 0 8 9" fill="none" stroke="currentColor"
          strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1 align-middle">
          <path d="M4 .8v7.2M1.2 5.4 4 8.2l2.8-2.8" />
        </svg>
      ) : null}
    </button>
  );
}

/** P(you can cast it) as the interval it is, and the interval is the PLAY POLICY: the low end holds
 *  up two mana before casting an accelerant, the high end spends everything on acceleration.
 *  Collapsed to a single figure when the two ends round the same, so a row never reads "31% - 31%". */
export const castRange = (c: { castable: { low: number; high: number } }): string =>
  policyBand(c.castable.low, c.castable.high);

type SortKey = "synergy" | "name" | "cost";

/** A RATING IS DECK-RELATIVE AND THE TABLE NEVER SAID SO. `synergyRating` is `score / deckMax`, so
 *  half a deck sits under 1.0 BY CONSTRUCTION — 51 of 94 rows on a deck this engine rates 4.1 of 5
 *  — and a card carrying a deck ROLE forms no pairwise edge on purpose (`ROLE_NOT_SYNERGY`), so
 *  Sol Ring reads 0.3 because the engine is deliberately silent about it, not because it is bad.
 *  The trim panel learned both of these twice and now protects and explains; this table was the
 *  same data with none of that language.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F5 */
const SCALE_NOTE =
  "Rated against this deck's best synergy card, so a low number is a comparison and not a verdict — "
  + "lands and cards whose job is a role (ramp, removal, protection) score low by design.";

export function CardList({ cards, artByName, coverage }: {
  cards: DeckReport["cards"];
  /** Card name to Scryfall `art_crop` URL, from the graph nodes the analyze response already
   *  carries. Absent for a card the graph has no node for; every consumer treats that as "no
   *  image", never as an error. */
  artByName?: ReadonlyMap<string, string>;
  /** Present only when the engine could not read the whole deck — the split below is suppressed
   *  entirely when it read everything, so a fully covered paste sees exactly one table. */
  coverage?: DeckReport["coverage"];
}) {
  const [filter, setFilter] = useState<Category | "all">("all");
  const [sort, setSort] = useState<SortKey>("synergy");
  const [query, setQuery] = useState("");
  // TABLE OR GRID. The table is the default and stays the default: it is where the cut decision is
  // made. See `GridCard` for the measurement behind that.
  const [view, setView] = useState<"table" | "grid">("table");
  // A grid card has no text to hang `<CardName>` on, so it opens the same drawer directly. A name
  // the graph does not carry is a no-op there, exactly as it is for `<CardName>`.
  const { open: openCard } = useCardDrawer();
  const present = new Set(cards.flatMap((c) => (c.roles ?? []) as Category[]));
  const categories = CATEGORY_ORDER.filter((c) => present.has(c));
  // ONE MECHANISM, SAID ONCE. Measured on the review deck: 94 rows carry 12 distinct reason
  // sentences and the top one covers 25 of them, so a quarter of the table repeated "X triggers on
  // a wizard entering; Inalla supplies it" with only the names changing — and the rows whose reason
  // was DIFFERENT, which is where the information is, read exactly like the rest.
  const shapes = reasonShapes(cards);
  const names = new Set(cards.map((c) => c.name));
  const needle = query.trim().toLowerCase();
  const byName = (a: DeckReport["cards"][number], b: DeckReport["cards"][number]) => a.name.localeCompare(b.name);
  // A ROW WITH NOTHING TO SAY IS NOT A ROW SAYING ZERO. Measured on `precon-party-time`, 59 of 82
  // rated rows read `0.0` — a column with no variance is not data, and the reader could not tell
  // "we read it and it connects to nothing" from "we never read it". Splitting the table turns the
  // dead column into the report's most useful admission.
  const unread = cards.filter(isUnread);
  const readable = unread.length > 0 ? cards.filter((c) => !isUnread(c)) : cards;
  // ONE PHYSICAL CARD, ONE TILE. A two-faced card rates one row per printed FACE (Task 7,
  // faces-as-nodes) and `derived` is identical on both, so an unread modal DFC produced two rows
  // and this list showed it twice -- and the count above the grid, which sits directly under
  // `coverage.caveat`, then disagreed with the caveat's own figure, since `coverage` counts SLOTS.
  // Review fix, 2026-08-27: the same "2 of the 1 unread" defect the wave fixed in `ReportView` and
  // in `unjudgedCandidates`, in the third file of the family. The FRONT row is what survives, on
  // purpose -- `artByName` and the card drawer are both keyed on `ProjectedNode.label`, which is
  // the FACE name, so the physical name would render a tile with no art and no click.
  const unreadCards = unread.filter(
    (c, i) => c.cardName === undefined || unread.findIndex((o) => (o.cardName ?? o.name) === c.cardName) === i,
  );
  const visible = readable
    .filter((c) => (filter === "all" ? true : (c.roles ?? []).includes(filter)))
    .filter((c) => needle === "" || c.name.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => {
      // Name is the tiebreak everywhere, so a sort is stable to the reader rather than to the
      // engine's iteration order.
      if (sort === "name") return byName(a, b);
      // Expensive first: the question a cost sort answers is "what am I paying the most for".
      if (sort === "cost") return (b.manaValue ?? 0) - (a.manaValue ?? 0) || byName(a, b);
      return (b.synergyRating ?? 0) - (a.synergyRating ?? 0) || byName(a, b);
    });

  const chip = (key: Category | "all", label: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      className={`eyebrow px-2 py-1 rounded-(--radius) border ${
        filter === key ? "border-(--accent) text-(--accent)" : "border-(--separator) text-(--muted)"
      }`}
    >
      {label}
    </button>
  );

  return (
    // THE WHOLE PANEL IS BOUNDED, NOT JUST ITS TABLE. Capping the table alone fixed the rows and
    // broke the header: the filter chips, the "find a card" box and the table/grid toggle live in a
    // `w-full` flex row with `ml-auto`, so at 1920 they stayed pinned to a 1,856px edge while the
    // table they control ended 448px to their left. Controls have to sit inside the thing they
    // control. One cap on the panel keeps every part of it on the same right edge.
    <div className="flex flex-col gap-3 max-w-[88rem]">
      <h3 className="eyebrow">Cards</h3>
      <p className="text-xs text-(--muted) max-w-[65ch]">{SCALE_NOTE}</p>
      {/* THE COST COLUMN'S OWN SCALE. "49% – 69% by T5" was explained in a footnote on a different
        *  tab, so on this one it was two unlabelled numbers. */}
      <Explain label="what the cost figures mean">
        The chance you can actually cast it — mana and colours together — simulated over 2,000
        shuffles. A range, low to high, and the range is how you play: the low end holds up two mana
        before casting an accelerant, the high end spends everything on acceleration and is a ceiling
        no real deck plays to. The turn is the card's own mana value — a 5-drop is priced at turn 5 —
        and a land or an unpriceable cost renders an em dash rather than 0%. No opponent is modelled
        and no cantrips are cast, so a draw-heavy deck reads low.
      </Explain>
      {shapes.shared.length > 0 ? (
        <div className="text-xs text-(--muted) max-w-[65ch] flex flex-col gap-0.5">
          <span>
            Most of this deck connects in{" "}
            {shapes.shared.length === 1 ? "one way" : `${shapes.shared.length} ways`}, said once here
            instead of on every row:
          </span>
          {shapes.shared.map((sh) => (
            <span key={sh.template}>
              <span className="tabular-nums">{sh.count}</span> ×{" "}
              <span className="text-(--foreground)">{sh.sample}</span>
            </span>
          ))}
          <span>A row with a sentence of its own is a card doing something else.</span>
        </div>
      ) : null}
      <div className="flex gap-2 flex-wrap items-center">
        {chip("all", "All")}
        {categories.map((c) => chip(c, CATEGORY_LABELS[c]))}
        {/* 94 unpaginated rows with one hardcoded sort order and no way to find a card by name —
          *  below the bar every deck tool this product is measured against sets. */}
        <input
          type="search"
          aria-label="Filter cards by name"
          placeholder="Find a card…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="ml-auto text-sm rounded-(--radius) border border-(--field-border) bg-(--field-background) px-2 py-1"
        />
        <div className="flex rounded-(--radius) border border-(--separator) overflow-hidden" role="group" aria-label="View">
          {(["table", "grid"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={`eyebrow px-3 py-1 ${view === v ? "bg-(--surface-secondary) text-(--accent)" : "text-(--muted)"}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="text-(--muted) text-sm">No cards match this filter.</p>
      ) : view === "grid" ? (
        <>
          {/* THE LEGEND LEADS THE GRID. It used to close it, and the personas who reached the grid
            *  never got there — a number with no legend is not data. */}
          <p className="text-xs text-(--muted) max-w-[65ch]">
            <span className="inline-grid place-items-center align-middle min-w-[22px] h-[22px] px-1.5 mr-1.5
              rounded-full border border-(--accent) text-(--accent) stat-num text-[11px]">n</span>
            is how many other cards in the deck connect to it.{" "}
            <span className="text-(--foreground)">Grid trades the rank, the roles and the cost for
            recognition</span> — the faster way to answer &ldquo;which cards are these&rdquo;, the
            slower way to answer &ldquo;which one do I cut&rdquo;.
          </p>
          <div className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
            {visible.map((c) => (
              <GridCard
                key={c.name}
                name={c.name}
                art={artByName?.get(c.name)}
                count={c.partnerCount}
                onOpen={() => openCard(c.name)}
              />
            ))}
          </div>
        </>
      ) : (
        // THE TABLE SCROLLS, THE PAGE DOES NOT. Measured in a real browser at 390px: this table
        // pushed `documentElement.scrollWidth` to 810px, so the whole report — gate, tabs, every
        // other panel — slid sideways under the thumb. The phone persona reported it as "the numbers
        // are off the right edge" (2026-08-27) and only a live measurement showed it was the entire
        // page rather than the table.
        // THE SCROLL BOX EXISTS ONLY WHERE THE TABLE OVERFLOWS. `overflow-x: auto` makes this div a
        // scroll container, and a `position: sticky` header inside a scroll container sticks to THAT
        // box rather than the viewport — measured: the header sat 728px above the fold while
        // "stuck". The horizontal scroll was only ever needed at phone widths (the table's
        // `min-w-[46rem]` fits a desktop container), so the container stops existing above `sm` and
        // the sticky header works where a 52-row scan actually happens.
        <div className="overflow-x-auto sm:overflow-x-visible -mx-1 px-1">
        {/* THE CARD COLUMN GREW WITHOUT BOUND AND ITS CONTENT DID NOT. Every other column here is
          *  pinned (`w-10`, `w-56`, `w-32`, `w-20`), so the Card column absorbs the whole slack of a
          *  `w-full` table inside a container that is `xl:max-w-none` -- the viewport. Measured over
          *  all 100 rows of the example deck: the widest row's ink is 837px and the median is 410px,
          *  and that ceiling does not move with the viewport because a card name and a one-line
          *  reason are as long as they are. At 1440 the column is 904px, which is about right. At
          *  1920 it is 1,384px: 547px of empty cell in the WORST row and 974px in the median one,
          *  between a card's reason and its roles, on every row of a 100-row table.
          *
          *  88rem IS DERIVED, NOT PICKED. 837px of ink plus the 472px of pinned columns is 1,309px,
          *  and the cap has to clear the 1,376px this table already gets at 1440 so that no width
          *  which renders fine today starts truncating. 88rem (1,408px) is the smallest round step
          *  above both, so the cap binds ONLY where the runaway is -- nothing at or below 1440
          *  changes by a pixel, and the reason sentence can never truncate in a case where it
          *  currently fits. The cap itself lives on the PANEL (see the root element above) so the
          *  filter chips and the search box share this table's right edge.
          *
          *  The leftover width goes to the page margin rather than into the rows. Dead space outside
          *  a bounded table reads as layout; the same pixels inside every row read as a broken one. */}
        <table className="w-full min-w-[46rem] text-sm border-collapse">
          {/* STICKY, because scanning a 52-row table BY COLUMN is exactly what a tuner does and the
            *  labels used to scroll away — the brief's own sentence, "the precon player did not know
            *  what the last column was". Offset by the tab strip, which is itself sticky at top-0.
            *  The background is opaque or the rows show through as it passes over them.
            *
            *  THE OFFSET IS THE TAB STRIP'S MEASURED HEIGHT (33px in a live browser), not a round
            *  number: at 44px an 11px band of scrolling rows showed between the strip and the
            *  header and read as a rendering glitch. */}
          <thead className="sticky top-[33px] z-[5] bg-(--background)">
            <tr className="border-b border-(--separator)">
              <th className="eyebrow text-left font-normal py-2 pr-2 w-10">#</th>
              <th className="eyebrow text-left font-normal py-2 pr-2">
                <SortButton label="Card" active={sort === "name"} onClick={() => setSort("name")} />
              </th>
              <th className="eyebrow text-left font-normal py-2 pr-2 w-56">Roles</th>
              {/* COST BESIDE THE RATING, NEVER MULTIPLIED INTO IT. What a card does and what it
                *  costs are two facts, and a reader weighing "is this 9-drop worth it" needs both
                *  in view -- the same never-multiply ruling the castability axes already ship. */}
              <th className="eyebrow text-right font-normal py-2 pr-2 w-32">
                <SortButton label="Cost" active={sort === "cost"} onClick={() => setSort("cost")} />
              </th>
              <th className="eyebrow text-right font-normal py-2 w-20">
                <SortButton label="Synergy" active={sort === "synergy"} onClick={() => setSort("synergy")} />
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c, i) => {
              const reason = distinctiveReason(c, shapes.shared, names);
              const roles = (c.roles ?? []) as Category[];
              return (
                <tr key={c.name} className="border-b border-(--separator) align-top">
                  <td className="py-2 pr-2 stat-num text-(--muted)">{String(i + 1).padStart(2, "0")}</td>
                  <td className="py-2 pr-2 min-w-0">
                    <span className="flex items-center gap-3 min-w-0">
                      <Thumb art={artByName?.get(c.name)} alt="" />
                      <span className="flex flex-col min-w-0">
                        <CardName name={c.name} className="block truncate max-w-full" />
                        {reason ? <span className="block text-xs text-(--muted) truncate">{reason}</span> : null}
                      </span>
                    </span>
                  </td>
                  <td className="py-2 pr-2">
                    <span className="flex flex-wrap gap-1">
                      {roles.map((r) => (
                        <span key={r} className="eyebrow px-1.5 py-0.5 rounded-(--radius) border border-(--separator) text-(--muted)">
                          {CATEGORY_LABELS[r]}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {/* An em dash for a land or an unpriced cost -- a refusal must never render as
                      *  0%, which a reader would take as "you cannot cast this". */}
                    <span className="block"><ManaSymbols cost={c.manaCost ?? ""} /></span>
                    {c.castability ? (
                      <span className="block text-xs text-(--muted) stat-num">
                        {castRange(c.castability)} by T{c.castability.turn}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 text-right stat-num text-(--accent)">
                    {c.synergyRating !== undefined ? c.synergyRating.toFixed(1) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
      {/* NOT READ YET — a grid, because this list has NO DATA TO LOSE. It exists purely to be
        *  recognised: every synergy figure on these cards is a structural zero, so a table of them
        *  is five columns of em dashes. Rendered at reduced presence and brightening on hover:
        *  present enough to recognise, quiet enough to read as visibly outside the judged set. */}
      {unread.length > 0 ? (
        <section className="flex flex-col gap-3 mt-6 pt-6 border-t border-(--separator)">
          <div className="flex items-baseline gap-3 flex-wrap">
            <h3 className="text-base font-bold tracking-[-0.01em]">Not read yet</h3>
            <span className="text-xs text-(--muted) stat-num">{unreadCards.length} cards</span>
          </div>
          <p className="text-sm text-(--muted) max-w-[65ch]">
            {coverage?.caveat
              ?? "These resolved fine and count toward the mana, the curve, the land maths and legality. "
                + "They carry no synergy reading, so nothing above speaks for them."}
          </p>
          <div className="grid gap-3 sm:gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))" }}>
            {unreadCards.map((c) => (
              <GridCard key={c.name} name={c.name} art={artByName?.get(c.name)} dim onOpen={() => openCard(c.name)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
