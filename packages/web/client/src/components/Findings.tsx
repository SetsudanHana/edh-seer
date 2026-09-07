import type { DeckReport } from "../types.js";
import { findings, rankedFindings, slotTrade, FINDING_CAP, type Finding } from "../lib/findings.js";
import { useState } from "react";
import type { RunDiff } from "../lib/run-diff.js";

/** WHAT IS WRONG WITH THIS DECK — the report's focal element, and the one structural change the
 *  2026-08-26 persona reviews asked for.
 *
 *  The Overview used to render fifteen panels at identical weight: a mono eyebrow, a block of
 *  numbers, a muted paragraph, fifteen times. Nothing was dominant, so the eye had no entry point
 *  and the page read as a wall — and the two expert personas used the diagnostic panels and nothing
 *  else, from screen two onward. This puts those panels' conclusions first, ranked, and leaves the
 *  panels themselves as the evidence a reader goes to next — no longer UNDERNEATH this list (MINOR
 *  8, whole-branch review, 2026-09-01: they moved onto the Build and Mana sub-tabs when the
 *  single-scroll Overview was split), which is why each of those tabs opens on a sentence naming
 *  itself as the evidence behind a finding here.
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
        <span className="block h-full bg-(--fill)" style={{ width: `${Math.round(Math.min(1, f.filled) * 100)}%` }} />
      </span>
    </div>
  );
}

export function Findings({ report, diff }: {
  report: DeckReport;
  /** WHAT THIS EDIT DID TO THE DIAGNOSIS (roadmap S9). Two marks, and only two: a finding that went
   *  away, and one that appeared. A figure that merely MOVED gets nothing -- the header line states
   *  the move, and a third statement of one fact is what this ranked list was built to remove. */
  diff?: RunDiff | null;
}) {
  // THE TWO GROUPS (roadmap S10). `scored` is what `buildScore` can price, ordered by what closing it
  // is worth; `unseen` is colour and synergy, which are not terms in that score at all. The cap, the
  // count sentence, the disclosure and the slot trade all key off `scored` -- the second group is at
  // most two rows and renders whole.
  const { scored: all, unseen } = rankedFindings(report);
  // `to === undefined` means it was in the last run's diagnosis and is not in this one. It is not in
  // `all` either -- both read `findings(report)` -- so it is counted neither here nor in the header,
  // and it disappears by itself next run, when the diff stops naming it. No "shown once" state.
  const resolved = (diff?.findings ?? []).filter((f) => f.to === undefined);
  const isNew = new Set((diff?.findings ?? []).filter((f) => f.from === undefined).map((f) => f.id));
  // Every shortfall is computed; the cap is what SHOWS. The rest are reachable rather than dropped
  // — a diagnosis that silently truncates is the same failure as one that never ranked.
  const [expanded, setExpanded] = useState(false);
  if (all.length === 0) return null;
  const shown = expanded ? all : all.slice(0, FINDING_CAP);
  const trade = slotTrade(report, all);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-3 flex-wrap">
        {/* "What is wrong with this deck" under a chapter titled "Fixes" was the same heading
          *  twice (T1). The count beside it is what this line is actually for. */}
        {/* A SENTENCE, SO IT KEEPS INTER. `index.css`'s own comment reserves `.stat-num` for a
          *  figure and says prose keeps Inter; only the count is tabular. */}
        {/* THE SAME COUNT THE HEADER PRINTS (UX sweep 2026-09-06, D2). This said `all.length` -- the
          *  scored rows only -- while the header chip counted scored plus the "cannot see" group,
          *  so the chip read "2 findings" over a chapter that said "1 finding". One number now, and
          *  the unseen rows below carry the numbers that follow on. */}
        <span className="text-xs text-(--muted)">
          <span className="tabular-nums">{all.length + unseen.length}</span>{" "}
          {all.length + unseen.length === 1 ? "finding" : "findings"}, by what fixing it is worth
        </span>
      </div>
      <ul className="flex flex-col border-t border-(--separator)">
        {shown.map((f, i) => (
          <li
            key={f.id}
            className="grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-3 sm:gap-5 py-5 border-b border-(--separator)"
          >
            <span aria-hidden="true" className="hidden sm:block stat-num text-sm text-(--muted) pt-1.5">{i + 1}</span>
            <div className="flex flex-col gap-2.5 min-w-0 order-2 sm:order-none">
              <h3 className="text-xl sm:text-2xl font-bold leading-tight tracking-[-0.02em] flex gap-3">
                <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full self-stretch bg-(--separator)" />
                <span>{f.headline}</span>
                {/* CAUSED BY THE EDIT YOU JUST MADE, which is a different fact from "worst first" and
                  * the only one the ranking cannot carry. */}
                {isNew.has(f.id) ? (
                  <span className="self-center shrink-0 eyebrow text-(--warning) border border-(--warning) rounded-full px-2 py-0.5">
                    since your edit
                  </span>
                ) : null}
              </h3>
              <p className="text-sm text-(--muted) max-w-[62ch] tabular-nums">{f.detail}</p>
              {/* WHAT THE RANKING IS BY, stated on the row it ranks -- a ranked list whose order the
                *  reader cannot check from the screen it appears on is the skeptic persona's standing
                *  test. Not an arrow and not a predicted new score.
                *
                *  "or better" because a real card often carries two of a parent's leaves, so every
                *  one of these is a LOWER BOUND. An impact of exactly 0 is a CLAIM -- "fixing this
                *  does not move Build" -- and printing it as "+0.00" would read as a rounding error
                *  instead. In the prose column, not beside the figure: the figure block is
                *  `shrink-0`, and a sentence in it would set the row's width at 390px. */}
              {f.impact !== undefined ? (
                <p className="text-sm text-(--muted) tabular-nums">
                  {f.impact > 0
                    ? <>worth <span className="text-(--foreground) stat-num">+{f.impact.toFixed(2)}</span> to Build or better</>
                    : "does not move Build"}
                </p>
              ) : null}
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
      {/* GONE, SAID ONCE. Below the live rows because it is not one of them: it answers "did my edit
        *  work", which is a different question from "what is wrong now". */}
      {resolved.length > 0 ? (
        <ul className="flex flex-col">
          {resolved.map((f) => (
            <li key={f.id} className="line-through text-(--muted) text-sm py-1.5 flex items-baseline gap-2">
              {/* The WORD carries it, not the strike-through -- a line through text is a visual
                * treatment a screen reader does not announce (WCAG 1.4.1). */}
              <span className="text-(--success) no-underline">fixed</span>
              <span className="stat-num">{f.from}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {all.length > FINDING_CAP ? (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="eyebrow self-start text-(--muted) hover:text-(--accent)"
        >
          {/* THE FOLD NAMES WHAT IS BEHIND IT. "Show 2 smaller gaps" told a reader nothing they
            *  could act on and nothing they could use to decide whether to expand — and the fold is
            *  positional, so a rank-4 row is not necessarily trivial. Listing the figures lets the
            *  decision happen without the click. */}
          {expanded
            ? "Show fewer"
            : `Show ${all.length - FINDING_CAP} smaller: ${all.slice(FINDING_CAP)
                .map((f) => `${f.figureLabel} ${f.figure}`).join(" · ")}`}
        </button>
      ) : null}
      {/* WHERE THE SLOTS COME FROM. A surplus is not a fault, so it sits beside the list rather than
        *  competing for a rank inside it — and it names the CATEGORY, never a member, because
        *  nothing in this engine ranks two ramp cards against each other. */}
      {trade ? (
        <div className="flex gap-3.5 items-start rounded-(--radius) border border-(--separator) bg-(--surface) px-4 py-3.5">
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
            strokeWidth="1.5" className="text-(--muted) shrink-0 mt-0.5">
            <path d="M2 5.5h9L8.5 3M14 10.5H5L7.5 13" />
          </svg>
          <p className="text-sm text-(--muted) max-w-[70ch] tabular-nums">
            <span className="text-(--foreground) font-medium">Where the slots come from.</span> {trade}
          </p>
        </div>
      ) : null}
      {/* NOT A LESSER LIST. Colour is its own axis and synergy is `synergyOverall`; neither is a term
        *  in the number above, so neither can be priced in it, and inventing a conversion to
        *  interleave them is the constant `findings.ts` refuses. Rendered in full rather than capped
        *  -- it is at most two rows, and a fold over two rows is chrome. */}
      {unseen.length > 0 ? (
        <section className="flex flex-col gap-3 pt-2">
          <h3 className="text-base font-bold tracking-[-0.01em]">What the build score cannot see</h3>
          <ul className="flex flex-col border-t border-(--separator)">
            {unseen.map((f, i) => (
              // THE SAME GRID AS THE SCORED ROWS, so the number continues in the same column and,
              // like theirs, hides below `sm` (review: a phone showed "6" under no "1..5").
              <li key={f.id} className="grid grid-cols-1 sm:grid-cols-[2.5rem_minmax(0,1fr)] gap-3 sm:gap-5 py-4 border-b border-(--separator)">
                <span aria-hidden="true" className="hidden sm:block stat-num text-sm text-(--muted) pt-0.5">{all.length + i + 1}</span>
                <div className="flex flex-col gap-2 min-w-0">
                <h4 className="text-base font-semibold leading-tight">{f.headline}</h4>
                <p className="text-sm text-(--muted) max-w-[62ch] tabular-nums">{f.detail}</p>
                {f.action ? <p className="text-sm">{f.action}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
