import { useRef, useState } from "react";
import { useClipped } from "../lib/use-clipped.js";
import type { DeckReport } from "../types.js";
import { themeMatrix } from "../lib/theme-matrix.js";
import { CardName, usePinned } from "./card-drawer.js";

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
  const { isPinned } = usePinned();
  const [expanded, setExpanded] = useState(false);
  /** WHETHER THE TABLE IS ACTUALLY CUT OFF, measured rather than assumed -- see `useClipped`,
   *  which the chapter rail shares. Re-checked when the row count changes, since expanding can
   *  widen the name column. */
  const scrollerRef = useRef<HTMLDivElement>(null);
  const clipped = useClipped(scrollerRef, [expanded]);
  const m = themeMatrix(archetypes, nonlandNames);
  if (!m) return null;
  const shown = expanded ? m.rows : m.rows.slice(0, VISIBLE_ROWS);
  const hidden = m.rows.length - shown.length;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <h3 className="eyebrow">What each card is doing</h3>
      {/* THE GRID-VERSUS-PIE DEFENCE IS GONE (roadmap T13/T1). It argued the tool's own chart
        *  choice to the reader -- *"which is why this is a grid and not a pie: a card would have to
        *  be assigned to exactly one slice"* -- which the copy review filed as UI apologia: the
        *  reader wants the finding, not the methodology defended inline. The fact that survives is
        *  the one the grid exists for, that a card sits in several themes at once. */}
      <p className="text-sm text-(--muted) max-w-[60ch]">
        {m.rows.length} of {m.rows.length + m.unaffiliated.length} cards fit at least one theme, and
        most fit several — so a card appears in more than one column.
      </p>
      {/* THE SPLIT IS THE HEADLINE, not a footnote to the grid: on the example deck the implied
        *  half is the LARGER one (177 of 295), so a reader taking every dot at face value is
        *  reading a deck twice as connected as it is. Rows rank on the earned count for the same
        *  reason. */}
      {/* ONE ROW PER MARK, NOT ONE WRAPPING PARAGRAPH. As a single flex-wrap line the two swatches
        *  and their clauses reflowed independently, and at 1440 the hollow ring ended the FIRST line
        *  while the 145 it labels began the second -- a key whose mark and number are on different
        *  lines is not a key. Each row is its own flex item now, so a swatch cannot separate from
        *  its own sentence at any width. Seen on screen; no gate catches this. */}
      <div className="text-xs text-(--muted) max-w-[60ch] flex flex-col gap-1">
        <p className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="inline-block shrink-0 w-2 h-2 rounded-full bg-(--muted)" />
          <span>
            {/* PAYOFF AND ENABLER ARE THE TABLE WORDS for this exact split, and the report was
              *  spelling both out as "something the card does". */}
            <span className="stat-num text-(--foreground)">{m.earnedTotal}</span> are payoffs or
            enablers for their theme.
          </span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="inline-block shrink-0 w-2 h-2 rounded-full border border-(--muted)" />
          <span>
            {/* THE HONESTY SURVIVES AND THE ENGINE INTERNALS DO NOT. A reader has to know these
              *  dots are passive -- the implied half is the LARGER one on a real deck -- but not
              *  that "the engine counts every nonland as cast". */}
            <span className="stat-num">{m.impliedTotal}</span> only qualify incidentally — any spell
            counts as cast, any permanent as entering. Payoffs and enablers sort first.
          </span>
        </p>
      </div>

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
            {/* THE SAME RING AS THE CARDS TABLE, and this is the surface that proves the face rule:
              *  these rows are FACE names ("Fable of the Mirror-Breaker") while the waffle's squares
              *  are PHYSICAL ones, so a card pinned on either has to light on both. `isPinned`
              *  resolves before comparing -- the rule lives in one place. */}
            {shown.map((r) => (
              <tr
                key={r.name}
                data-testid="matrix-row"
                data-pinned={isPinned(r.name) ? "1" : undefined}
                className={`border-t border-(--separator) ${
                  isPinned(r.name) ? "outline outline-1 outline-(--accent) outline-offset-[-1px]" : ""
                }`}
              >
                <th scope="row" className="text-left font-normal py-1 pr-3 sticky left-0 bg-(--background) whitespace-nowrap">
                  <CardName name={r.name} />
                  {isPinned(r.name) ? <span className="sr-only">pinned</span> : null}
                </th>
                {/* `relative` ON THE CELL IS LOAD-BEARING. The `sr-only` span inside is absolutely
                  *  positioned; with no positioned ancestor it resolves against the INITIAL
                  *  CONTAINING BLOCK, and inside a horizontal scroller it lands outside the
                  *  viewport and inflates `document.documentElement.scrollWidth`. Measured at 390px
                  *  before the fix: the page reported 657 against a 390 client width -- the whole
                  *  report scrolling sideways while everything visible sat inside it. The exact
                  *  defect `components.md`'s narrow-width defences name, and it hides from
                  *  screenshots. */}
                {r.cells.map((cell, i) => (
                  <td key={m.columns[i]!.category} className="relative py-1 px-1 text-center">
                    {/* TWO MARKS, BECAUSE ONE DOT WAS MAKING TWO DIFFERENT CLAIMS (roadmap S17).
                      *  A FILLED dot is a card that does something the group is about; a HOLLOW
                      *  ring is a card whose supply of the event was synthesised -- it is present
                      *  when the thing happens rather than causing it. Three of four judges called
                      *  this grid SUSPECTED-WRONG and the skeptic said outright *"I believe this
                      *  claim is false"*; it was not false, it was two claims drawn identically.
                      *  Measured on the example deck: 177 of 295 memberships are implied, and
                      *  `Mystic Remora` is implied in all SEVEN of its groups -- it earns a dot by
                      *  BEING an enchantment that enters, which in an enchantments-entering deck
                      *  makes nearly every enchantment a member of nearly every group. That is why
                      *  four different cards rendered four identical rows.
                      *
                      *  SHAPE, NOT COLOUR: fill versus ring survives a colour-blind reader and a
                      *  forced-colours mode, where two tints of the same violet would not.
                      *
                      *  AND `--muted`, NOT `--fill`, MEASURED: the S6 dot was `--fill`, which is
                      *  **2.12:1** against the page ground -- under the 3:1 floor a graphical object
                      *  owes. It went unnoticed while the dot was decoration on top of a row a
                      *  reader could parse anyway; now the mark carries a DISTINCTION, which is the
                      *  S1 hatch failure exactly (measured fine, found by 4 of 10 judges). `--muted`
                      *  is **6.11:1** and stays quiet. Not `--accent` (4.9:1): index.css keeps the
                      *  accent scarce, and 241 accent dots is the large-fill rule S2 recorded. */}
                    <span
                      data-testid={cell ? "matrix-dot" : undefined}
                      data-membership={cell ?? undefined}
                      className={
                        cell === "earned" ? "inline-block w-2 h-2 rounded-full bg-(--muted)"
                          : cell === "implied" ? "inline-block w-2 h-2 rounded-full border border-(--muted)"
                            : ""
                      }
                      aria-hidden={!cell}
                    />
                    {/* THE MARK IS NEVER THE ONLY CARRIER. Every cell states its own membership to a
                      *  screen reader, because a grid of marks read as "blank blank blank" is the
                      *  exact non-text failure this repo keeps fixing -- and the two marks now say
                      *  different things, so the sentence has to as well. */}
                    <span className="sr-only">
                      {cell === "earned" ? `in ${m.columns[i]!.label}`
                        : cell === "implied" ? `in ${m.columns[i]!.label}, by being played rather than by doing anything`
                          : `not in ${m.columns[i]!.label}`}
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

      {/* A ONE-WAY DOOR (roadmap T14). Owner: *"there is option to show more, but there is no option
        *  to go back to show less"*. `setExpanded(true)` could not be undone, and the control then
        *  DISAPPEARED -- `hidden` falls to 0 once every row is out, so the only affordance for
        *  collapsing removed itself. A reader who opened a 60-row grid to check one card was left
        *  scrolling past all sixty for the rest of the session. Same shape `Findings` already ships,
        *  where the toggle reads "Show fewer" on the way back. */}
      {m.rows.length > VISIBLE_ROWS ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="eyebrow self-start text-(--muted) hover:text-(--accent) py-1"
        >
          {expanded ? `show fewer rows` : `show the other ${hidden} rows`}
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
