import { useEffect, useRef, useState } from "react";
import { useClipped } from "../lib/use-clipped.js";
import { CHAPTERS, type ChapterId } from "../lib/chapters.js";
import { useIsNarrow } from "../lib/use-narrow.js";
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
 *  would park it behind the header.
 *
 *  AND IT MEASURES ITSELF TOO, for the same reason the header does. As a horizontal strip it is a
 *  SECOND pinned bar, so a chapter anchor that cleared only the header parked its own heading
 *  behind this one: a phone reader landing on chapter 6 saw the title clipped to the word "do?"
 *  and could not tell which chapter they were in. `--report-rail-h` is 0 at `lg`, where the rail
 *  is beside the column and pins nothing. */
export function ChapterRail({ current }: { current: ChapterId | null }) {
  // Under `lg` the rail is a horizontal scroller, and nine labels do not fit a 390px row -- so it
  // needs the cue every hidden overflow on this site needs, measured the same way the theme
  // matrix's is. A rail whose last chapters are off the edge is a table of contents hiding
  // entries, which is worse than a table of contents that scrolls.
  const scroller = useRef<HTMLUListElement>(null);
  const clipped = useClipped(scroller);
  const nav = useRef<HTMLElement>(null);
  // Below `lg` the rail is pinned under the header and anything scrolled to has to clear BOTH.
  // At `lg` it is beside the column, so it costs no vertical space and the variable is 0.
  const stacked = useIsNarrow(1023);
  /** THE MARKED CHAPTER HAS TO BE ON THE STRIP IT IS MARKED ON. As a horizontal scroller the rail
   *  shows about two labels at 390px, so a reader in chapter 6 saw `READ STAND` with the accent
   *  nowhere on screen -- a position indicator pointing off its own edge, which is worse than none.
   *
   *  The SCROLLER is scrolled, never the element (`scrollIntoView` on a horizontal strip also
   *  scrolls the PAGE vertically, which would fight the reader mid-scroll). Left as a no-op above
   *  `lg`, where the whole column is visible anyway. */
  useEffect(() => {
    const box = scroller.current;
    if (!box || !stacked || !current) return;
    const chip = box.querySelector<HTMLElement>(`[data-chapter="${current}"]`);
    if (chip) box.scrollTo({ left: Math.max(0, chip.offsetLeft - 12), behavior: "smooth" });
  }, [current, stacked]);
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const write = (): void =>
      document.documentElement.style.setProperty(
        "--report-rail-h",
        stacked ? `${Math.round(el.getBoundingClientRect().height)}px` : "0px",
      );
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--report-rail-h");
    };
  }, [stacked]);
  return (
    <nav
      ref={nav}
      aria-label="Report chapters"
      className="relative sticky top-[var(--report-header-h,0px)] z-10 bg-(--background) lg:top-[calc(var(--report-header-h,0px)+1.5rem)] lg:bg-transparent lg:self-start"
    >
      <ul ref={scroller} className="relative flex gap-3 lg:gap-4 overflow-x-auto border-b border-(--separator) py-2 lg:flex-col lg:gap-1 lg:border-b-0 lg:py-0 lg:overflow-visible">
        {CHAPTERS.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              data-chapter={c.id}
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
        {/* PINNED TO THE RIGHT EDGE OF THE STRIP, not queued behind the six chapters.
          *
          *  Measured on a phone: nine labels do not fit a 390px row, so `Cards` and `Combos` sat
          *  off the right edge — and a reader who wants them has to swipe a 58px strip sideways
          *  while the page under it scrolls vertically. A judge given "open the card list" gave up
          *  on it: *"I would risk it once, and if it scrolled the page I would stop."*
          *
          *  The chapters are the ones that can afford to scroll out of the strip, because the page
          *  itself reaches them. These three are the only way to their surfaces, so they are the
          *  ones that stay. `sticky right-0` inside the scroller pins them to the scrollport edge;
          *  above `lg` the rail is a vertical column and this is inert. */}
        <li className="sticky right-0 flex gap-4 bg-(--background) pl-3 lg:static lg:flex-col lg:gap-1 lg:pl-0">
          {/* The chapters passing underneath need an edge to pass under, or the two groups read as
            *  one list that happens to be cut. */}
          <span aria-hidden="true" className="absolute -left-6 inset-y-0 w-6 bg-gradient-to-l from-(--background) to-transparent lg:hidden" />
          {REFERENCE_SURFACES.map((s) => (
            <SurfaceLink
              key={s.path}
              to={s.path}
              className="eyebrow block whitespace-nowrap py-3 text-(--muted) lg:py-2 lg:pl-3"
            >
              {s.label} <span aria-hidden="true">&#8599;</span>
            </SurfaceLink>
          ))}
        </li>
      </ul>
      {clipped ? (
        <>
          <span
            aria-hidden
            data-testid="rail-edge-fade"
            className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-(--background) to-transparent lg:hidden"
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
  // BOTH PINNED BARS, for the same reason the scroll offset counts both: below `lg` the rail is a
  // second bar, and a band that started 58px too high kept crediting the chapter ABOVE the one on
  // screen -- measured on a phone, the rail said `Plan` with `Can the mana deliver it?` filling the
  // viewport. Re-created when the layout crosses `lg`, which is when the rail's own height changes
  // between 58 and 0.
  const stacked = useIsNarrow(1023);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const px = (name: string): number =>
      Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue(name) || "0", 10) || 0;
    const header = px("--report-header-h") + px("--report-rail-h");
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
      { rootMargin: `-${header}px 0px -50% 0px` },
    );
    for (const c of CHAPTERS) {
      const el = document.getElementById(c.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [stacked]);
  return current;
}
