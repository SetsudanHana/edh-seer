import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import type { AnalyzeResponse } from "../types.js";
import { scoreState } from "../lib/deck-gauge.js";
import { TONE_TEXT } from "./Dial.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { findings } from "../lib/findings.js";
import { usePinned } from "./card-drawer.js";
import { SurfaceLink } from "./ReportShell.js";
import { identityKey } from "../lib/color-identity.js";

/** THE REPORT'S SUMMARY, ON EVERY SURFACE — sticky above the chapters AND above the graph, the
 *  cards table and the combo list.
 *
 *  It resolves a split the sub-tabs left standing: `HeadlineScores` lived inside the Engine tab and
 *  `CoveragePanel` sat above the tab strip, so the two numbers that qualify everything else were
 *  each reachable from one place only. In one scrolling report there is no "above the tabs" left to
 *  put them in, and a reader 4,000px down had nothing on screen saying what the deck scored or how
 *  much of it the engine read.
 *
 *  NOT THE DIALS THEMSELVES, and that is a deliberate deviation from the journey doc's sketch.
 *  `Dial` draws a 100x56 arc over a 4xl numeral over a tone word; two of those plus the coverage
 *  strip measured ~150px of an 844px phone viewport, permanently, on every surface — a summary that
 *  costs a fifth of the screen it summarises. The readouts below carry the same three facts per
 *  score (name, value, tone) from the same `scoreState`, in one line. The full dials, their input
 *  bullets and their explanations are chapter 2's, which is where a reader who wants them goes.
 *
 *  IT MEASURES ITSELF INTO `--report-header-h`. Everything sticky below has to clear it, and the
 *  previous attempt at that in this app is the live bug R2: `CardList` parked its table header at a
 *  hardcoded `top-[33px]` "offset by the tab strip", the strip's real height depended on type
 *  metrics and the viewport, and the top row scrolled underneath it on a phone. A measured variable
 *  cannot be off by a re-tuned constant. */
