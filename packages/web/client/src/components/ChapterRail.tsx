import { useEffect, useRef, useState } from "react";
import { useClipped } from "../lib/use-clipped.js";
import { CHAPTERS, type ChapterId } from "../lib/chapters.js";
import { REFERENCE_SURFACES, SurfaceLink } from "./ReportShell.js";

/** THE TABLE OF CONTENTS, NOT A SECOND TAB BAR — and the difference is that every chapter is on the
 *  page at once, so a link here moves the reader rather than swapping what exists.
 *
 *  The sub-tab strip it replaces could not say what it was hiding: a reader on Summary had no way
 *  to know a diagnosis sat one tab over, and four personas (2026-08-26) read the report's order as
 *  arbitrary because nothing named the sequence. Six labels in reading order ARE the sequence.
 *
 *  NOT ANCHORS, AND THE HASH IS WHY. `href="#stand"` is the obvious way to write a table of
 *  contents, and it was measured breaking the product on the live page: this app keeps the DECK in
 *  the hash (`#deck=<payload>`, `lib/share.ts`), so one click on a chapter link rewrote the URL to
 *  `/#stand` and the decklist was gone from it — a reload lost the analysis, a Back closed the
 *  report, and the share link in the header no longer carried a deck. Buttons that scroll cost the
 *  no-JavaScript case, which this app does not have (the report only exists after a fetch), and
 *  they cost nothing else.
 *
 *  Vertical beside the column from `lg`, a horizontal scroll strip below it — where it is sticky
 *  under the header (`--report-header-h`, measured by `ReportHeader`) rather than at `top-0`, which
 *  would park it behind the header. */
export function ChapterRail({ current }: { current: ChapterId | null }) {
  // Under `lg` the rail is a horizontal scroller, and nine labels do not fit a 390px row -- so it
  // needs the cue every hidden overflow on this site needs, measured the same way the theme
  // matrix's is. A rail whose last chapters are off the edge is a table of contents hiding
  // entries, which is worse than a table of contents that scrolls.
  const scroller = useRef<HTMLUListElement>(null);
  const clipped = useClipped(scroller);
  return (
    <nav
      aria-label="Report chapters"
      className="relative sticky top-[var(--report-header-h,0px)] z-10 bg-(--background) lg:top-[calc(var(--report-header-h,0px)+1.5rem)] lg:bg-transparent lg:self-start"
    >
      <ul ref={scroller} className="relative flex gap-4 overflow-x-auto border-b border-(--separator) py-2 lg:flex-col lg:gap-1 lg:border-b-0 lg:py-0 lg:overflow-visible">
        {CHAPTERS.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => document.getElementById(c.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              aria-current={current === c.id ? "true" : undefined}
              // 44px on the block axis (WCAG 2.5.8's recommended target, not just its 24px floor)
              // comes from the padding plus the eyebrow's line box; stated here so a later type
              // change cannot quietly shrink it.
              className={`eyebrow block whitespace-nowrap py-3 lg:py-2 lg:border-l-2 lg:pl-3 ${
                current === c.id
                  ? "text-(--accent) lg:border-(--accent)"
                  : "text-(--muted) lg:border-(--separator)"
              }`}
            >
              {c.rail}
            </button>
          </li>
        ))}
        {/* THE THREE ESCAPE HATCHES, kept visually apart from the chapters because they are not
          *  chapters: they are surfaces you explore rather than read in order, they LEAVE the
          *  scroll, and back brings you to the offset you left from. */}
        <li aria-hidden="true" className="hidden lg:block h-px bg-(--separator) my-3" />
        {REFERENCE_SURFACES.map((s) => (
          <li key={s.path}>
            <SurfaceLink
              to={s.path}
              className="eyebrow block whitespace-nowrap py-3 text-(--muted) lg:py-2 lg:pl-3"
            >
              {s.label} <span aria-hidden="true">&#8599;</span>
            </SurfaceLink>
          </li>
        ))}
      </ul>
      {clipped ? (
        <>
          <span
            aria-hidden
            data-testid="rail-edge-fade"
            className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-(--background) to-transparent lg:hidden"
          />
          {/* POSITIONED ANCESTOR REQUIRED. An absolutely positioned `.sr-only` span with none
            *  resolves against the initial containing block; inside a horizontal scroller that
            *  lands outside the viewport and inflates `documentElement.scrollWidth`, which this
            *  app has already paid for once (the mobile scroll bug, 2026-09-02). */}
          <span className="sr-only">This rail scrolls sideways; more chapters are off the edge.</span>
        </>
      ) : null}
    </nav>
  );
}

/** WHICH CHAPTER THE READER IS IN, for the rail's `aria-current`.
 *
 *  One observer over the six sections, with the viewport's top edge pushed down past the sticky
 *  header and its bottom edge pulled up to the halfway line: a chapter counts as current while its
 *  content occupies the top half of what is actually visible. Without the bottom margin every
 *  chapter below the fold on a tall screen intersects at once and the rail lights four links.
 *
 *  The topmost intersecting section wins, in document order, so scrolling never lights a chapter
 *  the reader has already passed.
 *
 *  Falls back to `null` where there is no `IntersectionObserver` (jsdom): no chapter is current,
 *  every link still navigates, and nothing throws. */
export function useCurrentChapter(): ChapterId | null {
  const [current, setCurrent] = useState<ChapterId | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const header = Number.parseInt(
      getComputedStyle(document.documentElement).getPropertyValue("--report-header-h") || "0",
      10,
    );
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = CHAPTERS.find((c) => visible.has(c.id));
        // NO NULL ON A GAP. Between two chapters' observed bands nothing intersects, and clearing
        // the rail there makes it blink on every scroll. The last answer stands until another
        // chapter claims it.
        if (first) setCurrent(first.id);
      },
      { rootMargin: `-${Number.isFinite(header) ? header : 0}px 0px -50% 0px` },
    );
    for (const c of CHAPTERS) {
      const el = document.getElementById(c.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);
  return current;
}
