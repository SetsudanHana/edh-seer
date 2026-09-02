import type { AnalyzeResponse } from "../types.js";
import { Dial } from "./Dial.js";
import { Bullet, TARGET_MARK } from "./Bullet.js";
import { floorState, bandState, scoreState } from "../lib/deck-gauge.js";
import { bandLegend } from "../lib/score-band.js";
import { Explain } from "./Explain.js";
import type { RunDiff } from "../lib/run-diff.js";

/** A COUNT AGAINST ITS REFERENCE, AS A FRACTION OF THE TRACK. The target parks at `TARGET_MARK`,
 *  so the bar runs past it when the count clears it and stops short when it does not -- and every
 *  input's tick lands at the same x, which is what lets a reader compare rows whose targets
 *  differ. Guarded at 0: a parent with no floor (`BASE_TARGETS` gives burn and stax a target of 0)
 *  would divide by nothing, and `floorState` already reports that case as "no floor set".
 *
 *  OVERSHOOT IS COMPRESSED, NOT CLAMPED, and the live screen is why. A plain
 *  `min((count/target) * 0.7, 1)` saturates the moment a count is ~43% past its floor, so on a real
 *  deck `Interaction 15/10` ("5 over target") and `Board wipes 4/2` ("on target") both painted a
 *  full-width bar -- two different states drawn identically, which is the EXACT defect
 *  `TARGET_MARK`'s own comment exists to prevent. It never bit before because the only caller was
 *  a code path that renders for no deck; on the report's first screen it bit immediately.
 *
 *  The excess maps through `over / (over + 1)` into the track's remaining 30%: monotonic in the
 *  count, so more over is always visibly further right, and asymptotic to the end, so no bar can
 *  reach it and "full" never means "done". CEILING: the curve is a rendering choice, not a
 *  measurement -- it makes the ORDER readable, not the magnitude. The exact figure is printed
 *  beside the bar and the words say "N over target", which is what a reader acts on. Same posture
 *  as `GaugeReading.position`'s own bucket-centre ceiling. */
const countFill = (count: number, target: number): number => {
  if (target <= 0) return 0;
  const ratio = count / target;
  if (ratio <= 1) return Math.max(0, ratio * TARGET_MARK);
  const over = ratio - 1;
  return TARGET_MARK + (1 - TARGET_MARK) * (over / (over + 1));
};

/** A 0-5 SCORE HAS NO TARGET, ONLY BANDS. `position` is already the -1..1 the zones are drawn in
 *  (`scoreState` interpolates it, unlike the bucket-centre readings), so the bar is that mapped
 *  into the track and there is no tick -- inventing one would be inventing a number. */
const scoreFill = (reading: { position: number }): number => (reading.position + 1) / 2;

export type GaugeTab = "build" | "mana" | "engine";

/** WHAT STATE IS EVERY MEASURED THING IN — the question Summary now answers, and the one it used
 *  to answer by making the reader read the whole diagnosis.
 *
 *  These four role counts USED to live in `RecognitionPanel` as bars with no target, because
 *  Recognition is forbidden to judge. They arrived there by a two-step move: the count-against-
 *  target rows left `BuildBenchmarks` for Recognition, and then the target was stripped on the way
 *  in. The result was that nowhere on the page showed a role against its floor as a mark -- only as
 *  a sentence inside `Findings`. This panel is where that judgement is allowed to live. */
