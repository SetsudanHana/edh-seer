import type { DeckReport } from "../types.js";
import { findings, slotTrade, FINDING_CAP, type Finding } from "../lib/findings.js";
import { useState } from "react";

/** WHAT IS WRONG WITH THIS DECK — the report's focal element, and the one structural change the
 *  2026-08-26 persona reviews asked for.
 *
 *  The Overview used to render fifteen panels at identical weight: a mono eyebrow, a block of
 *  numbers, a muted paragraph, fifteen times. Nothing was dominant, so the eye had no entry point
 *  and the page read as a wall — and the two expert personas used the diagnostic panels and nothing
 *  else, from screen two onward. This puts those panels' conclusions first, ranked, and lets the
 *  panels themselves become the evidence underneath.
 *
 *  THE ORDER IS ARITHMETIC, NOT EDITORIAL. See `lib/findings.ts`: every source already carries its
 *  own target, and the rank is the fraction of that target missing. No weight was chosen.
 *
 *  THE RULE BESIDE EACH HEADLINE IS NEUTRAL, AND THAT IS A CORRECTION. It shipped as
 *  `[danger, warning, muted]` indexed by ROW POSITION, so red meant "first" rather than "critical" —
 *  semantic tokens carrying ordinal meaning, which `DESIGN.md`'s Semantic-vs-Accent Rule reserves
 *  for state and quality. On a well-tuned deck the mildest finding would still have opened blood
 *  red. The list is already labelled "worst first" and each row carries its own figure and a bar
 *  showing how much of its target is met, so MAGNITUDE is stated twice in data; a third statement in
 *  a colour that means position was decoration telling a small lie.
 *
 *  Tone by magnitude was the alternative and is refused for now: it needs a threshold nobody has
 *  measured, and this file's whole claim is that it introduces no constant beyond the row cap.
 */

/** The one number a row is proving, and the bar under it. Right-aligned tabular mono, so a column
 *  of figures reads as a column even when the rows differ in height. */
function Figure({ f }: { f: Finding }) {
  return (
    <div className="flex sm:flex-col items-baseline sm:items-end gap-2 sm:gap-1.5 shrink-0">
      <span className="text-2xl font-semibold stat-num leading-none">{f.figure}</span>
      <span className="eyebrow">{f.figureLabel}</span>
      <span aria-hidden="true" className="hidden sm:block h-1 w-16 rounded-full bg-(--surface-tertiary) overflow-hidden">
        <span className="block h-full bg-(--accent)" style={{ width: `${Math.round(Math.min(1, f.filled) * 100)}%` }} />
      </span>
    </div>
  );
}

export function Findings({ report }: { report: DeckReport }) {
  const all = findings(report);
  // Every shortfall is computed; the cap is what SHOWS. The rest are reachable rather than dropped
  // — a diagnosis that silently truncates is the same failure as one that never ranked.
  const [expanded, setExpanded] = useState(false);
  if (all.length === 0) return null;
  const shown = expanded ? all : all.slice(0, FINDING_CAP);
  const trade = slotTrade(report, all);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-lg font-bold tracking-[-0.01em]">What is wrong with this deck</h2>
        {/* A SENTENCE, SO IT KEEPS INTER. `index.css`'s own comment reserves `.stat-num` for a
          *  figure and says prose keeps Inter; only the count is tabular. */}
        <span className="text-xs text-(--muted)">
          <span className="tabular-nums">{all.length}</span>{" "}
          {all.length === 1 ? "finding" : "findings"}, worst first
        </span>
      </div>
      <ul className="flex flex-col border-t border-(--border)">
        {shown.map((f, i) => (
          <li
            key={f.id}
            className="grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 sm:gap-5 py-5 border-b border-(--separator)"
          >
            <span aria-hidden="true" className="hidden sm:block stat-num text-sm text-(--muted) pt-1.5">{i + 1}</span>
            <div className="flex flex-col gap-2.5 min-w-0 order-2 sm:order-none">
              <h3 className="text-xl sm:text-2xl font-bold leading-tight tracking-[-0.02em] flex gap-3">
                <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full self-stretch bg-(--border)" />
                <span>{f.headline}</span>
              </h3>
              <p className="text-sm text-(--muted) max-w-[62ch] tabular-nums">{f.detail}</p>
              {f.action ? (
                <p className="text-sm flex items-center gap-2">
                  {/* An authored SVG, never a glyph — the design system's own rule. */}
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none"
                    stroke="currentColor" strokeWidth="1.6" className="text-(--accent) shrink-0">
                    <path d="M7 2.5v9M2.5 7h9" />
                  </svg>
                  {f.action}
                </p>
              ) : null}
            </div>
            <div className="order-1 sm:order-none"><Figure f={f} /></div>
          </li>
        ))}
      </ul>
      {all.length > FINDING_CAP ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="eyebrow self-start text-(--muted) hover:text-(--accent)"
        >
          {expanded ? "Show fewer" : `Show ${all.length - FINDING_CAP} smaller ${all.length - FINDING_CAP === 1 ? "gap" : "gaps"}`}
        </button>
      ) : null}
      {/* WHERE THE SLOTS COME FROM. A surplus is not a fault, so it sits beside the list rather than
        *  competing for a rank inside it — and it names the CATEGORY, never a member, because
        *  nothing in this engine ranks two ramp cards against each other. */}
      {trade ? (
        <div className="flex gap-3.5 items-start rounded-(--radius) border border-(--border) bg-(--surface) px-4 py-3.5">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="text-(--muted) shrink-0 mt-0.5">
            <path d="M2 5.5h9L8.5 3M14 10.5H5L7.5 13" />
          </svg>
          <p className="text-sm text-(--muted) max-w-[70ch] tabular-nums">
            <span className="text-(--foreground) font-medium">Where the slots come from.</span> {trade}
          </p>
        </div>
      ) : null}
    </section>
  );
}
