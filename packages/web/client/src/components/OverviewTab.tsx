import { useState } from "react";
import type { AnalyzeResponse } from "../types.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { HeadlineScores } from "./HeadlineScores.js";
import { BuildBenchmarks } from "./BuildBenchmarks.js";
import { SuggestionsList } from "./SuggestionsList.js";
import { CutList } from "./CutList.js";
import { BracketPanel } from "./BracketPanel.js";
import { LegalityPanel } from "./LegalityPanel.js";
import { RecognitionPanel } from "./RecognitionPanel.js";
import { UnmetConditions } from "./UnmetConditions.js";
import { ManaAvailability } from "./ManaAvailability.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { LandMathChart } from "./LandMathChart.js";
import { HighSynergyCards } from "./HighSynergyCards.js";
import { Findings } from "./Findings.js";
import { findings } from "../lib/findings.js";
import { DerivedMark } from "./CoveragePanel.js";

/** A movement, not a panel. Three registers exist on this page and this is the middle one: a
 *  heading with an optional count beside it, then whatever the movement contains.
 *
 *  THE HEADING CARRIES ITS OWN WEIGHT AND TAKES NO KICKER. The design system's No-Kicker Rule, and
 *  the shipped Overview broke it fifteen times: every block was `MONO EYEBROW` → numbers → muted
 *  paragraph at identical size and spacing, which is the visual signature of generated content and
 *  was named as such by all four personas on 2026-08-26. */
