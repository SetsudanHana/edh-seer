import { useState } from "react";
import { BUILD_CATEGORY_LABEL } from "../lib/build-category-labels.js";
import type { RunDiff } from "../lib/run-diff.js";

// This line reads inline ("ramp 6 -> 7"), not as a standalone heading, so it wants the shared label
// lower-cased rather than a second copy of the map's words -- verified every entry survives a plain
// `.toLowerCase()` ("Card selection" -> "card selection", "Burn & drain" -> "burn & drain"), which
// is what made keeping a byte-for-byte duplicate of `BUILD_CATEGORY_LABEL` an unforced defect.
const inlineLabel = (category: string): string =>
  (BUILD_CATEGORY_LABEL[category] ?? category).toLowerCase();

/** An explicit sign, because a delta without one is only a smaller number. Exported: the header's
 *  score chips print the same figure, and one formatter is what stops the header and the line under
 *  it from printing the same move two ways. */
export const signed = (from: number, to: number): string =>
  `${to > from ? "+" : ""}${(to - from).toFixed(1)}`;

/** THE FIGURE OUT OF A SNAPSHOT ENTRY, which stores it as `"Board wipes 0/1"` -- the label and the
 *  number together, because `RunSnapshot.findings` is keyed by id and has to be readable on its own.
 *
 *  This line prints the label itself, so without the split the `fixed` and `new` branches read
 *  "new Board wipes Board wipes 0/1" -- observed on the live page, 2026-09-02. The moved branch had
 *  always split; the other two had not, and had simply never been looked at with a finding that
 *  appeared or went away. */
const figure = (entry: string | undefined): string | undefined => entry?.split(" ").pop();

/** A list of card names, capped -- the line is one glance, and a 20-card paste is a new deck being
 *  described rather than an edit being reported. */
function Names({ verb, names }: { verb: string; names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 4);
  const extra = names.length - shown.length;
  return (
    <span>
      {verb} <span className="text-(--foreground)">{shown.join(", ")}</span>
      {extra > 0 ? ` and ${extra} more` : ""}
    </span>
  );
}

/** WHAT YOUR LAST EDIT DID, INSIDE THE STICKY HEADER (roadmap S9).
 *
 *  This is `RunDiffStrip` folded into the header, which is the whole item: the strip sat above the
 *  report and scrolled away, so the one fact a returning tuner opened the page for was the first
 *  thing to leave the screen.
 *
 *  IT DOES NOT CARRY THE SCORES. `ReportHeader` prints a delta beside each number, on the line those
 *  numbers are already on; repeating "3.1 -> 3.4" here would be the same fact twice on one bar.
 *
 *  DELIBERATELY NOT A PER-CARD RATING DIFF. A rating is `score / deckMax`, so adding one strong card
 *  moves every other card's number without anything about those cards changing -- a table of 94
 *  deltas would be mostly renormalisation, presented as if the deck had shifted under the reader.
 *  What survives is what the user can attribute: the cards they changed, the theme, the findings and
 *  the build counts those cards moved.
 *  -> `specs/2026-08-20-report-usability-review.md` §5, `specs/2026-09-02-s9-second-run-design.md`
 *
 *  IT IS DISMISSIBLE, and that is a measured concession rather than a courtesy. A full fold charges
 *  sticky height to every surface at 390px for the whole run, and S15 spent a whole item buying that
 *  height back (the dials were refused from this header at ~150px of an 844px viewport). The state
 *  records WHICH diff was dismissed rather than a boolean, so the next run brings the line back with
 *  no reset call and no effect. */
