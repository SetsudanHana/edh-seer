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
import { DeckGauges } from "./DeckGauges.js";
import { UnmetConditions } from "./UnmetConditions.js";
import { ManaAvailability } from "./ManaAvailability.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { ManaTimeline } from "./ManaTimeline.js";
import { LandMathChart } from "./LandMathChart.js";
import { HighSynergyCards } from "./HighSynergyCards.js";
import { Findings } from "./Findings.js";
import { findings } from "../lib/findings.js";
import { DerivedMark } from "./CoveragePanel.js";

/** A movement, not a panel: an `h2` with an optional sentence beside it, then whatever it contains.
 *
 *  IT IS THE TOP REGISTER OF A SUB-TAB, and every sub-tab gets one (MINOR 8, whole-branch review,
 *  2026-09-01 — this comment used to say "three registers exist on this page and this is the middle
 *  one", which described the single-scroll Overview that the four sub-tabs replaced, and quoted a
 *  `count` string this branch had already deleted). The panels below a movement carry `h3`s of
 *  their own, so the movement's `h2` is what stops each sub-tab opening on a heading with no parent.
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
        {/* A SENTENCE, NOT A FIGURE — it is where a movement says what its panels are FOR, and on
          *  Build and Mana that is the link back to the findings they are evidence for. Set in the
          *  body face, never mono: `index.css` rules out the costume use. */}
        {count ? <span className="text-xs text-(--muted)">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

type SubTabId = "summary" | "fixes" | "build" | "mana" | "engine";

const SUB_TABS: { id: SubTabId; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "fixes", label: "Fixes" },
  { id: "build", label: "Build" },
  { id: "mana", label: "Mana" },
  { id: "engine", label: "Engine" },
];