export function ReportHeader({ data }: { data: AnalyzeResponse }) {
  const ref = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const write = (): void =>
      document.documentElement.style.setProperty("--report-header-h", `${Math.round(el.getBoundingClientRect().height)}px`);
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--report-header-h");
    };
  }, []);

  const { report } = data;
  const coverage = report.coverage;
  // THE SAME PARTLY-READ RULE `HeadlineScores` AND `DeckGauges` APPLY, read from the same field:
  // the presence of `coverage` IS the signal, because the engine only computes it for a deck it
  // could not fully read. No second threshold is invented here.
  const partial = coverage !== undefined;
  // THE COMMANDER'S NAME OFF THE RATED ROWS, the same read `ReportView` already makes for the
  // coverage panel's "your commander is one of them" line. A two-faced commander rates one row per
  // face, so dedupe on the physical card exactly as that read does.
  const commanders = [...new Set(report.cards.filter((c) => c.isCommander).map((c) => c.cardName ?? c.name))];
  // WHAT THE READER CAME FOR, ONE PRESS AWAY FROM ANYWHERE (roadmap S15, owner call 2026-09-02).
  // Both expert judges of the scrolling report went straight to the diagnosis -- one assembled the
  // deck's whole plan out of chapter 6 rather than chapter 3 -- and chapter 6 is ~7,000px down a
  // 9.6-screen page. The narrative order survives for a first-time reader, who is who it was
  // ordered for; the returning tuner stops paying for it. `findings` is pure and cheap, and
  // `Findings` calls it too, so the count here and the list there cannot disagree.
  const findingCount = findings(report).length;
  const { pinned, clearPins } = usePinned();
  const pipCost = identityKey(data.commanderColorIdentity ?? [])
    .split("")
    .map((c) => `{${c}}`)
    .join("");
  return (
    <header
      ref={ref}
      // A LANDMARK, DELIBERATELY. A `<header>` nested inside `<main>` is NOT a banner -- it exposes
      // as generic, so a screen-reader user had no way to reach the two scores and the coverage
      // figure that qualify the whole report. `region` plus a name gives it one.
      role="region"
      aria-label="Deck summary"
      className="sticky top-0 z-20 -mx-1 px-1 bg-(--background) border-b border-(--separator) py-2"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
        {commanders.length > 0 ? (
          <span className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold truncate max-w-[18ch] sm:max-w-[32ch]">
              {commanders.join(" & ")}
            </span>
            {pipCost ? <ManaSymbols cost={pipCost} /> : null}
          </span>
        ) : null}
        {report.synergyOverall !== undefined ? (
          <HeaderScore name="Synergy" value={report.synergyOverall} partial={partial} />
        ) : null}
        {report.buildScore !== undefined ? (
          // `buildScore` counts roles off printed text, which an unread card still has, so it keeps
          // its band where synergy loses its own. The split is the gate's, not a new one.
          <HeaderScore name="Build" value={report.buildScore} />
        ) : null}
        {/* THE PINNED SET SAYS HOW BIG IT IS (roadmap S8), in the one bar on screen in all six
          *  chapters. A set the reader builds up over a 3,000px scroll is otherwise invisible.
          *
          *  ABSENT AT ZERO: a mark that is always present marks nothing -- the rule the coverage
          *  gate and the bracket pips already follow.
          *
          *  IT TRAVELS TO /cards RATHER THAN SCROLLING, because the Cards table is a separate
          *  SURFACE and not a chapter anchor -- and it is the one place a pinned card is lit AND
          *  named. `SurfaceLink` is what keeps the deck in the URL across that navigation; a plain
          *  link drops it, which is a measured defect one component over. No second roster is built
          *  here: S15 fought this header down to 73px and a list of names would grow it unbounded. */}
        {pinned.size > 0 ? (
          <span className="flex items-center gap-1.5">
            <SurfaceLink to="/cards" className="eyebrow text-(--accent) hover:underline underline-offset-2">
              {pinned.size} pinned
            </SurfaceLink>
            <button
              type="button"
              aria-label="Clear pinned cards"
              onClick={clearPins}
              className="eyebrow text-(--muted) hover:text-(--accent) min-h-[24px] px-1"
            >
              clear
            </button>
          </span>
        ) : null}
        {findingCount > 0 ? (
          <button
            type="button"
            // FROM A REFERENCE SURFACE IT HAS TO TRAVEL FIRST. `#fix` does not exist on `/cards`,
            // so the chapters are routed to and the scroll happens on the next frame, once the
            // section it names is in the document.
            onClick={() => {
              // ONE FRAME IS NOT ENOUGH, measured on the live page: the navigation returns, the
              // next frame runs before React has committed the chapters, `getElementById` is null
              // and the reader lands at the top of the report having pressed "2 findings". So it
              // waits for the section to EXIST, capped at ~30 frames so a route that never mounts
              // one cannot spin.
              const go = (tries = 0): void => {
                const el = document.getElementById("fix");
                if (el) return el.scrollIntoView({ behavior: "smooth", block: "start" });
                if (tries < 30) requestAnimationFrame(() => go(tries + 1));
              };
              if (pathname === "/") return go();
              navigate({ pathname: "/", hash: window.location.hash });
              go();
            }}
            /* 32px on the block axis, not 44. The 44px recommendation is for a PRIMARY action;
             * this is a shortcut to something the rail also reaches, and at 44 it forced its own
             * line in the pinned bar -- 85px of header plus a 58px rail is 143px of an 844px phone
             * viewport, on a bar a judge already called too expensive at 117. Comfortably over the
             * 24px WCAG 2.5.8 floor, and the horizontal padding gives it real width. */
            className="eyebrow text-(--accent) whitespace-nowrap min-h-[32px] px-2 -mx-1"
          >
            {findingCount} {findingCount === 1 ? "finding" : "findings"} &darr;
          </button>
        ) : null}
        {coverage ? (
          <span className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true" className="block h-1.5 w-16 rounded-full bg-(--surface-tertiary) overflow-hidden">
              <span
                className="block h-full rounded-full bg-(--fill)"
                style={{ width: `${Math.round((coverage.resolved > 0 ? coverage.derived / coverage.resolved : 0) * 100)}%` }}
              />
            </span>
            {/* The chapter-1 panel carries the caveat, the names and the hatch legend. This is the
              *  figure alone, so a reader deep in the cards table still knows which denominator
              *  every synergy number on this report was computed over. */}
            <span className="text-xs text-(--muted) stat-num whitespace-nowrap">
              {coverage.derived} of {coverage.resolved} read
            </span>
          </span>
        ) : null}
      </div>
    </header>
  );
}

/** One score, one line: the name, the number and the word `scoreState` gives it. The tone colour is
 *  `Dial`'s own `TONE_TEXT` map rather than a second table, so the header and the dial two screens
 *  down cannot come to disagree about what 3.4 is called. */
function HeaderScore({ name, value, partial }: { name: string; value: number; partial?: boolean }) {
  const reading = scoreState(value, partial);
  return (
    <span className="flex items-baseline gap-1.5 whitespace-nowrap">
      <span className="eyebrow text-(--muted)">{name}</span>
      {/* THE SCALE IS PART OF THE NUMBER. A phone judge followed these two figures down fourteen
        *  screens and said "nothing I can reach tells me what scale 3.3 and 5.0 are on … I would
        *  just ignore both numbers" -- and the one place that says so, `HeadlineScores`' own
        *  `/5`, is a chapter away and off screen for most of the report. Two characters, no new
        *  claim: the bound is the same one the dial and the tile already print. */}
      <span className="text-base font-semibold stat-num leading-none">
        {value.toFixed(1)}<span className="text-(--muted) text-xs font-normal">/5</span>
      </span>
      <span data-tone={reading.tone} className={`text-xs ${TONE_TEXT[reading.tone]}`}>{reading.label}</span>
    </span>
  );
}
