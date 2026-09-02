import { useEffect, useRef } from "react";
import type { AnalyzeResponse } from "../types.js";
import { scoreState } from "../lib/deck-gauge.js";
import { TONE_TEXT } from "./Dial.js";
import { ManaSymbols } from "./ManaSymbols.js";
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
        {coverage ? (
          <span className="flex items-center gap-2 min-w-0">
            <span aria-hidden="true" className="block h-1.5 w-16 rounded-full bg-(--surface-tertiary) overflow-hidden">
              <span
                className="block h-full rounded-full bg-(--fill)"
                style={{ width: `${Math.round((coverage.resolved > 0 ? coverage.derived / coverage.resolved : 0) * 100)}%` }}
              />
            </span>
            {/* The chapter-1 panel carries the caveat, the names and the ° legend. This is the
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