/** THE OVERVIEW, IN FIVE NAMED SCREENS instead of one 5,202px scroll — about nine screens, with
 *  nothing named to steer by, since nothing in it was named until a reader reached it.
 *
 *  It used to be fifteen self-contained blocks flowing through a two-column layout in roughly the
 *  order they were built. Four persona reviews of the live page (2026-08-26) converged on one
 *  structural finding: **the page leads with its weakest answer and buries its strongest.** Two
 *  scores out of five and three unexplained decimals owned screen one; the diagnostic panels, which
 *  were the only thing either expert persona acted on, started on screen two and ran to four. That
 *  first fix round put `Findings` first and demoted the scores, and a later one put recognition
 *  ahead of even `Findings` — both RIGHT, but neither fixed the length itself: nine screens of
 *  correctly-ordered content is still nine screens with no signposts.
 *
 *  So the same sequencing that used to run top-to-bottom on one page now names five sub-tabs and
 *  routes to them, each still internally ordered by the player's own questions from
 *  `specs/2026-08-27-report-slot-inventory.md`:
 *
 *  - **Summary** — recognise, then read the state of every measured thing. "Did it understand my
 *    deck" leads (owner ruling 2026-09-01): a criticism only lands once the reader trusts the tool
 *    read the same deck they built. `RecognitionPanel` carries NO score and NO target for exactly
 *    this reason. `DeckGauges` follows it — the dial for every role, the land count and the two
 *    top-line scores, each a state (`floorState`/`bandState`/`scoreState`) with a route into the
 *    sub-tab that explains it, so Summary answers "where do I stand" without also carrying the
 *    full diagnosis behind each answer.
 *  - **Fixes** — the full diagnosis and the full prescription, MOVED here from Summary (owner
 *    review, 2026-09-01) because they carried several screens of content on the tab a reader lands
 *    on first. They travel together rather than being split across tabs, because they are one
 *    thought — what is wrong, then what to do about it — and a reader should never find a finding
 *    on one tab and its own remedy on another. `Findings` first, then the adds-and-cuts movement —
 *    one decision, so the two lists sit side by side.
 *  - **Build** and **Mana** — the evidence a Fixes finding (or a Summary dial) is read from, split
 *    by what a deckbuilder actually asks: whether the deck plays enough of each role (Build) versus
 *    whether its mana can deliver them on curve (Mana). Both draw from the same `BuildBenchmarks`
 *    panel, filtered to different `DeckMathSectionId`s (task 4) so neither repeats the other's
 *    questions.
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
  /** WHICH ROW THE READER ASKED ABOUT, when they arrived by clicking a dial rather than a tab.
   *  Component-local and deliberately NOT in the URL, for the same reason the sub-tab already is:
   *  a shared analysis link carries the deck, and a second axis of state in that hash is scope this
   *  does not need. Cleared on a manual tab click -- a reader who navigated by hand did not ask
   *  about any particular row. */
  const [focus, setFocus] = useState<string | undefined>(undefined);

  const openTab = (id: SubTabId) => { setActive(id); setFocus(undefined); };

  return (
    <div className="flex flex-col gap-8">
      <div
        role="tablist"
        aria-label="Overview sections"
        // `overflow-x-auto`, same reason `ReportTabs` scrolls its own strip: five labels plus the
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
            onClick={() => openTab(t.id)}
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

      {/* Matches `ReportTabs`' own panel wrapper exactly -- one `role="tabpanel"` around whichever
        *  branch is active, no `aria-controls`/`id` wiring, because `ReportTabs` itself has none. */}
      <div role="tabpanel">
      {active === "summary" && (
        <div className="flex flex-col gap-14">
          {/* A deck the format would not let you play is not a deck this report can diagnose, so
            *  legality still precedes everything else on the sub-tab a reader lands on first. It
            *  renders nothing when the deck is clean, which is every one of the 71 calibration
            *  decks. */}
          <LegalityPanel legality={report.legality} />

          {/* ── RECOGNISE ──────────────────────────────────────────────────────────────────────
            *  What this deck IS, before anything judges it. */}
          <RecognitionPanel data={data} />

          {/* ── WHERE IT STANDS ────────────────────────────────────────────────────────────────
            *  Every measured thing as a state, and a route into the detail behind each. The full
            *  diagnosis this used to carry lives on the Fixes tab now. */}
          <DeckGauges data={data} onOpen={(tab, f) => { setActive(tab); setFocus(f); }} />
        </div>
      )}

      {/* ── DIAGNOSE, THEN PRESCRIBE ─────────────────────────────────────────────────────────────
        *  One tab, because they are one thought: what is wrong, then what to do about it. Splitting
        *  them across tabs would put a finding on one and its own remedy on another. */}
      {active === "fixes" && (
        <div className="flex flex-col gap-14">
          <Findings report={report} />

          {/* Adds and cuts are ONE decision — "which five come out for the eight that go in" — so
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

      {/* I3 (whole-branch review, 2026-09-01): Build and Mana shipped with NO title element at all
        *  — the `Movement` wrapper that used to carry "The numbers behind that · the panels each
        *  finding is read from" was deleted with the single-scroll layout rather than relocated to
        *  the sub-tabs that inherited its panels. Two things went with it. The heading outline both
        *  skipped and inverted (Build opened on an `h3`, Mana on an `h4`, followed by `h3`s from
        *  `ManaAvailability` and friends — WCAG 1.3.1, and this repo's own "headings never skip
        *  levels"); and the SENTENCE saying these panels are the evidence for Fixes' findings
        *  left the product entirely, so a reader arriving on Build met a wall of numbers with no
        *  statement of what they were for. Both `count` strings below restore that link, worded for
        *  the half of the split each tab owns. */}
      {active === "build" && (
        <Movement title="What this deck plays" count="the evidence behind each build finding on Fixes">
          <BuildBenchmarks
            categories={report.buildCategories}
            parents={report.buildParents}
            deckMath={report.deckMath}
            answerCoverage={report.answerCoverage}
            sections={["answers", "win"]}
            focus={focus}
          />
        </Movement>
      )}

      {active === "mana" && (
        <Movement title="Whether the mana delivers it" count="the evidence behind each mana finding on Fixes">
        <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
          {/* FIX ROUND 1 (controller ruling, 2026-09-01): `showBenchmarks={false}` -- the Build
            *  sub-tab is the only one that owns the category/parent block ("How the roles are spent",
            *  its group headers and leaf rows, the ungrouped bars). Without this, that
            *  block rendered identically here AND on Engine, three copies of the same Consistency/
            *  Interaction groups across the sub-tabs the split was supposed to separate. */}
          <BuildBenchmarks
            categories={report.buildCategories}
            parents={report.buildParents}
            deckMath={report.deckMath}
            answerCoverage={report.answerCoverage}
            sections={["cast"]}
            showBenchmarks={false}
          />
          {/* THE INTERSECTION LEADS; the two panels under it are its evidence. Neither is
            *  redundant: `ManaAvailability` carries the policy interval and the colour caveat the
            *  chart does not draw, and the raw curve is the only place a per-COST count survives
            *  once two costs share a turn on a ramping deck. Same posture as the waffle over
            *  `MissingCards` and the bracket band over its named list. */}
          <ManaTimeline curve={report.manaCurve} manaAvailability={report.manaAvailability} />
          <ManaAvailability manaAvailability={report.manaAvailability} />
          <ManaCurveChart curve={report.manaCurve} />
          <LandMathChart landCount={report.landCount} deckSize={data.resolvedCount} />
          <UnmetConditions landConditions={report.landConditions} />
        </div>
        </Movement>
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
          {/* Same `showBenchmarks={false}` reasoning as Mana, above -- Build alone owns the
            *  category/parent block. */}
          <BuildBenchmarks
            categories={report.buildCategories}
            parents={report.buildParents}
            deckMath={report.deckMath}
            answerCoverage={report.answerCoverage}
            sections={["waiting"]}
            showBenchmarks={false}
          />
          <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
            <HighSynergyCards cards={report.cards} />
            <BracketPanel bracket={report.bracket} />
          </div>
        </Movement>
      )}
      </div>
    </div>
  );
}
