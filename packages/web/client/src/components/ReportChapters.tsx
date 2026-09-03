import { useMemo, useState } from "react";
import type { AnalyzeResponse } from "../types.js";
import { CHAPTERS, CHAPTER_FOR_GAUGE, type ChapterId } from "../lib/chapters.js";
import { ChapterRail, useCurrentChapter } from "./ChapterRail.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { BuildBenchmarks } from "./BuildBenchmarks.js";
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
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CoveragePanel } from "./CoveragePanel.js";
import { Findings } from "./Findings.js";
import type { RunDiff } from "../lib/run-diff.js";
import { findings } from "../lib/findings.js";
import { unreadCardNames } from "../lib/unread.js";
import { primaryType } from "../lib/deck-shape.js";

/** A movement, not a panel: an `h2` with an optional sentence beside it, then whatever it contains.
 *
 *  It is the top register INSIDE a chapter — the chapter's own heading is the question above it —
 *  and the panels below a movement carry `h3`s of their own.
 *
 *  THE HEADING CARRIES ITS OWN WEIGHT AND TAKES NO KICKER. The design system's No-Kicker Rule, and
 *  the shipped Overview broke it fifteen times: every block was `MONO EYEBROW` -> numbers -> muted
 *  paragraph at identical size and spacing, which is the visual signature of generated content and
 *  was named as such by all four personas on 2026-08-26. */
/** `title` IS OPTIONAL, AND MOST MOVEMENTS NO LONGER HAVE ONE (roadmap T1). Every chapter used to
 *  open with a question and then restate it as a declarative one line down -- "Can the mana deliver
 *  it?" over "Whether the mana delivers it" -- which the copy review named as the strongest
 *  machine-written tell on the page: *"no human writes a title twice, and the nominalised echo is
 *  pure LLM cadence."* The `count` sentence is not an echo and stays: it says what the panels below
 *  are evidence FOR, and on Mana and Roles it is the link back to the findings. */
function Movement({
  title, count, children,
}: { title?: string; count?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-baseline gap-3 flex-wrap">
        {title ? <h3 className="text-lg font-bold tracking-[-0.01em]">{title}</h3> : null}
        {/* A SENTENCE, NOT A FIGURE — it is where a movement says what its panels are FOR, and on
          *  Mana and Roles that is the link back to the findings they are evidence for. Set in the
          *  body face, never mono: `index.css` rules out the costume use. */}
        {count ? <span className="text-xs text-(--muted)">{count}</span> : null}
      </div>
      {children}
    </section>
  );
}

/** One chapter: a landmark the rail can point at and a scroll target that clears the sticky header.
 *
 *  `scroll-mt` is `--report-header-h`, measured by `ReportHeader` — the anchor is what an in-page
 *  link lands on, and without it every chapter title parks UNDER the header, which is the same
 *  defect class as R2's hardcoded `top-[33px]` one component over. */
