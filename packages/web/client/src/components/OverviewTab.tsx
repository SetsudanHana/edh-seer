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

/** THE OVERVIEW, SEQUENCED — recognise, then diagnose, then prescribe, then verify.
 *
 *  It used to be fifteen self-contained blocks flowing through a two-column layout in roughly the
 *  order they were built. Four persona reviews of the live page (2026-08-26) converged on one
 *  structural finding: **the page leads with its weakest answer and buries its strongest.** Two
 *  scores out of five and three unexplained decimals owned screen one; the diagnostic panels, which
 *  were the only thing either expert persona acted on, started on screen two and ran to four. That
 *  first fix round put `Findings` first and demoted the scores — RIGHT, but not the whole answer.
 *
 *  So the order below is the player's own, from `specs/2026-08-27-report-slot-inventory.md`, with
 *  one further move the owner made on 2026-09-01: **recognition now leads even `Findings`.**
 *  "Did it understand my deck" is the reader's first question before "what is wrong with it" can
 *  mean anything to them — a criticism only lands once the reader trusts the tool read the same
 *  deck they built — and generic-before-specific is the same ordering rule the rest of this file
 *  already applies within a movement. `RecognitionPanel` carries NO score and NO target for exactly
 *  this reason: a tool that grades a deck before showing it understood it has not earned the
 *  criticism.
 *
 *  1. **Recognise** — what this deck IS: theme, colours, shape. `RecognitionPanel`, no score.
 *  2. **Diagnose** — what is wrong, ranked. `Findings` leads this movement, and the panels it ranks
 *     follow as its evidence rather than competing with it.
 *  3. **Prescribe** — what to change. Adds and cuts side by side, because they are one decision.
 *  4. **Verify** — how the engine read the deck, and the scores. Still last: four of four personas,
 *     including the experienced player, could not read `SYNERGY 0.8/5`, breadth or anchor, and they
 *     were the first thing on the page before 2026-08-27. Nothing is deleted and no engine number
 *     changed.
 *
 *  The GATE — how much of this did you read — is none of the four above: it lives ABOVE the tabs
 *  (`ReportView`), because it qualifies every tab rather than this one.
 *
 *  THE COLUMN FLOW SURVIVES ONLY INSIDE A MOVEMENT. `columns-1 xl:columns-2` was doing real work —
 *  a wide viewport should buy columns, never longer lines — but applied to the WHOLE tab it put a
 *  legality report beside a mana curve with no relationship between them, and gave the page two
 *  competing spines. It now runs within a movement, where every block in the column is an answer to
 *  the same question. */
export function OverviewTab({ data }: { data: AnalyzeResponse }) {
  const { report } = data;
  const mark = <DerivedMark coverage={report.coverage} />;
  // Which prescriptions a finding already printed as its own action line, so the Prescribe movement
  // stops restating them. `findings` is pure and cheap; `Findings` calls it too.
  const prescribedByFinding = findings(report)
    .filter((f) => f.kind === "build")
    .map((f) => f.figureLabel);
  return (
    <div className="flex flex-col gap-14">
      {/* A deck the format would not let you play is not a deck this report can diagnose, so
        *  legality still precedes everything. It renders nothing when the deck is clean, which is
        *  every one of the 71 calibration decks. */}
      <LegalityPanel legality={report.legality} />

      {/* ── 1 · RECOGNISE ────────────────────────────────────────────────────────────────────
        *  What this deck IS, before anything says what is wrong with it. The August ordering put
        *  Findings here and this at the bottom; the brief that ordering came from actually placed
        *  this question SECOND, ahead of the diagnosis, and it was demoted only because its
        *  answer at the time was two unreadable decimals. Owner ruling 2026-09-01: generic before
        *  specific, recognition before criticism. */}
      <RecognitionPanel data={data} />

      {/* ── 2 · DIAGNOSE ─────────────────────────────────────────────────────────────────────
        *  The page's focal element. Everything below it in this movement is the evidence for a
        *  row above. */}
      <Findings report={report} />

      <Movement title="The numbers behind that" count="the panels each finding is read from">
        <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
          <BuildBenchmarks
            categories={report.buildCategories}
            parents={report.buildParents}
            deckMath={report.deckMath}
            answerCoverage={report.answerCoverage}
          />
          <ManaAvailability manaAvailability={report.manaAvailability} />
          <ManaCurveChart curve={report.manaCurve} />
          <LandMathChart landCount={report.landCount} deckSize={data.resolvedCount} />
          <UnmetConditions landConditions={report.landConditions} />
        </div>
      </Movement>

      {/* ── 3 · PRESCRIBE ────────────────────────────────────────────────────────────────────
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

      {/* ── 4 · VERIFY ───────────────────────────────────────────────────────────────────────
        *  What the engine believes about the deck, and how confident it is. Below the fold on
        *  purpose: this is the answer a reader checks, not the answer they came for. */}
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
        <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
          <HighSynergyCards cards={report.cards} />
          <BracketPanel bracket={report.bracket} />
        </div>
      </Movement>
    </div>
  );
}
