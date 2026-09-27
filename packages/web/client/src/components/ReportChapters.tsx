import { useMemo, useState } from "react";
import type { AnalyzeResponse } from "../types.js";
import { CHAPTERS, type ChapterId } from "../lib/chapters.js";
import { ChapterRail, useCurrentChapter } from "./ChapterRail.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { BuildBenchmarks } from "./BuildBenchmarks.js";
import { CutList, type Surplus } from "./CutList.js";
import { BracketPanel } from "./BracketPanel.js";
import { SpeedPanel } from "./SpeedPanel.js";
import { TableTalkLine } from "./TableTalk.js";
import { tableTalk } from "../lib/table-talk.js";
import { FirstTurns } from "./FirstTurns.js";
import { firstTurns } from "../lib/first-turns.js";
import { LegalityPanel } from "./LegalityPanel.js";
import { RecognitionPanel } from "./RecognitionPanel.js";
import { DeckGauges } from "./DeckGauges.js";
import { UnmetConditions } from "./UnmetConditions.js";
import { ManaAvailability } from "./ManaAvailability.js";
import { ManaCurveChart } from "./ManaCurveChart.js";
import { ManaTimeline } from "./ManaTimeline.js";
import { LandMathChart } from "./LandMathChart.js";
import { HighSynergyCards } from "./HighSynergyCards.js";
import { PlanThemes } from "./PlanThemes.js";
import { OrbitView } from "./OrbitView.js";
import { OrbitOverlay } from "./OrbitOverlay.js";
import { RoleShelves, roleShelves } from "./RoleShelves.js";
import { buildEngineModel } from "../lib/engine-model.js";
import { chooseCuts, swapCandidates } from "../lib/cut-choice.js";
import { mainTheme } from "../lib/main-theme.js";
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CoveragePanel } from "./CoveragePanel.js";
import { Findings } from "./Findings.js";
import { StrengthenLists } from "./SuggestedCards.js";
import { useSuggestions } from "../lib/suggestions.js";
import type { RunDiff } from "../lib/run-diff.js";
import { unreadCardNames } from "../lib/unread.js";
import { primaryType } from "../lib/deck-shape.js";
import { themeMatrix } from "../lib/theme-matrix.js";
import { CardLinksContext } from "./card-menu.js";
import { DeckSky, SkyContext, SkyThemeContext, type SkyLight } from "./DeckSky.js";
import { TurnSky } from "./TurnSky.js";
import { linksFrom } from "../lib/deck-sky.js";

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
export function ReportChapters({ data, diff, assumptions, assumptionsSet }: {
  data: AnalyzeResponse; diff?: RunDiff | null;
  /** The game-state controls, shown folded in the Glance hero. */
  assumptions?: React.ReactNode;
  assumptionsSet?: string;
}) {
  const { report } = data;
  const current = useCurrentChapter();
  /** The ranked themes, or null where the engine found nothing to rank; the unranked groups then
   *  keep the chapter from saying nothing. */
  // Mana value by card name, face or physical, for the bracket panel's combo costs.
  const manaValueOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of report.cards) { if (r.manaValue !== undefined) { m.set(r.name, r.manaValue); if (r.cardName) m.set(r.cardName, r.manaValue); } }
    return (n: string) => m.get(n);
  }, [report.cards]);
  // WHAT THE DECK DOES ON TURNS 1-5, read off the report (lib/first-turns.ts). Lands by the graph's
  // type line, front face only: a basic has no role on the report, and an MDFC with a land back is
  // still a spell.
  const turns = useMemo(() => {
    const lands = new Set<string>();
    for (const n of data.graph?.nodes ?? []) {
      if (/\bland\b/i.test((n.typeLine ?? "").split("//")[0]!)) lands.add(n.cardName ?? n.id);
    }
    return firstTurns(report, (name) => lands.has(name));
  }, [report, data.graph]);
  const talk = useMemo(() => tableTalk(report, data.graph, manaValueOf), [report, data.graph, manaValueOf]);
  const themes = useMemo(() => {
    if (!data.graph) return null;
    const m = buildEngineModel(report, data.graph);
    return m.totalLinks ? m : null;
  }, [report, data.graph]);
  /** THE GRAPH PAGE'S LAST PIECE, IN THE REPORT (owner, 2026-09-26: retire the Graph page and reach
   *  its pieces from here). The commander's orbit sits in Game plan, re-centred in place; "See
   *  links" on any card opens that card's orbit over the report, and Close returns to the line
   *  the reader left. */
  const commanderId = useMemo(() => {
    if (!themes) return null;
    const names = new Set(report.cards.filter((c) => c.isCommander).map((c) => c.cardName ?? c.name));
    return data.graph?.nodes.find((n) => !n.face && names.has(n.cardName ?? n.id) && themes.partners.has(n.id))?.id ?? null;
  }, [themes, report.cards, data.graph]);
  const [centre, setCentre] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<string | null>(null);
  const namedThemes = useMemo(() => mainTheme(report), [report]);
  /** "See how it connects" in any card's ⋯ menu opens that card's orbit over the report. */
  const links = useMemo(() => {
    if (!themes) return null;
    const byName = new Map<string, string>();
    for (const c of themes.cards.values()) if (!c.isToken && !c.faceOf && !byName.has(c.physical)) byName.set(c.physical, c.id);
    return { idOf: (name: string) => byName.get(name), show: setOverlay };
  }, [themes]);
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
      .filter((n) => n.face === undefined && n.isToken !== true && n.isCompanion !== true && primaryType(n.types) !== null)
      .map((n) => n.cardName ?? n.id),
    [data.graph],
  );

  /** CARDS NO THEME CLAIMS, the one fact the removed card-by-theme grid carried that a player acts
   *  on (owner, 2026-09-24: "as a player it is not useful"). It goes to the cut list, minus the cards
   *  that list already names and minus the unread, which fit no theme because nothing was read --
   *  `CutList` names those separately, with the right sentence. */
  const cuts = useMemo(() => chooseCuts(report, themes), [report, themes]);
  /** The over-target role groups, each with its cards: the rest of a trim, shown as the cards to
   *  pick from rather than as a count (appeal review 2026-09-26). */
  const surplus = useMemo((): Surplus[] => {
    const shelves = roleShelves(report, data.graph);
    return (report.slack ?? []).map((s) => {
      const leaves = report.buildParents?.find((p) => p.name === s.category)?.leaves ?? [s.category];
      const seen = new Set<string>();
      const cards = shelves.filter((sh) => leaves.includes(sh.category)).flatMap((sh) => sh.cards)
        // The commander fills roles too, and is never a cut.
        .filter((c) => !c.isCommander && !seen.has(c.id) && !!seen.add(c.id));
      return { name: s.category, count: s.count, target: s.target, over: s.over, cards };
    }).filter((g) => g.cards.length > 0);
  }, [report, data.graph]);
  const offTheme = useMemo(() => {
    const none = themeMatrix(report.archetypes, nonlandNames)?.unaffiliated ?? [];
    const skip = new Set([...cuts.map((c) => c.name), ...unreadCardNames(report.cards)]);
    return none.filter((n) => !skip.has(n));
  }, [report.archetypes, cuts, report.cards, nonlandNames]);

  const title = (id: ChapterId): string => CHAPTERS.find((c) => c.id === id)!.title;
  // ONE RUN PER REPORT, read by the findings (cards under each) and the lists below them (AO4).
  // PAIRED AGAINST THE PAGE'S CUT LIST (a folded twin stands in for its cut, it is not one), so every cut
  // shown can carry the card that takes its slot (baseline round 2026-09-26: "cuts and adds are not
  // one plan").
  // ...and the role cards a better card could replace in the same job (`swapCandidates`).
  const cutSky = useMemo((): SkyLight | null => {
    if (!themes) return null;
    const ids = new Set(cuts.map((c) => c.card?.id).filter((id): id is string => !!id && themes.cards.has(id)));
    if (!ids.size) return null;
    const lines = linksFrom(themes, ids);
    return {
      ids, lines,
      label: `The ${ids.size} possible cut${ids.size === 1 ? "" : "s"}, lit. ${lines.length ? `Each pink line is one card it works with: the fewer a cut has, the less the deck loses without it. A cut can sit inside a busy theme and still have few lines of its own.` : "Nothing ties them to the rest of the deck."}`,
    };
  }, [themes, cuts]);
  const cutNames = useMemo(() => [...cuts.map((c) => c.name), ...swapCandidates(report, cuts)], [report, cuts]);
  const suggestions = useSuggestions(data, cutNames);

  return (
    // `lg:pt-6`: the deck bar used to hold the chapters off the summary row; with its actions moved
    // into that row (2026-09-25) the first heading sat flush against the row's rule.
    <CardLinksContext.Provider value={links}>
    <SkyContext.Provider value={themes}>
    <SkyThemeContext.Provider value={namedThemes}>
    <div className="flex flex-col lg:flex-row lg:gap-10 lg:items-start lg:pt-6">
      <ChapterRail current={current} comboCount={data.report.combos?.length ?? 0} />
      {/* `min-w-0` so a wide child (the theme matrix, the cards table) shrinks inside the flex row
        *  instead of widening it — the narrow-width defence this repo has already paid for twice. */}
      <div className="flex flex-col gap-16 lg:gap-20 min-w-0 flex-1 pt-6 lg:pt-0">
        {overlay && themes ? (
          <OrbitOverlay report={report} graph={data.graph!} model={themes} focusId={overlay} onClose={() => setOverlay(null)} />
        ) : null}
        <Chapter id="read" title={title("read")}>
          {/* A deck the format would not let you play is not a deck this report can diagnose. It
            *  renders nothing when the deck is clean, which is every one of the 71 calibration
            *  decks. */}
          {/* A BROKEN RULE LEADS; A CLEAN DECK SAYS SO IN ONE LINE UNDER THE HERO (appeal review
            *  2026-09-26: a paragraph about deck-rule checks was the first thing on the page). */}
          {report.legality?.length ? <LegalityPanel legality={report.legality} companions={report.companions} /> : null}
          {/* THE HERO: what this deck IS, the commander's face, and whether it is any good -- and the
            *  waffle inside it is where a reader checks the engine's work card by card. */}
          {/* THE ONE LINE FOR THE TABLE, FIRST (owner, 2026-09-26: "the phone and one-line answer ... to
            *  be addressed"). The phone seat built it from four screens; under the hero it started 760px
            *  down a 844px phone, cut off, so it leads the chapter. */}
          {talk ? <TableTalkLine talk={talk} /> : null}
          <RecognitionPanel data={data} assumptions={assumptions} assumptionsSet={assumptionsSet}
            sky={themes ? <DeckSky model={themes} className="mx-auto w-full max-w-[30rem]" caption="Every card is a star. Each theme is a constellation, named in its colour; tap a name to light it, or a star to name it. The faint band at the edge is what no theme claims, and the lands." /> : undefined} />
          {report.legality?.length === 0 ? <LegalityPanel legality={report.legality} companions={report.companions} /> : null}
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
              Card names matched <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
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
            identity={report.identity}
            thing={report.thing}
            commanderCast={report.deckMath?.castability.commanders}
            manaAvailability={report.manaAvailability}
            coverage={report.coverage}
          />
          {/* THE TWO SCORES, ONCE (roadmap S15, owner call 2026-09-02). `HeadlineScores`' tiles
            *  used to sit directly under these dials printing the same two figures a third time,
            *  counting the sticky header — S7 made that visible and this is the call it was made
            *  for. The tiles were the only place either score said what it MEASURES, so those two
            *  `Explain` blocks moved onto the dials themselves and the component retired. */}
          <DeckGauges data={data} diff={diff} />
          <BracketPanel bracket={report.bracket} combos={report.combos} manaValueOf={manaValueOf} />
        </Chapter>

        <Chapter id="plan" title={title("plan")}>
          {/* THE DECK'S THEMES AND BEST PAIRS, RANKED, WITH THEIR CARDS (2026-09-26). They were the
            *  Graph tab's Overview, a second report beside this one; the owner's ruling was that the
            *  same report twice makes no sense, so they live in the chapter that asks what the plan
            *  is. They stand in for ArchetypeBoard's unranked pair groups, which said the same
            *  pairs again without an order. The archetype bars stay: a named-archetype reading the
            *  themes do not give. */}
          {themes && commanderId ? (
            <Movement title="What your commander works with" count="tap a card to see how, tap it again to put it in the middle">
              <OrbitView report={report} graph={data.graph!} model={themes} focusId={centre && themes.cards.has(centre) ? centre : commanderId} onFocus={setCentre} />
            </Movement>
          ) : null}
          {themes ? <PlanThemes report={report} graph={data.graph!} model={themes} onOpenCard={setOverlay} main={mainTheme(report)} /> : null}
          {/* THE ONE FIGURE THAT SAID NOTHING (S13). `cardSignals` in `matcher/src/analyze.ts`
            *  filters on `dc.tags`, so strategies, the groups and the membership matrix are all
            *  derived-only -- and this was the only coverage-limited surface on the page with
            *  neither a worded caveat nor the hatch. It gets `coverage` for the same reason
            *  `CutList` has it. */}
          {/* THE ARCHETYPE BARS ONLY WHERE THERE ARE NO THEMES (appeal review 2026-09-26). A fixed
            *  list of named archetypes ("Tokens 22%") beside the deck's own themes was a third name
            *  for the same deck, with a third number. With links to rank, the themes above say what
            *  the deck does; without them, the bars and the unranked groups still do. */}
          {themes ? null : (
            <ArchetypeBoard
              strategies={report.strategies}
              archetypes={report.archetypes}
              nonlandNames={nonlandNames}
              coverage={report.coverage}
            />
          )}
          {/* WHICH CARDS CARRY THE PLAN, IN THE CHAPTER THAT ASKS WHAT THE PLAN IS (roadmap T21).
            *  It used to sit in chapter 6, "What's wrong, and what do I do?", beside the cut list --
            *  and the owner's note was the whole argument: *"why high synergy table is in the fix
            *  chapter? It does not make any sense"*. A list of what is WORKING is not a repair. It
            *  is the other half of what `ArchetypeBoard` above says in aggregate: the groups say
            *  which mechanisms the deck runs, this says which cards are doing the running. */}
          {/* HOW THE DECK WINS, AND WHAT ITS CARDS WAIT FOR, IN THE CHAPTER ABOUT ITS PLAN (appeal
            *  review 2026-09-26). They sat at the end of Roles, a chapter about counting jobs, where
            *  every seat read them as a grey tail after the card shelves. */}
          {report.deckMath ? (
            // No title of its own: its sections are headed "How you win" and "What your cards are
            // waiting for" already, and a third heading over them said the first one twice.
            <Movement count="its first turns, how fast it wins, and what its cards need from each other">
              <div className="max-w-5xl flex flex-col gap-8">
                {/* THE TURNS, AND BESIDE THEM THE SKY LIGHTING UP TURN BY TURN, where the panel is wide
                  *  enough for both; under them where it is not. */}
                {turns ? (
                  <div className="@container">
                    <div className="flex flex-col gap-6 @min-[52rem]:grid @min-[52rem]:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] @min-[52rem]:items-start">
                      <FirstTurns model={turns} />
                      {themes ? <TurnSky model={themes} turns={turns} /> : null}
                    </div>
                  </div>
                ) : null}
                <SpeedPanel report={report} manaValueOf={manaValueOf} />
                <BuildBenchmarks
                  categories={report.buildCategories}
                  parents={report.buildParents}
                  deckMath={report.deckMath}
                  answerCoverage={report.answerCoverage}
                  sections={["win", "waiting"]}
                  showBenchmarks={false}
                />
              </div>
            </Movement>
          ) : null}
          <HighSynergyCards cards={report.cards} />
        </Chapter>

        <Chapter id="mana" title={title("mana")}>
          <Movement count="the numbers behind the mana suggestions below">
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
          {/* THE CARDS LEAD, the counts follow (2026-09-26): the Graph tab's "Cards judged by their
            *  job" moved here, so a role's number and the cards it counts sit in one chapter. */}
          <Movement title="Your cards, by the job they do" count="cards that do two jobs sit on both shelves">
            <RoleShelves report={report} graph={data.graph} />
          </Movement>
          {/* THE SHELVES ARE THE ROLE COUNTS (owner, 2026-09-26: "first you have whole card by card
            *  breakdown and then this one which is duplicate"). "How the roles are spent" drew the
            *  same counts again as bars under the shelves, which already print each count against
            *  its target, so only the answers stay here. */}
          <Movement count="which of your cards remove their permanents">
            <BuildBenchmarks
              categories={report.buildCategories}
              parents={report.buildParents}
              deckMath={report.deckMath}
              answerCoverage={report.answerCoverage}
              // Answers stay: they break down the interaction role. How it wins and what the cards
              // wait for moved to Game plan.
              sections={["answers"]}
              showBenchmarks={false}
            />
          </Movement>
        </Chapter>

        <Chapter id="fix" title={title("fix")}>
          <Findings report={report} diff={diff} suggestions={suggestions} />
          {/* Adds and cuts are ONE decision — "which five come out for the eight that go in" — so
            *  they sit beside each other rather than eight panels apart. */}
          {/* THE GRID HAD ONE CHILD AND STILL RESERVED TWO COLUMNS (roadmap T11). It was built to
            *  sit the cut list beside the high-synergy list -- "which five come out for the eight
            *  that go in" -- and T21 moved that other list to the Game plan chapter, where a list of
            *  what is WORKING belongs. What was left was a two-column grid holding one panel, so
            *  half the row was reserved for nothing at every width above 1280px. A defect I
            *  introduced two commits ago and did not look at. */}
          <Movement title="What to change">
            {/* 64rem, the width of the Fixes list above it: a cut's name and its "5 mana - 0.0"
              *  sat 1,700px apart at 1920px (UI review 2026-09-25). */}
            {/* THE CUTS ON THE DECK'S SKY (owner, 2026-09-27: the sky in every chapter): the cards
              *  doing the least, lit, with every link they have in pink -- a few thin threads into
              *  the deck is the case for cutting them, drawn. Beside the list on a wide screen,
              *  where it stays while the list scrolls; above it on a phone. */}
            <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,64rem)_minmax(0,22rem)] xl:items-start xl:gap-8">
            {cutSky ? (
              <div className="flex w-full max-w-[26rem] flex-col gap-2 xl:order-2 xl:sticky xl:top-[calc(var(--site-header-h,0px)+var(--report-header-h,0px)+1rem)]">
                <DeckSky model={themes!} lit={cutSky} className="w-full" />
                {/* WHY EACH IS A CUT, BESIDE THE PICTURE (persona round, 2026-09-27: "nothing on the
                  *  sky says why any of them is a cut", and many lines read as "important"). Each
                  *  cut's links counted, and a win plan it is on named. */}
                <ul className="flex flex-col gap-1 text-sm" aria-label="The possible cuts on the sky">
                  {cuts.filter((c) => c.card && cutSky.ids.has(c.card.id)).map((c) => {
                    const n = cutSky.lines!.filter(([a]) => a === c.card!.id).length;
                    const plans = c.keeps.filter((k) => k.startsWith("it is one of the cards your win plan")).map((k) => k.replace(/^it is one of the cards your win plan of (.+) counts$/, "$1"));
                    return (
                      <li key={c.name}>
                        <b>{c.name.split(" // ")[0]}</b>
                        <span className="text-(--muted)"> · {n === 0 ? "works with nothing else here" : `works with ${n} card${n === 1 ? "" : "s"}, counting the ones only once`}{plans.length ? ` · also on the win plan: ${plans.join(", ")}` : ""}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <div className="max-w-5xl min-w-0">
            <CutList
              cuts={cuts}
              unjudged={report.unjudged}
              coverage={report.coverage}
              slack={report.slack}
              offTheme={offTheme}
              surplus={surplus}
              // EACH CUT CARRIES THE CARD THAT TAKES ITS SLOT, whatever the job (spec §3).
              pairs={suggestions.value?.pairs}
              deckSize={data.totalCount}
            />

            </div>
            </div>
          </Movement>
          {/* WHAT GROWS THE PLAN, last in the chapter: nothing is wrong here, so it follows the fixes.
            *  A failed run drops the section rather than claiming the deck has nothing to add. */}
          {suggestions.state !== "error" ? (
            <Movement title="Strengthen what works">
              <div className="max-w-5xl">
                <StrengthenLists routes={suggestions.value?.routes} plan={suggestions.value?.plan} />
              </div>
            </Movement>
          ) : null}
        </Chapter>
      </div>
    </div>
    </SkyThemeContext.Provider>
    </SkyContext.Provider>
    </CardLinksContext.Provider>
  );
}
