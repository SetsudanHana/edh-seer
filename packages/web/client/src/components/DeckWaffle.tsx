import type { DeckReport } from "../types.js";
import { TYPE_ORDER } from "../lib/deck-shape.js";
import { hatchImage } from "../lib/unread.js";
import { TYPE_SEGMENT_HUE } from "./presets.js";
import type { WaffleSquare } from "../lib/waffle.js";

/** WHAT THE DECK IS MADE OF, AND HOW MUCH OF IT THE ENGINE COULD READ, as one picture the reader
 *  can COUNT (roadmap S3, journey chapter 1).
 *
 *  IT REPLACES A STACKED BAR, and the bar's own argument is why. `TypeBar` chose a shared baseline
 *  over a ring because a real deck runs creature 21 against enchantment 19, and 11 degrees of arc
 *  is not readable. A waffle wins the same argument outright: 21 and 19 are two squares apart and
 *  a reader who doubts it can count them. The counts and the legend the bar earned are kept
 *  verbatim below -- they were measured, and nothing here regresses them.
 *
 *  AND IT IS THE ONLY PLACE THE PLAYER IS ASKED TO CHECK THE ENGINE'S WORK. A hatched square is a
 *  card that resolved and carries no derived tags (S1's convention, and the SAME `hatchImage` the
 *  graph paints, because a second pitch would be a second convention); a hollow one never resolved
 *  at all. Those are different failures and only the second is a typo -- which is why
 *  `MissingCards` keeps its NAME list: a hollow square cannot be spell-checked. */

/** The neutral a land square takes. NOT a seventh entry in `TYPE_SEGMENT_HUE`: `primaryType`
 *  returns null for a land on purpose, because lands are ~38% of a Commander deck and would drown
 *  the composition question the six hues exist to answer. */
const LAND_FILL = "var(--surface-tertiary)";

/** A SQUARE SIZES ITSELF FROM ITS COLUMN, never from its row. `block-size: 100%` here resolved
 *  against an indefinite grid row and collapsed to zero: measured in the browser,
 *  `grid-template-rows` came back `39px 39px 0px 0px ...` and 83 of 99 squares had height 0, so a
 *  hundred-card deck painted as two rows. The column track IS definite (1fr of a capped 420px), so
 *  `aspect-ratio` on the item gives every row a real height and the grid stays square at any
 *  width. */
function Square({ sq }: { sq: WaffleSquare }) {
  const fill = sq.state === "unresolved" ? "transparent" : sq.type ? TYPE_SEGMENT_HUE[sq.type]! : LAND_FILL;
  return (
    <span
      data-testid="waffle-square"
      data-state={sq.state}
      data-type={sq.type ?? "land"}
      data-commander={sq.isCommander ? "1" : undefined}
      title={sq.name}
      className={`w-full aspect-square rounded-[2px] ${
        // ONE CARD, ONE CELL, AND THE COMMANDER IS NOT AN EXCEPTION. It shipped as a 2x2 span, and
        // a tuner counting the grid to check the deck's size got 103 for a hundred-card deck: one
        // card holding four cells breaks the exact property the waffle exists to have. A ring says
        // "this one is the commander" without spending a cell to say it. The identity pips it used
        // to carry are already three lines above in the panel's own byline, so they were a third
        // copy of the same fact and are gone with the span.
        sq.isCommander ? "outline outline-2 outline-(--foreground) outline-offset-[-2px] " : ""
      }${
        // A HOLLOW SQUARE IS A DASHED OUTLINE, not a faint fill: "we never found this card" has to
        // read as an absence, and a low-alpha fill reads as a quiet presence.
        sq.state === "unresolved" ? "border border-dashed border-(--danger)" : ""
      }`}
      style={{
        background: fill,
        // The hatch rides ON the fill, so the card's type is still readable underneath it -- an
        // unread card is still a creature, and hiding that would overstate the gap.
        backgroundImage: sq.state === "unread" ? hatchImage("var(--background)") : undefined,
      }}
    />
  );
}

