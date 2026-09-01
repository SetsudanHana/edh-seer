import type { AnalyzeResponse } from "../types.js";
import { Dial } from "./Dial.js";
import { floorState, bandState, scoreState } from "../lib/deck-gauge.js";

export type GaugeTab = "build" | "mana" | "engine";

/** WHAT STATE IS EVERY MEASURED THING IN — the question Summary now answers, and the one it used
 *  to answer by making the reader read the whole diagnosis.
 *
 *  These four role counts USED to live in `RecognitionPanel` as bars with no target, because
 *  Recognition is forbidden to judge. They arrived there by a two-step move: the count-against-
 *  target rows left `BuildBenchmarks` for Recognition, and then the target was stripped on the way
 *  in. The result was that nowhere on the page showed a role against its floor as a mark -- only as
 *  a sentence inside `Findings`. This panel is where that judgement is allowed to live. */
export function DeckGauges({ data, onOpen }: { data: AnalyzeResponse; onOpen: (tab: GaugeTab, focus?: string) => void }) {
  const { report } = data;
  const parents = report.buildParents ?? [];
  const lands = report.deckMath?.lands;
  const hasSynergy = report.synergyOverall !== undefined;
  const hasBuild = report.buildScore !== undefined;
  if (parents.length === 0 && !lands && !hasSynergy && !hasBuild) return null;

  // THE SAME PARTLY-READ TEST `HeadlineScores` APPLIES, read from the same field and by the same rule:
  // the presence of `coverage` IS the signal. `RecognitionPanel` states why in its own comment -- the
  // engine only computes `coverage` on a deck it could not fully read, so a fully-read deck has no
  // `coverage` object at all. Deriving a second, subtly different rule here (`derived < resolved`)
  // would put two partly-read tests on one page, which is the class of defect this panel exists to
  // avoid.
  const partial = report.coverage !== undefined;

  // GROUPED, NOT FLAT (owner ruling, 2026-09-01): the five build-parent/lands dials are inputs to
  // `buildScore` (`build.ts:520-532`, the weighted mean of parent attainments plus lands) and breadth
  // (`positiveCoherence`) and anchor (`anchoring`) are the two inputs `synergyOverall` blends
  // (`analyze.ts:446,522-523`) -- `HeadlineScores` already prints them as its muted sub-line. Seven
  // equal dials in one row said none of that; two lead dials over their own inputs do. A group
  // renders only when its OWN lead score exists, so a report with just one of the two scores shows
  // just that group -- there is no case today where `buildParents`/`lands` exist without `buildScore`
  // (`build.ts` computes all three together), so gating Build's inputs on `buildScore` costs nothing.
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-bold tracking-[-0.01em]">Where this deck stands</h2>
      <div className="flex flex-col lg:flex-row gap-6">
        {hasSynergy ? (
          <div
            role="group"
            aria-label="Synergy, and the two measures behind it"
            className="flex-1 flex flex-col items-center gap-3"
          >
            <Dial
              name="Synergy"
              value={report.synergyOverall!.toFixed(1)}
              reading={scoreState(report.synergyOverall!, partial)}
              zones="score"
              size="lead"
              onOpen={() => onOpen("engine", undefined)}
              openLabel="Engine"
            />
            {/* Breadth and anchor are both edge-derived, same as synergy itself, so they take the
              * same partly-read flag for the same reason `HeadlineScores` gives its own sub-line --
              * see the comment on `partial` above. No new rule is derived for them.
              *
              * GRID, NOT FLEX-WRAP (task 9 fix round 1, whole-branch review, 2026-09-01): a flex
              * item sizes to its content and does not shrink across a wrap, which measured out as
              * two real defects -- a stranded Build input at 1440px and NOTHING wrapping at 390px,
              * a 55% longer Summary page. A CSS grid's explicit column count is not content-
              * dependent: `grid-cols-2` is always exactly two columns, at any width, and the
              * column TRACKS shrink to fit rather than the items refusing to. `w-full` makes this
              * div, not its flex-centred parent, own the available width the columns divide. */}
            <div className="synergy-inputs-grid grid grid-cols-2 gap-3 w-full">
              {report.positiveCoherence !== undefined ? (
                <Dial
                  name="Breadth"
                  value={report.positiveCoherence.toFixed(1)}
                  reading={scoreState(report.positiveCoherence, partial)}
                  zones="score"
                />
              ) : null}
              {report.anchoring !== undefined ? (
                <Dial
                  name="Anchor"
                  value={report.anchoring.toFixed(1)}
                  reading={scoreState(report.anchoring, partial)}
                  zones="score"
                />
              ) : null}
            </div>
          </div>
        ) : null}
        {hasBuild ? (
          <div
            role="group"
            aria-label="Build, and the five measures behind it"
            className="flex-1 flex flex-col items-center gap-3"
          >
            <Dial
              name="Build"
              value={report.buildScore!.toFixed(1)}
              /* `buildScore` counts ROLES off printed text and type lines, which an unread card still
               * has, so it keeps its band on a partly-read deck where synergy loses its own. The split
               * is the one the coverage gate already draws; no threshold is invented here. */
              reading={scoreState(report.buildScore!)}
              zones="score"
              size="lead"
              onOpen={() => onOpen("build", undefined)}
              openLabel="Build"
            />
            {/* Two columns narrow, three from `sm` (640px), five from `xl` (1280px) -- one clean
              * row of five at wide widths, with nothing stranded (measured: `xl:grid-cols-5` needs
              * 938px for five 144px-capped dials plus gaps, and even the `sm`/`lg` band's 1376px
              * content width at 1440px clears that easily). `.build-inputs-grid` (index.css) spans
              * a lone last dial across the row only at the 2-column tier, where 5 items give 2+2+1
              * -- the 3-column tier gives 3+2 and the 5-column tier is a single row, neither of
              * which strands anything. */}
            <div className="build-inputs-grid grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 w-full">
              {parents.map((p) => (
                <Dial
                  key={p.name}
                  name={p.name}
                  value={String(p.count)}
                  reading={floorState(p.count, p.target)}
                  zones="floor"
                  // A SINGLE-LEAF PARENT HAS NO DETAIL TO OPEN. `BuildBenchmarks` renders a group only
                  // for a parent with more than one leaf -- Ramp's single leaf would restate the parent's
                  // own count as "100% of Ramp", the duplicate the folded shape exists to avoid. So those
                  // dials are content, not controls.
                  onOpen={p.leaves.length > 1 ? () => onOpen("build", p.name) : undefined}
                  openLabel="Build"
                />
              ))}
              {lands ? (
                <Dial
                  name="Lands"
                  value={String(lands.actual)}
                  reading={bandState(lands.actual, lands.target)}
                  zones="band"
                  onOpen={() => onOpen("mana", undefined)}
                  openLabel="Mana"
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