function Movement({
  title, count, children, mark,
}: { title: string; count?: string; children: React.ReactNode; mark?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        <h2 className="text-lg font-bold tracking-[-0.01em]">
          {title}{mark}
        </h2>
        {/* A SENTENCE, NOT A FIGURE. "the panels each finding is read from" was set in mono, which
          *  is the costume use `index.css` explicitly rules out. */}
        {count ? <span className="text-xs text-(--muted)">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

type SubTabId = "summary" | "build" | "mana" | "engine";

const SUB_TABS: { id: SubTabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "build", label: "Build" },
  { id: "mana", label: "Mana" },
  { id: "engine", label: "Engine" },
];

/** THE OVERVIEW, IN FOUR NAMED SCREENS instead of one 5,202px scroll — about nine screens, with
 *  nothing named to steer by, since nothing in it was named until a reader reached it.
 *
 *  It used to be fifteen self-contained blocks flowing through a two-column layout in roughly the
 *  order they were built. Four persona reviews of the live page (2026-08-26) converged on one
 *  structural finding: **the page leads with its weakest answer and buries its strongest.** Two
 *  scores out of five and three unexplained decimals owned screen one; the diagnostic panels, which
 *  were the only thing either expert persona acted on, started on screen two and ran to four. That
 *  first fix round put `Findings` first and demoted the scores, and a later one put recognition
 *  ahead of even `Findings` (below) — both RIGHT, but neither fixed the length itself: nine screens
 *  of correctly-ordered content is still nine screens with no signposts.
 *
 *  So the same sequencing that used to run top-to-bottom on one page now names four sub-tabs and
 *  routes to them, each still internally ordered by the player's own questions from
 *  `specs/2026-08-27-report-slot-inventory.md`:
 *
 *  - **Summary** — recognise, then diagnose, then prescribe. "Did it understand my deck" leads
 *    even the diagnosis (owner ruling 2026-09-01): a criticism only lands once the reader trusts
 *    the tool read the same deck they built. `RecognitionPanel` carries NO score and NO target for
 *    exactly this reason. `Findings` follows it, then the adds-and-cuts movement — one decision,
 *    so the two lists sit side by side.
 *  - **Build** and **Mana** — the evidence a Summary finding is read from, split by what a
 *    deckbuilder actually asks: whether the deck plays enough of each role (Build) versus whether
 *    its mana can deliver them on curve (Mana). Both draw from the same `BuildBenchmarks` panel,
 *    filtered to different `DeckMathSectionId`s (task 4) so neither repeats the other's questions.
 *  - **Engine** — how the engine read the deck, and the scores. Still last: four of four personas,
 *    including the experienced player, could not read `SYNERGY 0.8/5`, breadth or anchor, and they
 *    were the first thing on the page before 2026-08-27. Nothing is deleted and no engine number
 *    changed, only moved behind a click a reader takes on purpose rather than meets by scrolling.
 *
 *  The GATE — how much of this did you read — is none of the four above: it lives ABOVE the tabs
 *  (`ReportView`), because it qualifies every tab rather than this one.
 *
 *  Sub-tab state is `useState`, component-local and deliberately NOT in the URL: a shared analysis
 *  link already carries the deck, and a second axis of state in that hash is scope this does not
 *  need. The strip below is modelled on `ReportTabs`' own tab strip so the two read as siblings —
 *  same `role="tablist"`/`role="tab"`/`aria-selected`, same `.eyebrow` class and accent underline —
 *  but it is NOT sticky: the tab strip above it already is, and a second sticky element inside a
 *  scroll context is the trap `CardList.tsx` documents costing a header that sat 728px above the
 *  fold while "stuck". */
export function OverviewTab({ data }: { data: AnalyzeResponse }) {
  const { report } = data;
  const mark = <DerivedMark coverage={report.coverage} />;
  // Which prescriptions a finding already printed as its own action line, so the Prescribe movement
  // stops restating them. `findings` is pure and cheap; `Findings` calls it too.
  const prescribedByFinding = findings(report)
    .filter((f) => f.kind === "build")
    .map((f) => f.figureLabel);
  const [active, setActive] = useState<SubTabId>("summary");

  return (
    <div className="flex flex-col gap-8">
      <div
        role="tablist"
        aria-label="Overview sections"
        // `overflow-x-auto`, same reason `ReportTabs` scrolls its own strip: four labels plus the
        // strip's own padding can run past a 390px row, and a clipped tab is a sub-tab you cannot
        // reach.
        className="flex gap-4 border-b border-(--separator) overflow-x-auto"
      >
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`eyebrow relative pb-2 -mb-px ${active === t.id ? "text-(--accent)" : ""}`}
          >
            {t.label}
            {active === t.id ? (
              <span
                aria-hidden="true"
                className="absolute left-0 right-0 bottom-0 h-[2px] bg-(--accent)"
              />
            ) : null}
          </button>
        ))}
      </div>

      {active === "summary" && (
        <div className="flex flex-col gap-14">
          {/* A deck the format would not let you play is not a deck this report can diagnose, so
            *  legality still precedes everything else on the sub-tab a reader lands on first. It
            *  renders nothing when the deck is clean, which is every one of the 71 calibration
            *  decks. */}
          <LegalityPanel legality={report.legality} />

          {/* ── RECOGNISE ──────────────────────────────────────────────────────────────────────
            *  What this deck IS, before anything says what is wrong with it. */}
          <RecognitionPanel data={data} />

          {/* ── DIAGNOSE ───────────────────────────────────────────────────────────────────────
            *  The page's focal element. Everything below it is evidence for a row above, on the
            *  Build and Mana sub-tabs. */}
          <Findings report={report} />

          {/* ── PRESCRIBE ──────────────────────────────────────────────────────────────────────
            *  Adds and cuts are ONE decision — "which five come out for the eight that go in" — so
            *  they sit beside each other rather than eight panels apart. */}
          <Movement title="What to change">
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
              <SuggestionsList suggestions={report.suggestions} shownAsFindings={prescribedByFinding} />
              <CutList
                cutList={report.cutList}
                unjudged={report.unjudged}
                coverage={report.coverage}
                slack={report.slack}
                trim={report.trim}
              />
            </div>
          </Movement>
        </div>
      )}

      {active === "build" && (
        <BuildBenchmarks
          categories={report.buildCategories}
          parents={report.buildParents}
          deckMath={report.deckMath}
          answerCoverage={report.answerCoverage}
          sections={["answers", "win"]}
        />
      )}

      {active === "mana" && (
        <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
          <BuildBenchmarks
            categories={report.buildCategories}
            parents={report.buildParents}
            deckMath={report.deckMath}
            answerCoverage={report.answerCoverage}
            sections={["cast"]}
          />
          <ManaAvailability manaAvailability={report.manaAvailability} />
          <ManaCurveChart curve={report.manaCurve} />
          <LandMathChart landCount={report.landCount} deckSize={data.resolvedCount} />
          <UnmetConditions landConditions={report.landConditions} />
        </div>
      )}

      {active === "engine" && (
        <Movement title="How the engine read it" mark={mark} count="over the cards it could read">
          <DeckIdentity
            cohesion={report.cohesion}
            colorIdentity={data.commanderColorIdentity}
            strategies={report.strategies}
            identity={report.identity}
            thing={report.thing}
            commanderCast={report.deckMath?.castability.commanders}
            manaAvailability={report.manaAvailability}
            commanderTax={report.commanderTax}
            coverage={report.coverage}
          />
          <HeadlineScores report={report} />
          <BuildBenchmarks
            categories={report.buildCategories}
            parents={report.buildParents}
            deckMath={report.deckMath}
            answerCoverage={report.answerCoverage}
            sections={["waiting"]}
          />
          <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
            <HighSynergyCards cards={report.cards} />
            <BracketPanel bracket={report.bracket} />
          </div>
        </Movement>
      )}
    </div>
  );
}