function Chapter({ id, title, children }: {
  id: ChapterId; title: string; children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      // CLEARS BOTH PINNED BARS. Below `lg` the rail is a second sticky strip under the header, and
      // an offset that counted only the header left a chapter's own title behind the rail -- a
      // phone judge landing on chapter 6 read its heading as the single word "do?" and could not
      // tell which chapter they were in. Both are measured, neither is a constant.
      className="flex flex-col gap-8 scroll-mt-[calc(var(--report-header-h,0px)+var(--report-rail-h,0px)+1rem)]"
    >
      <h2 id={`${id}-title`} className="text-2xl sm:text-3xl font-bold tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** THE REPORT, AS SIX CHAPTERS IN ONE SCROLL — replacing the five Overview sub-tabs (#76) and the
 *  Archetypes top-level tab.
 *
 *  The sub-tabs were themselves a fix: fifteen self-contained blocks in a 5,202px column with
 *  nothing named to steer by. Naming five screens fixed the signposts and introduced a worse
 *  problem — the SEQUENCE went with them. The six questions are one order a first-time reader
 *  follows top to bottom (trust -> verdict -> plan -> mana -> roles -> action), and a tab strip
 *  says nothing about what sits behind the tab you did not press. A returning player jumps with the
 *  rail, which reflects position rather than hiding the rest.
 *
 *  THIS ITEM MOVES PANELS AND CHANGES NONE OF THEM (roadmap S7). Every panel keeps its props and
 *  its internals, and two redundancies the sub-tabs were hiding become visible here on purpose —
 *  chapter 2 prints the two scores as dials AND as `HeadlineScores` tiles, chapter 4 runs three
 *  views of the same mana. Both are S15's to decide, and S15's whole argument is that the call
 *  wants all six chapters visible at once rather than being made from inside the one layout that
 *  hides what a deletion is worth.
 *
 *  Chapter membership lives in `lib/chapters.ts` so the rail and the sections cannot disagree about
 *  what exists. */
export function ReportChapters({ data, diff }: { data: AnalyzeResponse; diff?: RunDiff | null }) {
  const { report } = data;
  const current = useCurrentChapter();
  /** WHICH ROW THE READER ASKED ABOUT, when they arrived by pressing a dial rather than scrolling.
   *  Component-local and deliberately NOT in the URL, same reason the sub-tab state was: a shared
   *  analysis link carries the deck, and a second axis of state in that hash is scope this does not
   *  need. */
  const [focus, setFocus] = useState<string | undefined>(undefined);
  // A DIAL NOW SCROLLS RATHER THAN SWITCHING A TAB. Same three destinations, same `focus` hand-off
  // to `BuildBenchmarks`; `CHAPTER_FOR_GAUGE` is where the dissolved Engine tab's redirect lives.
  const openChapter = (tab: "build" | "mana" | "engine", f?: string): void => {
    setFocus(f);
    // A DIAL WITH A ROW BEHIND IT SCROLLS TO THE ROW, NOT THE CHAPTER. `BuildBenchmarks` already
    // scrolls its focused group into view and gives it DOM focus (which is what a keyboard reader
    // needs), so scrolling the chapter here too would be two scrolls racing to different offsets.
    if (f !== undefined) return;
    document.getElementById(CHAPTER_FOR_GAUGE[tab])?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // WHETHER THE DECK'S DEFINING CARD IS ONE OF THE UNREAD — the single fact all four personas
  // reached independently on 2026-08-27, because the gate's name list is alphabetical and capped at
  // eight. A two-faced commander rates one row per face and both carry the same `derived` flag, so
  // `unreadCardNames` dedupes on the physical name.
  const commanderUnread = [...unreadCardNames(report.cards.filter((c) => c.isCommander))];

  /** NONLAND CARDS, BY THE ONE LAND RULE THIS APP HAS. `primaryType` returns null for a land on
   *  purpose, and reading it off the graph's front-face nodes is the same basis `DeckWaffle` counts
   *  on — so the matrix's row count and the waffle's nonland total cannot disagree. */
  const nonlandNames = useMemo(
    () => (data.graph?.nodes ?? [])
      .filter((n) => n.face === undefined && n.isToken !== true && primaryType(n.types) !== null)
      .map((n) => n.cardName ?? n.id),
    [data.graph],
  );

  const title = (id: ChapterId): string => CHAPTERS.find((c) => c.id === id)!.title;

  return (
    <div className="flex flex-col lg:flex-row lg:gap-10 lg:items-start">
      <ChapterRail current={current} />
      {/* `min-w-0` so a wide child (the theme matrix, the cards table) shrinks inside the flex row
        *  instead of widening it — the narrow-width defence this repo has already paid for twice. */}
      <div className="flex flex-col gap-16 lg:gap-20 min-w-0 flex-1 pt-6 lg:pt-0">
        <Chapter id="read" title={title("read")}>
          {/* A deck the format would not let you play is not a deck this report can diagnose. It
            *  renders nothing when the deck is clean, which is every one of the 71 calibration
            *  decks. */}
          <LegalityPanel legality={report.legality} />
          {/* THE HERO: what this deck IS, before anything judges it — and the waffle inside it is
            *  where a reader checks the engine's work card by card. */}
          <RecognitionPanel data={data} />
          {/* THE GATE. It used to sit above the tab strip because it qualifies every tab; in one
            *  scroll there is no "above the tabs" left, so the FIGURE rides the sticky header on
            *  every surface and the caveat, the names and the hatch legend live here, in the chapter
            *  whose question they answer. */}
          <CoveragePanel
            coverage={report.coverage}
            resolved={data.resolvedCount}
            total={data.totalCount}
            commanderUnread={commanderUnread}
          />
          {report.coverage ? null : (
            <p className="eyebrow">
              {/* "RESOLVED" IS A RULES WORD (T1): a spell resolves, and a player scanning
                *  "Resolved 99/100" reads a simulation stat rather than how many names this tool
                *  recognised. Nothing about the figure changed. */}
              Recognized <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
            </p>
          )}
        </Chapter>

        {/* THE ° MARK IS GONE (S13, owner call 2026-09-02). It rode this heading, which was both
          *  too narrow -- the legend promised it on four figures -- and too WIDE: `BracketPanel`
          *  below reads printed data and is not coverage-limited at all, so a mark on the chapter
          *  qualified it too. Every figure that IS limited now says so in its own words next to
          *  itself, which is what the three unmarked ones were already doing. */}
        <Chapter id="stand" title={title("stand")}>
          <DeckIdentity
            cohesion={report.cohesion}
            colorIdentity={data.commanderColorIdentity}
            strategies={report.strategies}
            identity={report.identity}
            thing={report.thing}
            commanderCast={report.deckMath?.castability.commanders}
            manaAvailability={report.manaAvailability}
            coverage={report.coverage}
            mdfc={report.deckMath?.lands.mdfc}
          />
          {/* THE TWO SCORES, ONCE (roadmap S15, owner call 2026-09-02). `HeadlineScores`' tiles
            *  used to sit directly under these dials printing the same two figures a third time,
            *  counting the sticky header — S7 made that visible and this is the call it was made
            *  for. The tiles were the only place either score said what it MEASURES, so those two
            *  `Explain` blocks moved onto the dials themselves and the component retired. */}
          <DeckGauges data={data} onOpen={openChapter} diff={diff} />
          <BracketPanel bracket={report.bracket} />
        </Chapter>

        <Chapter id="plan" title={title("plan")}>
          {/* THE ONE FIGURE THAT SAID NOTHING (S13). `cardSignals` in `matcher/src/analyze.ts`
            *  filters on `dc.tags`, so strategies, the groups and the membership matrix are all
            *  derived-only -- and this was the only coverage-limited surface on the page with
            *  neither a worded caveat nor the hatch. It gets `coverage` for the same reason
            *  `CutList` has it. */}
          <ArchetypeBoard
            strategies={report.strategies}
            archetypes={report.archetypes}
            nonlandNames={nonlandNames}
            coverage={report.coverage}
          />
          {/* WHICH CARDS CARRY THE PLAN, IN THE CHAPTER THAT ASKS WHAT THE PLAN IS (roadmap T21).
            *  It used to sit in chapter 6, "What's wrong, and what do I do?", beside the cut list --
            *  and the owner's note was the whole argument: *"why high synergy table is in the fix
            *  chapter? It does not make any sense"*. A list of what is WORKING is not a repair. It
            *  is the other half of what `ArchetypeBoard` above says in aggregate: the groups say
            *  which mechanisms the deck runs, this says which cards are doing the running. */}
          <HighSynergyCards cards={report.cards} />
        </Chapter>

        <Chapter id="mana" title={title("mana")}>
          <Movement count="the evidence behind each mana finding in What's wrong, below">
          <div className="columns-1 xl:columns-2 gap-8 [&>*]:break-inside-avoid [&>*]:mb-8">
            {/* `showBenchmarks={false}`: the Roles chapter alone owns the category/parent block
              *  ("How the roles are spent", its group headers and leaf rows). Without this, that
              *  block renders identically in both chapters — and in one scroll a reader meets both
              *  copies, where the sub-tabs at least kept them a click apart. */}
            <BuildBenchmarks
              categories={report.buildCategories}
              parents={report.buildParents}
              deckMath={report.deckMath}
              answerCoverage={report.answerCoverage}
              sections={["cast"]}
              showBenchmarks={false}
            />
            {/* THE INTERSECTION LEADS; the two panels under it are its evidence. Neither is
              *  redundant on its own terms: `ManaAvailability` carries the policy interval and the
              *  colour caveat the chart does not draw, and the raw curve is the only place a
              *  per-COST count survives once two costs share a turn on a ramping deck. Whether all
              *  three earn a place in ONE column is S15's question, not this item's. */}
            <ManaTimeline curve={report.manaCurve} manaAvailability={report.manaAvailability} />
            <ManaAvailability manaAvailability={report.manaAvailability} />
            <LandMathChart landCount={report.landCount} deckSize={data.resolvedCount} />
            <UnmetConditions landConditions={report.landConditions} />
          </div>
          {/* PER-COST COUNTS, BEHIND A DISCLOSURE (roadmap S15, owner call 2026-09-02). Chapter
            *  4 ran three pictures of the same mana in one column and no judge mentioned this
            *  one. It is not deleted, because it is the only place a per-COST count survives once
            *  two costs share a turn on a ramping deck -- the timeline above is indexed by TURN
            *  and cannot say that. Reachable, not first.
            *
            *  OUTSIDE THE MULTI-COLUMN, AND THAT IS THE WHOLE OF T16. Owner: *"when I click it
            *  components jump around and they should not"*. A CSS multi-column BALANCES its
            *  children across the columns, so a disclosure opening inside one changes the total
            *  height and every other panel is redistributed -- panels the reader was not looking at
            *  move, in a chapter they had already read. Full width, below the columns, it can only
            *  push what is under it. */}
          <details className="mt-8 rounded-(--radius) border border-(--separator) bg-(--surface) px-4 py-3">
            <summary className="eyebrow cursor-pointer text-(--muted)">
              the curve by mana cost, not by turn
            </summary>
            <div className="pt-3">
              <ManaCurveChart curve={report.manaCurve} />
            </div>
          </details>
          </Movement>
        </Chapter>

        <Chapter id="roles" title={title("roles")}>
          <Movement count="the evidence behind each build finding in What's wrong, below">
            <BuildBenchmarks
              categories={report.buildCategories}
              parents={report.buildParents}
              deckMath={report.deckMath}
              answerCoverage={report.answerCoverage}
              // `waiting` came off the dissolved Engine tab: it is a count of roles the deck plays,
              // which is this chapter's question and no other chapter's.
              sections={["answers", "win", "waiting"]}
              focus={focus}
            />
          </Movement>
        </Chapter>

        <Chapter id="fix" title={title("fix")}>
          <Findings report={report} diff={diff} />
          {/* Adds and cuts are ONE decision — "which five come out for the eight that go in" — so
            *  they sit beside each other rather than eight panels apart. */}
          {/* THE GRID HAD ONE CHILD AND STILL RESERVED TWO COLUMNS (roadmap T11). It was built to
            *  sit the cut list beside the high-synergy list -- "which five come out for the eight
            *  that go in" -- and T21 moved that other list to the Game plan chapter, where a list of
            *  what is WORKING belongs. What was left was a two-column grid holding one panel, so
            *  half the row was reserved for nothing at every width above 1280px. A defect I
            *  introduced two commits ago and did not look at. */}
          <Movement title="What to change">
            <CutList
              cutList={report.cutList}
              unjudged={report.unjudged}
              coverage={report.coverage}
              slack={report.slack}
              trim={report.trim}
            />
          </Movement>
        </Chapter>
      </div>
    </div>
  );
}