export function RunDiffLine({ diff }: { diff: RunDiff | null }) {
  const [dismissed, setDismissed] = useState<RunDiff | null>(null);
  if (!diff || dismissed === diff) return null;

  const parts: React.ReactNode[] = [];
  // THE FINDINGS COME FIRST, because they are what the report LEADS with -- and because a finding
  // that is GONE is the strongest thing this line can say about an edit. Ranking makes a fixed
  // finding vanish and promotes everything under it, so without this the surface most changed by a
  // good edit had no memory of it.
  for (const f of (diff.findings ?? []).slice(0, 3)) {
    parts.push(
      <span key={f.id}>
        {f.to === undefined ? (
          <>
            <span className="text-(--success)">fixed</span> {f.label}{" "}
            <span className="stat-num">{figure(f.from)}</span>
          </>
        ) : f.from === undefined ? (
          <><span className="text-(--warning)">new</span> {f.label} <span className="text-(--foreground) stat-num">{figure(f.to)}</span></>
        ) : (
          <>{f.label} <span className="text-(--foreground) stat-num">{figure(f.from)} &rarr; {figure(f.to)}</span></>
        )}
      </span>,
    );
  }
  if (diff.theme) {
    parts.push(
      <span key="theme" className="capitalize">
        theme <span className="text-(--foreground)">{diff.theme.from} &rarr; {diff.theme.to}</span>
      </span>,
    );
  }
  // THE CARDS COME BEFORE THE CATEGORY COUNTS, which is a change from the strip's order and the one
  // ordering claim here that is mine rather than inherited. A category count is a CONSEQUENCE of the
  // edit ("draw 12 -> 14"); the card names ARE the edit. When the tail is cut for a phone, the parts
  // that survive should be the ones the reader can attribute.
  if (diff.added.length > 0) parts.push(<Names key="added" verb={`+${diff.added.length}`} names={diff.added} />);
  if (diff.removed.length > 0) parts.push(<Names key="removed" verb={`−${diff.removed.length}`} names={diff.removed} />);
  for (const c of diff.categories.slice(0, 3)) {
    parts.push(
      <span key={c.category}>
        {inlineLabel(c.category)}{" "}
        <span className="text-(--foreground) stat-num">{c.from} &rarr; {c.to}</span>
      </span>,
    );
  }
  if (parts.length === 0) return null;

  return (
    /* ONE ROW ON A PHONE, WRAPPING FROM `sm` UP -- and the nowrap is what actually bought the height
     * back. Measured at 390px on a real edit: the wrapping version put the eyebrow, the part and the
     * dismiss control on three rows of their own for 63px, and cutting the line from nine parts to
     * one did not move that number at all, because the cost was the WRAP, not the content. */
    <p className="flex flex-nowrap sm:flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-(--muted) pt-1 overflow-hidden sm:overflow-visible">
      <span className="eyebrow shrink-0">Since your edit</span>
      {/* A PHONE GETS THE FIRST TWO, AND THAT IS A MEASURED CAP, not a taste one. The full line ran
        *  to nine parts on a real edit and wrapped to SEVEN rows at 390px: `--report-header-h` read
        *  235px, 28% of an 844px viewport, sticky on every surface -- worse than the ~150px of dials
        *  S15 refused from this same header, and paid before the reader can reach `dismiss`. Cut in
        *  CSS rather than in the loop because the cut is a VIEWPORT fact, and a JS media query here
        *  would be a second source of truth for one Tailwind breakpoint. Nothing is lost above `sm`,
        *  and what a phone keeps is the two most attributable parts (see the ordering above). */}
      {parts.map((p, i) => (
        <span
          key={i}
          /* `min-w-0` and `truncate` are what let the single row SHRINK rather than widen the page:
           * a flex item keeps `min-width:auto` and a long finding name would otherwise set the
           * line's min-content width and take the whole document's horizontal scroll with it -- the
           * first of the narrow-width causes in `components.md`. The ellipsis is the visible cue
           * that something was cut. */
          className={`${i >= 1 ? "hidden sm:flex" : "flex"} items-baseline gap-2 min-w-0`}
        >
          {i > 0 ? <span aria-hidden className="text-(--separator)">&middot;</span> : null}
          <span className="truncate sm:whitespace-normal sm:overflow-visible">{p}</span>
        </span>
      ))}
      <button
        type="button"
        aria-label="Dismiss what changed"
        onClick={() => setDismissed(diff)}
        /* 24px on the block axis: the WCAG 2.5.8 floor, not the 44px recommendation, for the same
         * reason the findings shortcut beside it is 32 -- this dismisses a line the next run brings
         * back, and every pixel here is charged to every surface at 390px. */
        className="sm:ml-auto shrink-0 eyebrow text-(--muted) hover:text-(--accent) min-h-[24px] px-1"
      >
        dismiss
      </button>
    </p>
  );
}