export function DeckWaffle({ squares, slices, lands, mdfc }: {
  squares: readonly WaffleSquare[];
  /** The census counts, unchanged from `TypeBar` -- see the legend note below. */
  slices: readonly { type: string; count: number }[];
  lands?: number;
  mdfc?: number;
}) {
  if (squares.length === 0) return null;
  const byType = new Map(slices.map((s) => [s.type, s.count]));
  const ordered = TYPE_ORDER.flatMap((t) => {
    const count = byType.get(t);
    return count ? [{ type: t, count }] : [];
  });
  const total = ordered.reduce((a, s) => a + s.count, 0);
  const unread = squares.filter((s) => s.state === "unread").length;
  const unresolved = squares.filter((s) => s.state === "unresolved").length;
  const commander = squares.find((s) => s.isCommander);
  // Whether the grid is drawn at all — see the block comment on it below. Everything that keys the
  // grid (the colour swatches, the ringed-commander sentence) is conditional on the same fact.
  const grid = unread + unresolved > 0;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* THE CENSUS LINE, CARRIED OVER FROM `TypeBar` VERBATIM. It is checked data -- the
        *  MDFC reconciliation below is the 2026-08-31 ruling, and its `whitespace-nowrap` is a
        *  measured 390px fix -- so it moved rather than being rewritten. */}
      <p className="flex items-baseline gap-2 flex-wrap">
        <span data-testid="type-total" className="text-2xl font-semibold stat-num text-(--foreground)">
          {total}
        </span>
        <span className="text-sm text-(--muted)">nonland cards</span>
        {lands !== undefined ? (
          <>
            {" · "}
            <span className="stat-num text-(--foreground)">{lands}</span>{" lands"}
            {/* THE OTHER FRAME, NAMED AS THE ONE THE REST OF THE REPORT USES (S16, 2026-09-02).
              *  This line counts FRONT FACES, where a modal DFC is a spell; the mana model counts
              *  it as a land, per the 2026-08-31 ruling. Both are right and the report used to say
              *  "34" here and "38" everywhere after it, with only "(38 with MDFCs)" to bridge them
              *  — a beginner read 34 first and said "if I had gone by the first number I'd have
              *  thought I was two UNDER", and the phone judge said 34 out loud at a table and had
              *  to take it back. The parenthetical says WHOSE number the bigger one is now. */}
              {/* NOT `whitespace-nowrap`, AND IT WAS THE PAGE'S ONLY 390px OVERFLOW. The class fit
                *  when the parenthetical was "(38 with MDFCs)"; S16 grew it to a full clause and the
                *  nowrap made that clause one unbreakable 200px+ run, so the whole report scrolled
                *  sideways on a phone -- `documentElement.scrollWidth` 526 against a 390 client
                *  width, measured on the example deck. Cause 4 in the narrow-width rules: a nowrap
                *  span has no upper bound. Found while verifying S14 at 390. */}
            {mdfc !== undefined && mdfc > 0 ? (
              <>{" "}<span>
                (<span className="stat-num text-(--foreground)">{lands + mdfc}</span> counting MDFC backs,
                which is the figure the mana model uses)
              </span></>
            ) : null}
          </>
        ) : null}
      </p>

      {/* THE GRID IS A COVERAGE MAP, AND IT RENDERS ONLY WHEN THERE IS COVERAGE TO MAP (roadmap
        *  S15, owner call 2026-09-02).
        *
        *  The one thing no bar can do is name WHICH cards the engine failed to read and show that
        *  they cluster by type: a judge counted the hatch (5 creatures, 3 enchantments, 1 artifact,
        *  1 instant) and concluded unprompted that a cut verdict on those enchantments would be the
        *  tool being blind rather than the card being weak. That is the grid earning 465px.
        *
        *  With nothing unread and nothing unresolved there is no hatch and no hollow square, and
        *  the grid is a picture of the seven counts printed in its own legend three lines below --
        *  measured at 646px for the panel, ahead of every verdict on the page, on the ~99%-derived
        *  decks that are the common case. The CENSUS survives in full: the line above and the
        *  legend below both stay, which is where those numbers were readable anyway.
        *
        *  ONE ROW PER TEN when it does render, so the grid reads as a deck of about a hundred and a
        *  reader counting rows is counting tens. `auto-fill` with a minimum instead of a fixed ten
        *  would make the row length a function of the viewport, and then the picture means
        *  something different on every screen. */}
      {grid ? (
      <div
        data-testid="waffle-grid"
        className="grid gap-[3px] w-full max-w-[420px]"
        style={{ gridTemplateColumns: "repeat(10, minmax(0, 1fr))" }}
        role="img"
        aria-label={
          `${squares.length} cards: ` +
          ordered.map((s) => `${s.count} ${s.type}`).join(", ") +
          (lands !== undefined ? `, ${lands} lands` : "") +
          (unread > 0 ? `. ${unread} the engine could not read` : "") +
          (unresolved > 0 ? `. ${unresolved} not found at all` : "")
        }
      >
        {squares.map((sq, i) => <Square key={i} sq={sq} />)}
      </div>
      ) : null}

      {/* THE LEGEND NAMES EVERY TYPE, for the reason `TypeBar`'s did: enchantment #1c8db7 and
        *  sorcery #3d7ed6 sit at dE 12.5 in normal vision, so a square's identity must never rest
        *  on hue alone. The two coverage keys join it only when the deck HAS one -- a key for a
        *  state nothing on screen is in explains nothing.
        *
        *  AND THE SWATCHES GO WHEN THE GRID DOES (S15). With no grid drawn, a colour chip keys
        *  nothing: it points at squares that are not on the page, which is the same defect as a
        *  key for an absent state one line up. The COUNTS stay -- they are the census, and they
        *  are what a reader was reading anyway -- so this becomes a list of types and numbers. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {ordered.map((s) => (
          <li key={s.type} data-testid={`type-legend-${s.type}`} className="flex items-center gap-1.5">
            {grid ? <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: TYPE_SEGMENT_HUE[s.type] }} /> : null}
            <span className="text-(--muted)">{s.type}</span>
            <span className="stat-num text-(--foreground)">{s.count}</span>
          </li>
        ))}
        {lands !== undefined && lands > 0 ? (
          <li data-testid="type-legend-land" className="flex items-center gap-1.5">
            {grid ? <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0" style={{ background: LAND_FILL }} /> : null}
            <span className="text-(--muted)">land</span>
            <span className="stat-num text-(--foreground)">{lands}</span>
          </li>
        ) : null}
        {unread > 0 ? (
          <li data-testid="waffle-legend-unread" className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0 bg-(--surface-tertiary)"
              style={{ backgroundImage: hatchImage("var(--background)") }}
            />
            <span className="text-(--muted)">not read</span>
            <span className="stat-num text-(--foreground)">{unread}</span>
          </li>
        ) : null}
        {unresolved > 0 ? (
          <li data-testid="waffle-legend-unresolved" className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-[2px] shrink-0 border border-dashed border-(--danger)" />
            <span className="text-(--muted)">not found</span>
            <span className="stat-num text-(--foreground)">{unresolved}</span>
          </li>
        ) : null}
      </ul>
      {/* The ring is only on the grid, so this sentence goes with it. */}
      {commander && grid ? (
        <p className="text-xs text-(--muted)">
          The ringed square is <span className="text-(--foreground)">{commander.name}</span>.
        </p>
      ) : null}
    </div>
  );
}
