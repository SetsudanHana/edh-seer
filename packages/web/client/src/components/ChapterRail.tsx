import { useEffect, useRef, useState } from "react";
import { stickyPx } from "../lib/sticky-px.js";
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
 *  Vertical beside the column from `lg`, and BELOW IT A SELECT plus the three reference surfaces —
 *  sticky under the header (`--report-header-h`, measured by `ReportHeader`) rather than at
 *  `top-0`, which would park it behind the header.
 *
 *  IT USED TO BE A HORIZONTAL SCROLLER AND THAT WAS MEASURED WRONG AT 390 (owner-reported,
 *  2026-09-03: *"3 buttons are always visible and you have very small space to scroll the rest
 *  down"*). The scrollport is 326px; the three surfaces, pinned right because they are the only
 *  route to their pages, held 214 of it — 66% — leaving the six chapters a 112px window, about two
 *  labels, scrolled sideways under a finger that was also scrolling the page. So the group that
 *  folds is the one the page itself can reach: the chapters. A select always spells out the
 *  chapter you are in, which the strip could not, and its picker shows all six at once.
 *
 *  AND IT MEASURES ITSELF TOO, for the same reason the header does. As a horizontal strip it is a
 *  SECOND pinned bar, so a chapter anchor that cleared only the header parked its own heading
 *  behind this one: a phone reader landing on chapter 6 saw the title clipped to the word "do?"
 *  and could not tell which chapter they were in. `--report-rail-h` is 0 at `lg`, where the rail
 *  is beside the column and pins nothing. */
/** HOW BIG A SCROLL COUNTS AS A GESTURE, and how far down the rail stops being pinned. Both are
 *  the smallest numbers that behaved on the live page at 390: below 8px a resting thumb toggles the
 *  bar, and 120px is roughly the header plus the rail, so the two arrive and leave together. */
const SCROLL_TWITCH = 8;
const RAIL_PINNED_ABOVE = 120;

export function ChapterRail({ current }: { current: ChapterId | null }) {
  const nav = useRef<HTMLElement>(null);
  // Below `lg` the rail is pinned under the header and anything scrolled to has to clear BOTH.
  // At `lg` it is beside the column, so it costs no vertical space and the variable is 0.
  const stacked = useIsNarrow(1023);
  const go = (id: string): void =>
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  /** AND THE BAR GETS OUT OF THE WAY WHILE YOU READ DOWN (owner-reported, 2026-09-03).
   *
   *  Even as a select the rail is 53px on top of the header's 73 -- 126px, 14.9% of an 844px
   *  phone, spent permanently on chrome while the reader is doing the one thing this page is for.
   *  Scrolling DOWN is the gesture that means "I am reading"; scrolling UP is the one that means
   *  "I want to get somewhere", which is when a table of contents is worth its space.
   *
   *  It slides UNDER the header rather than fading: the header is `z-20` and opaque, this is
   *  `z-10`, so there is nothing to see through and nothing to reflow. `--report-rail-h` is left at
   *  the measured height either way, so a chapter anchor over-reserves by 53px at worst -- a gap,
   *  never a heading clipped behind a bar that came back mid-scroll. */
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!stacked) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    const onScroll = (): void => {
      const y = window.scrollY;
      const dy = y - last;
      // A thumb wobbles. Under the threshold nothing is a gesture and nothing moves.
      if (Math.abs(dy) < SCROLL_TWITCH) return;
      last = y;
      // Near the top the header and the rail are one block, and half of it arriving late reads as
      // a glitch rather than as a bar that got out of the way.
      setHidden(y > RAIL_PINNED_ABOVE && dy > 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [stacked]);
  useEffect(() => {
    const el = nav.current;
    if (!el) return;
    const write = (): void =>
      document.documentElement.style.setProperty(
        "--report-rail-h",
        stacked ? stickyPx(el) : "0px",
      );
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--report-rail-h");
    };
  }, [stacked]);
  /** THE THREE ESCAPE HATCHES, kept apart from the chapters because they are not chapters: they
   *  are surfaces you explore rather than read in order, they LEAVE the scroll, and back brings
   *  you to the offset you left from. They are also the ONLY route to their pages, which is why
   *  they hold their space at every width while the chapters -- reachable by scrolling the page
   *  itself -- are the ones that fold into a control. */
  const surfaces = REFERENCE_SURFACES.map((s) => (
    <SurfaceLink
      key={s.path}
      to={s.path}
      className="eyebrow block whitespace-nowrap py-3 text-(--muted) lg:py-2 lg:pl-3"
    >
      {s.label} <span aria-hidden="true">&#8599;</span>
    </SurfaceLink>
  ));
  return (
    <nav
      ref={nav}
      aria-label="Report chapters"
      data-hidden={hidden ? "true" : undefined}
      // A HIDDEN BAR IS STILL IN THE TAB ORDER, and a keyboard reader whose focus lands on a
      // control parked behind the header has no way to know where it went.
      onFocusCapture={() => setHidden(false)}
      className={`sticky top-[calc(var(--site-header-h,0px)+var(--report-header-h,0px))] z-10 bg-(--background) transition-transform duration-200 ease-out motion-reduce:transition-none lg:top-[calc(var(--site-header-h,0px)+var(--report-header-h,0px)+1.5rem)] lg:bg-transparent lg:self-start ${
        hidden ? "-translate-y-full" : "translate-y-0"
      }`}
    >
      {stacked ? (
        <div className="flex items-center gap-3 border-b border-(--separator) py-1">
          {/* A NATIVE SELECT, NOT A MENU. The platform's own picker is full height, thumb-sized
            *  and already keyboard- and screen-reader-complete; a custom listbox in a 96px slot
            *  would be a worse version of it for thirty lines. `min-w-0` because a select keeps an
            *  intrinsic width and would otherwise size this row (narrow-width cause 1). */}
          <select
            aria-label="Jump to chapter"
            value={current ?? CHAPTERS[0].id}
            onChange={(e) => go(e.target.value)}
            className="eyebrow min-h-[44px] min-w-0 flex-1 rounded border border-(--separator) bg-(--background) px-2 text-(--accent)"
          >
            {CHAPTERS.map((c) => (
              <option key={c.id} value={c.id}>{c.rail}</option>
            ))}
          </select>
          <span className="flex shrink-0 gap-4">{surfaces}</span>
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {CHAPTERS.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                data-chapter={c.id}
                onClick={() => go(c.id)}
                aria-current={current === c.id ? "true" : undefined}
                className={`eyebrow block whitespace-nowrap border-l-2 py-2 pl-3 ${
                  current === c.id
                    ? "text-(--accent) border-(--accent)"
                    : "text-(--muted) border-(--separator)"
                }`}
              >
                {c.rail}
              </button>
            </li>
          ))}
          <li aria-hidden="true" className="my-3 h-px bg-(--separator)" />
          <li className="flex flex-col gap-1">{surfaces}</li>
        </ul>
      )}
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
    // EVERY BAR ABOVE THE CHAPTER, not just the report's own. The site header went sticky on
    // 2026-09-04 and it sits above these two, so a rootMargin counting only the report header
    // reports the chapter that is CURRENTLY UNDERNEATH the site header as the one on screen.
    const header = px("--site-header-h") + px("--report-header-h") + px("--report-rail-h");
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
