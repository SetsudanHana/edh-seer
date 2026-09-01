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
  const hasScores = report.synergyOverall !== undefined || report.buildScore !== undefined;
  if (parents.length === 0 && !lands && !hasScores) return null;

  // THE SAME PARTLY-READ TEST `HeadlineScores` APPLIES, read from the same field and by the same rule:
  // the presence of `coverage` IS the signal. `RecognitionPanel` states why in its own comment -- the
  // engine only computes `coverage` on a deck it could not fully read, so a fully-read deck has no
  // `coverage` object at all. Deriving a second, subtly different rule here (`derived < resolved`)
  // would put two partly-read tests on one page, which is the class of defect this panel exists to
  // avoid.
  const partial = report.coverage !== undefined;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-bold tracking-[-0.01em]">Where this deck stands</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3">
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
        {report.synergyOverall !== undefined ? (
          <Dial
            name="Synergy"
            value={report.synergyOverall.toFixed(1)}
            reading={scoreState(report.synergyOverall, partial)}
            zones="score"
            onOpen={() => onOpen("engine", undefined)}
            openLabel="Engine"
          />
        ) : null}
        {report.buildScore !== undefined ? (
          <Dial
            name="Build"
            value={report.buildScore.toFixed(1)}
            /* `buildScore` counts ROLES off printed text and type lines, which an unread card still
             * has, so it keeps its band on a partly-read deck where synergy loses its own. The split
             * is the one the coverage gate already draws; no threshold is invented here. */
            reading={scoreState(report.buildScore)}
            zones="score"
            onOpen={() => onOpen("build", undefined)}
            openLabel="Build"
          />
        ) : null}
      </div>
    </section>
  );
}