export function DeckGauges({ data, onOpen, diff }: {
  data: AnalyzeResponse;
  onOpen: (tab: GaugeTab, focus?: string) => void;
  /** WHERE THESE TWO NUMBERS WERE LAST RUN (roadmap S9). Only the two LEAD dials take a tick: the
   *  run snapshot carries `synergyOverall` and `buildScore` and nothing else, and giving the input
   *  dials one would mean new snapshot fields for a comparison nobody asked for. */
  diff?: RunDiff | null;
}) {
  const { report } = data;
  // WHICH CARD THE ANCHOR IS. The figure is computed from the single best-fed card's authority, and
  // that card is sitting elsewhere on the page wearing an "anchor" tag with nothing connecting the
  // two. Recomputed here on the same basis the engine uses (max authority) rather than shipped as a
  // new field. Moved from `HeadlineScores` with the gloss it belongs to (roadmap S15).
  const anchorCard = [...(report.cards ?? [])].sort((a, b) => (b.authority ?? 0) - (a.authority ?? 0))[0];
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
              /* Read on the SAME basis as the live reading above -- `partial` and all -- so the tick
               * and the needle are two points on one scale rather than two scales. */
              previous={diff?.synergy
                ? { value: diff.synergy.from.toFixed(1), reading: scoreState(diff.synergy.from, partial) }
                : undefined}
              zones="score"
              size="lead"
              onOpen={() => onOpen("engine", undefined)}
              openLabel="Engine"
              /* THE ONLY PLACE EITHER SCORE SAYS WHAT IT MEASURES, moved here verbatim when S15
               * retired the second copy of the number it used to sit in. Four of four personas
               * (2026-08-26) could not read `SYNERGY 0.8/5`; the words are what fixed that, not the
               * tile around them. */
              explain={
                <Explain label="what this measures">
                  The mean of two halves, each 0–5. <span className="text-(--foreground)">Breadth</span> is
                  how much of the deck sits on its main theme, counting each nonland card by its strongest
                  on-theme edge — a card connected to nothing still counts, and drags it down.{" "}
                  <span className="text-(--foreground)">Anchor</span> is how heavily the deck's best-fed
                  card is supported
                  {anchorCard ? <> — here that is {anchorCard.name}</> : null}; it tops out at 5, so two
                  decks with very different engines can both read 5.0. {bandLegend()}.
                </Explain>
              }
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
                <Bullet
                  name="Breadth"
                  value={report.positiveCoherence.toFixed(1)}
                  reading={scoreState(report.positiveCoherence, partial)}
                  fill={scoreFill(scoreState(report.positiveCoherence, partial))}
                  zones="score"
                />
              ) : null}
              {report.anchoring !== undefined ? (
                <Bullet
                  name="Anchor"
                  value={report.anchoring.toFixed(1)}
                  reading={scoreState(report.anchoring, partial)}
                  fill={scoreFill(scoreState(report.anchoring, partial))}
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
              /* No `partial`, matching the live reading immediately above and for its reason. */
              previous={diff?.build
                ? { value: diff.build.from.toFixed(1), reading: scoreState(diff.build.from) }
                : undefined}
              zones="score"
              size="lead"
              onOpen={() => onOpen("build", undefined)}
              openLabel="Build"
              /* Same move, and the wording follows the panel it points at: the category targets are
               * the Roles chapter's, not "the benchmarks below" — that phrase was true of a
               * single-scroll Overview two layouts ago. */
              explain={
                <Explain label="what this measures">
                  How close the deck sits to the category targets in Roles — ramp, draw, removal and the
                  rest. It says nothing about how the cards work together, and the targets are a
                  deckbuilding convention rather than a number measured from any deck. {bandLegend()}.
                </Explain>
              }
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
                <Bullet
                  key={p.name}
                  name={p.name}
                  value={String(p.count)}
                  reading={floorState(p.count, p.target)}
                  fill={countFill(p.count, p.target)}
                  mark={p.target > 0 ? TARGET_MARK : undefined}
                  // A SINGLE-LEAF PARENT HAS NO DETAIL TO OPEN. `BuildBenchmarks` renders a group
                  // only for a parent with more than one leaf -- Ramp's single leaf would restate
                  // the parent's own count as "100% of Ramp", the duplicate the folded shape
                  // exists to avoid. So those are content, not controls.
                  onOpen={p.leaves.length > 1 ? () => onOpen("build", p.name) : undefined}
                  openLabel="Build"
                />
              ))}
              {lands ? (
                <Bullet
                  name="Lands"
                  value={String(lands.actual)}
                  reading={bandState(lands.actual, lands.target)}
                  fill={countFill(lands.actual, lands.target)}
                  mark={lands.target > 0 ? TARGET_MARK : undefined}
                  onOpen={() => onOpen("mana", undefined)}
                  openLabel="Mana"
                />
              ) : null}
            </div>
            {/* WHOSE FLOOR IT IS, SAID WHERE THE FLOOR IS DRAWN (roadmap S4). Every tick above is
              *  the Command Zone template's number, and the panel now marks a deck against it on
              *  the report's first screen -- so the one thing a reader needs before acting on a
              *  "3 short" is that nobody measured it. The sentence already existed twice on this
              *  site (`CutList`'s slack section, `BuildBenchmarks`'s hate classes) and in neither
              *  place did it sit beside the mark it qualifies. `Lands` is excepted IN THE WORDS
              *  because it genuinely is measured: `deckMath.lands.target` comes from a regression
              *  over real decks, which is also why it is the one two-sided reading here. */}
            <p className="text-xs text-(--muted) max-w-[52ch]">
              Each tick is the Command Zone template&rsquo;s floor — a deckbuilding convention
              someone typed, not a number measured from decks. Over it is not a fault
              {lands ? <> · the land tick is the exception, modelled from this deck&rsquo;s own curve</> : null}.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
