import { useEffect, useRef, useState } from "react";
import type { DeckReport } from "../types.js";
import { themeMatrix } from "../lib/theme-matrix.js";
import { CardName } from "./card-drawer.js";

/** How many rows show before the rest fold away. The matrix's JOB is the pattern at the top -- the
 *  cards carrying several mechanisms at once -- and 57 rows of it is a chapter that scrolls past
 *  everything under it. The fold is a disclosure and never a cap: every row is one click away and
 *  the count says how many. */
const VISIBLE_ROWS = 18;

/** WHICH CARDS CARRY WHICH OF THIS DECK'S MECHANISMS (roadmap S6, chapter 3).
 *
 *  A MATRIX AND NOT A TREEMAP, measured rather than argued: the review deck's six groups claim 152
 *  memberships across 82 nonland cards. A treemap places each card in exactly one cell, so it would
 *  drop 70 of those memberships silently. The overlap IS the finding -- eleven cards sit in five of
 *  the six groups, and those are the cards the deck is actually built on.
 *
 *  AND THE CARDS IN NO GROUP ARE NAMED. 25 of 82 on that deck talk to nothing the engine can see,
 *  which is the region a cut conversation starts from -- so it is a list of names and not a
 *  number. It is also the region most limited by coverage: an unread card cannot join a group, so
 *  the hatch and this list overlap on purpose. */
export function ThemeMatrix({ archetypes, nonlandNames }: {
  archetypes: DeckReport["archetypes"];
  nonlandNames: readonly string[];
}) {
  const [expanded, setExpanded] = useState(false);
  /** WHETHER THE TABLE IS ACTUALLY CUT OFF, measured rather than assumed. A fade painted over a
   *  table that fits is a cue for scrolling that is not there -- the same lie as no cue at all,
   *  pointing the other way -- so it is driven by the real overflow and re-checked on resize. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expanded]);
  const m = themeMatrix(archetypes, nonlandNames);
  if (!m) return null;
  const shown = expanded ? m.rows : m.rows.slice(0, VISIBLE_ROWS);
  const hidden = m.rows.length - shown.length;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <h3 className="eyebrow">What each card is doing</h3>
      <p className="text-sm text-(--muted) max-w-[60ch]">
        {m.rows.length} of {m.rows.length + m.unaffiliated.length} cards carry at least one of this
        deck&rsquo;s mechanisms, and most carry more than one — which is why this is a grid and not a
        pie: a card would have to be assigned to exactly one slice, and{" "}
        {m.rows.reduce((s, r) => s + r.count, 0)} memberships do not fit in {m.rows.length} cells.
      </p>

      {/* THE TABLE SCROLLS SIDEWAYS INSIDE ITS OWN REGION AND SAYS SO. `components.md`: a hidden
        *  overflow needs a visible cue, and an `aria-label` mentioning it serves screen readers
        *  while sighted users simply lose the columns. Six columns plus a name fit 390px today;
        *  this is the guard for a deck the engine finds more mechanisms in. */}
      {/* CAPPED, because a row read across 1,400px is not read. The table sized to `min-w-full`
        *  and at 1440 the six columns spread to the far edge, leaving a card's name and its own
        *  dots a screen apart -- the tracking problem a matrix exists to avoid. Natural width
        *  inside a cap: columns sit against the names, and the scroller below still catches a deck
        *  the engine finds more mechanisms in. */}
      {/* A HIDDEN OVERFLOW NEEDS A VISIBLE CUE (`components.md` rule 7): an `aria-label` mentioning
        *  it serves screen readers only, and sighted users simply lose the columns. At 390px the
        *  table is 662px inside a 334px region, so five of six columns are off the edge with
        *  nothing on screen saying so. The fade is the cue, and it appears only when there is
        *  really something past it. */}
      <div className="relative">
        <div ref={scrollerRef} className="overflow-x-auto -mx-1 px-1 max-w-[44rem]">
        <table className="text-sm border-collapse w-auto">
          <thead>
            <tr>
              <th className="text-left font-normal text-(--muted) pb-2 pr-3 sticky left-0 bg-(--background)">card</th>
              {m.columns.map((c) => (
                <th key={c.category} className="pb-2 px-1 align-bottom" title={c.label}>
                  {/* THE LABEL IS ALREADY PROSE (`ArchetypeGroup.label`: "Draw Engine", "Graveyard
                    *  Matters"), so nothing here reaches for a raw tag. It is set narrow and
                    *  wrapping rather than rotated: rotated headers are unreadable on a phone and
                    *  a screen reader gets no help from the transform. */}
                  <span className="block w-[4.5rem] text-xs leading-tight text-(--muted) text-left">
                    {c.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.name} data-testid="matrix-row" className="border-t border-(--separator)">
                <th scope="row" className="text-left font-normal py-1 pr-3 sticky left-0 bg-(--background) whitespace-nowrap">
                  <CardName name={r.name} />
                </th>
                {/* `relative` ON THE CELL IS LOAD-BEARING. The `sr-only` span inside is absolutely
                  *  positioned; with no positioned ancestor it resolves against the INITIAL
                  *  CONTAINING BLOCK, and inside a horizontal scroller it lands outside the
                  *  viewport and inflates `document.documentElement.scrollWidth`. Measured at 390px
                  *  before the fix: the page reported 657 against a 390 client width -- the whole
                  *  report scrolling sideways while everything visible sat inside it. The exact
                  *  defect `components.md`'s narrow-width defences name, and it hides from
                  *  screenshots. */}
                {r.member.map((isMember, i) => (
                  <td key={m.columns[i]!.category} className="relative py-1 px-1 text-center">
                    {/* THE DOT IS NEVER THE ONLY CARRIER. Every cell states its own membership to a
                      *  screen reader, because a grid of coloured dots read as "blank blank blank"
                      *  is the exact colour-only failure this repo keeps fixing. */}
                    <span
                      data-testid={isMember ? "matrix-dot" : undefined}
                      className={isMember ? "inline-block w-2 h-2 rounded-full bg-(--fill)" : ""}
                      aria-hidden={!isMember}
                    />
                    <span className="sr-only">
                      {isMember ? `in ${m.columns[i]!.label}` : `not in ${m.columns[i]!.label}`}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {clipped ? (
          <>
            <span
              aria-hidden
              data-testid="matrix-edge-fade"
              className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-(--background) to-transparent"
            />
            <span className="sr-only">This table scrolls sideways; more groups are off the edge.</span>
          </>
        ) : null}
      </div>

      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="eyebrow self-start text-(--muted) hover:text-(--accent) py-1"
        >
          show the other {hidden} rows
        </button>
      ) : null}

      {m.unaffiliated.length > 0 ? (
        <details className="text-sm">
          <summary className="cursor-pointer py-1">
            <span className="text-(--warning)">{m.unaffiliated.length} cards are in no group at all</span>
            <span className="text-(--muted)">
              {" "}— nothing the engine can see connects them to the rest
            </span>
          </summary>
          <p className="text-xs text-(--muted) leading-relaxed pt-2 max-w-[60ch]">
            {m.unaffiliated.map((n, i) => (
              <span key={n}>{i > 0 && ", "}<CardName name={n} /></span>
            ))}
            .{" "}
            {/* THE COVERAGE CAVEAT BELONGS HERE MORE THAN ANYWHERE. An unread card cannot join a
              *  group, so it lands in this list for a reason that is about the ENGINE and not about
              *  the deck -- and this is the one list a reader would otherwise act on directly. */}
            An unread card cannot join a group, so anything the engine could not read is here by
            default rather than by evidence.
          </p>
        </details>
      ) : null}
    </div>
  );
}
