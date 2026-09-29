import { Fragment, useState, type ReactNode } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL as LABEL } from "../lib/build-category-labels.js";
import { CardSymbol } from "./CardSymbol.js";
import { Explain } from "./Explain.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { CardName, useAdded } from "./card-drawer.js";
import { WinPlans } from "./WinPlans.js";
import { policyBand } from "@edh-seer/engine/percent";
import { bandState } from "../lib/deck-gauge.js";
// NOTHING IS VALUE-IMPORTED FROM @edh-seer/matcher HERE -- CRITICAL REGRESSION, FIXED (2026-08-21). A
// prior deep import of `GRAVEYARD_HATE_SHARE` from `@edh-seer/matcher/src/answer-coverage.js` (reasoned
// as skipping the barrel's node:fs-touching re-export of `analyze.js`) was itself fatal: that file
// imports `poolShare`/`POOL_CLASSES` from `./answer-pool.js`, which reads `answer-pool.json` via a
// MODULE-SCOPE `readFileSync("node:fs")` -- not lazy, not inside `loadAnswerPool`'s function body as
// the removed comment claimed. Vite externalises `node:fs` for the browser, so the module graph died
// on load and the app never mounted (white screen, "Cannot access node:fs.readFileSync in client
// code"). No subpath of `@edh-seer/matcher` is safe to value-import from client code; see `HATE_COUNTS`
// below for the hand-copy this now falls back to, and `land-math.ts` for the one library (`@edh-seer/
// engine/hypergeometric`) that genuinely has no fs dependency and can be reached this way.

/** Scored here and NOT listed as a benchmark row: the land count is reported once, by the block
 *  below, which derives its target from this deck's own curve instead of the flat 36 every deck was
 *  measured against. `buildScore` now reads the SAME target (task 9, 2026-08-21) -- `gatedLandsTarget`
 *  plus whatever `ARCHETYPE_TARGET_DELTAS` adds for this deck's primary archetype, both applied via
 *  the identical `adjustedTargets` call the score itself makes -- so this row and the score can no
 *  longer disagree about which number this deck is being held to. One thing can make `target` differ
 *  from `rawTarget`, and the row names it: an archetype delta folded in (`lands.archetypeDelta`). */
const REPORTED_ELSEWHERE = new Set(["lands"]);

/** Where the target sits on a benchmark track, as a fraction of its width.
 *
 *  THE BAR USED TO CLAMP AT THE TARGET, so `13/10`, `4/4`, `14/10`, `1/1` and `37/36` all painted
 *  one identical full-width bar -- five of six rows carrying no information, and a land count 4 OVER
 *  its target drawing exactly like a ramp count 1 UNDER it. Parking the target at 70% leaves the
 *  remaining 30% for overshoot, so a row that clears its target visibly runs past the mark and a row
 *  that misses stops short of it. */
const TARGET_MARK = 0.7;

/** A probability as whole percent. Deliberately coarse: these figures carry a stack of stated
 *  biases (no mulligans, no opponent, draw ignored), and a decimal point would dress that up as
 *  precision it does not have. */
const pct = (p: number): string => `${Math.round(p * 100)}%`;

/** How far the colour-blind figure must sit above the real one before the panel says the problem is
 *  COLOUR. Below this the two numbers say the same thing and the second is noise. Matches the CLI. */
const COLOUR_GAP = 0.05;

/** A policy interval, collapsed to ONE figure when the two ends round the same. "91% - 91%" reads as
 *  a broken readout -- I11 settled that for the simulation's own rows, and the first cut of this
 *  panel reproduced it on the diagnostic line. Found in a live browser, not by a test. */
const band = (b: { low: number; high: number }): string => policyBand(b.low, b.high);

/** A CAVEAT, ONE CLICK AWAY — `Explain` under this panel's own label, since everything folded here
 *  is a statement about what a figure IGNORES rather than what it means.
 *  → `specs/2026-08-20-report-usability-review.md` §4 */
function Caveat({ label = "what this number ignores", children }: { label?: string; children: ReactNode }) {
  return <Explain label={label}>{children}</Explain>;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

// The demand vocabulary now lives in `lib/demand-sentence.ts` so `lib/findings.ts` can reach it
// without a lib -> component import. Re-exported here because this file is where every existing
// caller and the completeness test already look for it.
/** `DEMAND_VERB`/`DEMAND_PHASE`/`DEMAND_SUBJECTLESS` are re-exported ONLY for the completeness test
 *  (`components.test.tsx`), which walks them against `@edh-seer/tagger`'s `VERB_VOCAB` and
 *  `@edh-seer/matcher`'s `PHASE_VERBS` — the two engine lists that define what a census key's verb half
 *  can ever be. Not a public API otherwise; read `demandSentence` if you want the rendering. */
import { demandSentence, DEMAND_VERB, DEMAND_PHASE, DEMAND_SUBJECTLESS } from "../lib/demand-sentence.js";
import { cardsSubject, lastingRamp } from "../lib/findings.js";
export { demandSentence, DEMAND_VERB, DEMAND_PHASE, DEMAND_SUBJECTLESS };

/** Stable ids for the four deck-math groups. The sub-tabs route these to three different panels,
 *  and they select by ID rather than by the visible title so a copy edit cannot silently unwire a
 *  tab. */
export type DeckMathSectionId = "cast" | "answers" | "win" | "waiting";

export function BuildBenchmarks({
  categories, parents, deckMath, answerCoverage, sections, showBenchmarks = true,
}: {
  categories: DeckReport["buildCategories"];
  /** The four Command-Zone template groups (`computeBuild`'s `buildParents`). The parent's OWN
   *  count-against-target row moved to `DeckGauges`, as a floor dial (whole-branch review fix,
   *  2026-09-01; see the group-header comment where it used to render, below) — this prop stays
   *  because it is still what GROUPS the leaf rows under their parent's name and gates which
   *  leaves render at all (a leaf under a parent whose own target is <= 0 is unscored and stays
   *  hidden, the same treatment a zero-target ungrouped leaf already gets). The engine owns the
   *  grouping; there is no local `PARENTS` const to fall out of sync with it any more. */
  parents?: DeckReport["buildParents"];
  deckMath?: DeckReport["deckMath"];
  /** Carries `graveyardVulnerability` (task 5) down to the answers block — the only reason this
   *  panel needs it is to decide whether the graveyard-hate sentence below is a finding about THIS
   *  deck or noise on every deck. */
  answerCoverage?: DeckReport["answerCoverage"];
  /** Which of the four deck-math groups to render, by id. Omitted renders all four -- the current
   *  single call site relies on that. */
  sections?: readonly DeckMathSectionId[];
  /** Suppresses the WHOLE category/parent block -- the "How the roles are spent" heading, the
   *  `scoredParents` group headers and their leaf rows, and the `ungrouped` bars -- not just the
   *  rows inside it. Default `true` so every call site before task 5's fix round is unchanged.
   *
   *  WHY THIS EXISTS (controller ruling, fix round 1, 2026-09-01): the Overview sub-tabs
   *  (`OverviewTab.tsx`) call this component three times -- Build, Mana, Engine -- and until this
   *  prop existed, `sections`/`only` only filtered `DeckMathRows`, so the category/parent block
   *  (Consistency, Interaction, their leaves, any ungrouped bar) rendered identically on all three,
   *  three times over. Only Build owns those leaves now; Mana and Engine pass `false` so this
   *  component contributes just its `sections`-filtered `DeckMathRows` there.
   *
   *  A heading over nothing is the same broken-heading shape C1 (whole-branch review, 2026-09-01)
   *  found and fixed elsewhere in this file, so this suppresses the heading along with the rows —
   *  see the `hasBenchmarkContent` guard below for the render-nothing-not-an-empty-shell case. */
  showBenchmarks?: boolean;
}) {
  if (!categories || categories.length === 0) return null;
  const countByLeaf = new Map(categories.map((c) => [c.category, c.count]));
  // A FACET IS SAID BESIDE THE COUNT, NEVER ADDED TO IT. "Draw 14 · 5 engines · 3 unlabelled":
  // the owner's point (2026-09-05) was that ten draw engines and ten one-shot cantrips read as the
  // same 10, and the target is a raw count, so the split is annotation rather than a second dial.
  const facetTextByLeaf = new Map(categories.map((c) => [
    c.category,
    Object.entries(c.facets ?? {}).map(([name, n]) => `${n} ${name}`).join(" · "),
  ]));
  const groupedLeaves = new Set((parents ?? []).flatMap((p) => p.leaves));
  // Anything no parent names (burn, stax) renders after them, exactly as before this task -- those
  // are win-plan and tax signals, never build roles, and each still carries its OWN target (today
  // always 0, per `build.ts`'s `BASE_TARGETS`, so nothing renders here in practice).
  const ungrouped = showBenchmarks
    ? categories.filter((c) => c.target > 0 && !REPORTED_ELSEWHERE.has(c.category) && !groupedLeaves.has(c.category))
    : [];
  // FIX F2 (controller review, 2026-08-21), REVISED (whole-branch review fix, 2026-09-01): the
  // parent's own ratio bar is gone (moved to `DeckGauges` as a floor dial, see the group-header
  // comment below), so this no longer guards a divide-by-zero -- there is no `count / target` left
  // at the parent level to divide. What it still gates is WHICH parents get a header and leaves at
  // all: `build.ts`'s own scoring loop skips a parent whose target is <= 0 outright ("neutral,
  // unscored"), and this mirrors that skip so a reader never sees a group of leaves reporting share
  // of a parent the score itself ignored -- the same "not scored, so not shown" convention
  // `ungrouped` above already applies to a leaf.
  const scoredParents = showBenchmarks ? (parents ?? []).filter((p) => p.target > 0) : [];
  // NOTHING TO SHOW, NOT AN EMPTY SHELL (fix round 1, 2026-09-01): when the benchmark block is
  // suppressed, `scoredParents`/`ungrouped` are already forced empty above, so this collapses to
  // "no deckMath either" -- exactly the "render nothing" case the controller ruling asked for.
  //
  // IT HAS TO TEST WHAT ACTUALLY RENDERS (MINOR 7, whole-branch review, 2026-09-01). A scored
  // parent draws NOTHING unless it has more than one leaf -- a single-leaf parent's group header
  // and its one leaf row would just restate the count its `DeckGauges` dial already prints -- so
  // `scoredParents.length > 0` was guarding a different thing than it claimed: a `buildParents` of
  // only single-leaf parents (Ramp, Board wipes) passed the guard and produced the heading over an
  // empty `<ul>`, the exact broken-heading shape the comments around it exist to prevent.
  const hasBenchmarkContent = scoredParents.some((p) => p.leaves.length > 1) || ungrouped.length > 0;
  if (!hasBenchmarkContent && !deckMath) return null;
  /** WHICH PARENT THE SCORE'S COVERAGE MULTIPLIER APPLIES TO, BY FLAG AND NEVER BY NAME (I2,
   *  whole-branch review, 2026-09-01). The dock note in `DeckMathRows` below used to spell
   *  "Interaction" into its prose, which is worse than an unwired selector: after a rename in
   *  `build.ts` the note would still render and would still assert the OLD name, so the reader is
   *  told a confident falsehood rather than shown a gap. `coverageWeighted` is the engine's own
   *  marker for the one parent whose attainment it multiplies by `answerCoverage.coverage`; the
   *  name travels with the flag, so renaming the parent renames the sentence. */
  const coverageWeightedName = (parents ?? []).find((p) => p.coverageWeighted)?.name;

  /** ONE BAR SHAPE, geometry and `TARGET_MARK` unchanged since before grouping existed. The parent's
   *  OWN ratio bar (the thing this shape was built to draw for four rows -- CONSISTENCY 15/14 ✓ and
   *  the like) moved to `DeckGauges` as a floor dial (whole-branch review fix, 2026-09-01; see the
   *  group-header comment below) and never came back, so the only caller left is `ungrouped` -- a
   *  leaf with no parent at all. `forceFlag` and `suffix` were parameters only the deleted parent
   *  row ever passed (the Interaction coverage-dock tick and its on-screen note) and are gone with
   *  it (I4, fix round 2, 2026-09-01) --
   *  `ungrouped`'s one caller has never needed either.
   *
   *  KEPT, AND ITS TEST WITH IT (IMPORTANT 6, whole-branch review, 2026-09-01). `ungrouped` is
   *  empty on every deck today because `build.ts`'s `BASE_TARGETS` gives burn and stax a target of
   *  0 -- that is DATA, not an unreachable code path, and one target change brings this shape
   *  straight back onto the screen. The defect the review found was the deleted geometry test, not
   *  the geometry: `components.test.tsx` pins the 42%/98% fills and the target mark's position
   *  against a fixture that produces an ungrouped category, so an unrendered path is still a
   *  measured one. */
  const bar = (
    key: string, label: ReactNode, ariaName: string, count: number, target: number, note = "",
  ) => {
    const flagged = count < target;
    const state = flagged ? "under target" : "on target";
    const fill = Math.max(0, Math.min(1, (count / target) * TARGET_MARK));
    return (
      <li key={key} className="flex flex-col gap-0.5" aria-label={`${ariaName} ${count} of ${target}, ${state}${note}`}>
        <div className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-sm">{label}</span>
          <span className="relative flex-1 h-2 rounded-full bg-(--separator) overflow-hidden">
            <span
              className={`absolute inset-y-0 left-0 rounded-full ${flagged ? "bg-(--warning)" : "bg-(--success)"}`}
              style={{ width: `${+(fill * 100).toFixed(2)}%` }}
            />
            {/* The target itself, so a row is read against a landmark rather than against the
              *  end of its own track. Every row's mark sits at the same x, which is what makes
              *  rows with different targets comparable at a glance. */}
            <span
              className="absolute inset-y-0 w-px bg-(--foreground) opacity-70"
              style={{ left: `${TARGET_MARK * 100}%` }}
            />
          </span>
          <span className="w-14 shrink-0 text-right text-sm stat-num">{count}/{target}</span>
          <span className={`w-4 shrink-0 text-sm ${flagged ? "text-(--warning)" : "text-(--success)"}`} aria-hidden>{flagged ? "▲" : "✓"}</span>
        </div>
      </li>
    );
  };

  /** A LEAF UNDER A MULTI-LEAF PARENT — count and SHARE, never a target, ratio or flag (owner's
   *  ruling: "only a parent can be under target"). A single-leaf parent (Ramp, Board wipes) never
   *  calls this: its one leaf row would restate its group header's own total as "100%", which is
   *  the exact duplicate the folded shape exists to avoid.
   *
   *  SHARE IS OF THE LEAF SUM, NOT THE PARENT'S UNION (fix F4). Interaction's leaves summed to 9
   *  against a union of 8 (one card fills two), so dividing by the union read 114% across the row
   *  -- a distribution that doesn't total 100% reads as a broken number on a panel whose whole
   *  argument is that its numbers mean what they say. Dividing by the leaf sum instead makes every
   *  row's shares total 100% ALWAYS, by construction.
   *
   *  AND THE DENOMINATOR IS ON THE SCREEN (C1, whole-branch review, 2026-09-01). Fix round 2 moved
   *  the parent row to Recognition and took the leaf sum and the overlap note with it, which left
   *  "Draw 6 · 67%" sitting under no visible whole -- and the only number a reader could find, the
   *  "Consistency" dial's value of 8 on `DeckGauges` (Recognition itself carries no role counts at
   *  all any more, see the group-header comment below), is the parent's UNION rather than this sum,
   *  so 8 x 67% = 5.4 and not 6. A share whose whole is missing invites exactly that arithmetic, and
   *  a silently wrong answer is the one thing this repo ranks below a missing one. The group header
   *  above these rows prints `sumOfLeaves`, and says why it can exceed the union. */
  const leafRow = (category: string, parentName: string, sumOfLeaves: number) => {
    const name = LABEL[category] ?? category;
    const count = countByLeaf.get(category) ?? 0;
    const share = sumOfLeaves > 0 ? Math.round((count / sumOfLeaves) * 100) : 0;
    const facetText = facetTextByLeaf.get(category) || "";
    return (
      <li key={category} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-0 text-sm text-(--muted)" aria-label={`${name} ${count}, ${share}% of ${parentName}${facetText ? `, ${facetText}` : ""}`}>
        {/* FIX F3 (controller review, 2026-08-21): `w-24` with a `pl-3` indent left only 84px for
          *  the label text, and three real leaf names need more -- "Stack interaction" measures
          *  121px, "Graveyard hate" 110px, "Card selection" 105px, all truncating (the graveyard one
          *  dangerously: "Graveyard …" reads as either hate or recursion, opposite things). Widened
          *  to `w-36` (144px, clears the widest with room to spare) and the indent DROPPED -- the
          *  missing bar/ratio/flag and the muted colour already mark a leaf row as subordinate, so
          *  the indent was decorative, not load-bearing, and it was the thing costing the width. */}
        <span className="w-36 shrink-0 truncate">{name}</span>
        {/* THE SHARE IS DRAWN, NOT ONLY SPELLED (roadmap T20). Owner: *"section like Does it play
          *  enough of each role? is ugly numbers and text and contradicts our dataviz rule"* -- and
          *  the `flex-1` these numbers sat in was empty space the length of the row. The track is
          *  the same one the PARENT rows above already use, at half the height: a leaf is
          *  subordinate to its group and reads that way without inventing a second bar vocabulary.
          *
          *  ONE HUE, and a share of the group rather than of the deck. `sumOfLeaves` is the
          *  denominator the number beside it already uses, so the bar and the percentage cannot
          *  disagree -- they are one value rendered twice, which is the only safe way to do both.
          *  A zero-count leaf draws NO bar rather than a sliver: a 4px stub reads as "some". */}
        <span className="flex-1 min-w-8 h-1 bg-(--separator) rounded-full overflow-hidden" aria-hidden="true">
          {share > 0 ? (
            <span className="block h-full rounded-full bg-(--fill)" style={{ width: `${share}%` }} />
          ) : null}
        </span>
        {/* BEFORE the count, so the count column every row shares stays right-aligned; the bar
          *  (flex-1) gives up the width, which is the one thing on the row that can. */}
        {/* BELOW `sm` THE FACET TAKES ITS OWN LINE (D3, 2026-09-06): name + facet + count measured
          *  465px on a 390px phone and the whole PAGE scrolled sideways. */}
        {facetText ? <span className="shrink-0 text-xs stat-num basis-full sm:basis-auto order-last sm:order-none pl-0 sm:pl-0">{facetText}</span> : null}
        <span className="w-20 shrink-0 text-right stat-num">{count} · {share}%</span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Suppressed on the Mana and Engine sub-tabs (`showBenchmarks={false}`) -- see the prop's
        *  own doc comment above for why. The heading is suppressed WITH the rows, never left over
        *  it, for the same "no empty shell" reason `hasBenchmarkContent` guards the whole
        *  component's early return.
        *
        *  AND GATED ON `hasBenchmarkContent` TOO (residual fix, 2026-09-01): the early return above
        *  only skips the WHOLE component when there is neither benchmark content nor `deckMath` --
        *  so a call with `deckMath` present (the Build sub-tab, always) and a `buildParents` of only
        *  single-leaf parents used to clear that return and then render this heading over the empty
        *  `<ul>` the single-leaf filter leaves behind. `hasBenchmarkContent` is exactly the flag that
        *  already knows the list will be empty; the heading needs the same guard the list itself
        *  effectively has. */}
      {showBenchmarks && hasBenchmarkContent && (
        <>
          {/* RENAMED FROM "Build benchmarks" (C1, whole-branch review, 2026-09-01). A benchmark is
            *  a figure against a LIMIT, and there is no longer a limit anywhere under this heading:
            *  the four parent counts-against-target moved to `DeckGauges`, as a floor dial per
            *  parent -- the whole point of that move is that `DeckGauges` is the panel now allowed
            *  to make that judgement, where Recognition never was -- and what is left under THIS
            *  heading is group headers over `count · share%` rows with no target in sight. The word
            *  labelled nothing it still contained. The heading now describes what the block
            *  actually is -- the four role groups and how this deck's cards are distributed inside
            *  each -- and the verdict on whether a group is big enough stays where it became a
            *  sentence, in `Findings` (now on the Fixes tab).
            *
            *  It is the parent of a variable number of h4s: one per multi-leaf parent group (the
            *  header just below). The four deck-math question sections further down are h3s of
            *  their own, siblings of this one rather than children -- they answer a different
            *  question and are routed to different sub-tabs. Foreground weight is the whole
            *  difference from a child heading; the children keep the muted eyebrow. */}
          <h3 className="eyebrow text-(--foreground)">How the roles are spent</h3>
          {/* Rows in 28rem cells so the count sits beside its row; more across when wide (#770).
            *  A GROUP OF LISTS, NOT ONE LIST WITH HEADER ROWS (#735): a `<li role="presentation">`
            *  header among the leaf rows broke the list for a screen reader (axe: a `<ul>` must
            *  only directly contain `<li>`). Each parent is now a labelled group holding its
            *  header and its own list, so every `listitem` is still a leaf row. */}
          <div className="flex flex-col gap-1.5">
            {/* THE FOUR PARENT COUNTS-AGAINST-TARGET MOVED TO `DeckGauges`, one floor dial per
              *  parent, on the Summary sub-tab. That is where a reader now sees Interaction's 19
              *  against its target of 10 as a mark; printing the same ratio here as well would put
              *  the same four numbers on one screen twice. The TARGETS did not move in the sense of
              *  changing what they gate: whether 17 ramp is enough is still a diagnosis, and
              *  `Findings` (now on the Fixes tab) states it as a sentence.
              *
              *  THE NAME DID NOT MOVE WITH THEM, and C1 (whole-branch review, 2026-09-01) is why it
              *  is back below as a header -- with the LEAF SUM beside it and still no target, tick
              *  or bar. Two rounds of that review said the same thing twice: without the name a
              *  multi-leaf parent's leaves had no on-screen label, and without the sum their SHARE
              *  figures had no on-screen whole. `DeckGauges` carries the parent's UNION count, as
              *  the dial's value; this header carries the sum the shares below it are shares OF, and
              *  the two differ whenever a card fills two leaves, which is why the header says so out
              *  loud rather than leaving a reader to reconcile 8 against 9 across two sub-tabs. */}
            {scoredParents.map((p) => {
              // Still shared by every leaf beneath this parent (the share denominator) -- see the
              // doc comment on `leafRow` for why it reads this.
              const sumOfLeaves = p.leaves.reduce((s, l) => s + (countByLeaf.get(l) ?? 0), 0);
              // Ordered by the parent's own `leaves` list, never re-sorted -- a parent groups its
              // leaves together on the page regardless of what order the engine happened to report
              // them in. Every leaf renders, including a zero-count one (tutor at 0 IS the finding
              // a combo deck's Consistency group is thin on). A single-leaf parent (Ramp, Board
              // wipes) renders nothing here, header included: its one leaf would just repeat the
              // parent's own count as "100% of Ramp", the exact duplicate the folded shape already
              // avoided before this task, and a header over nothing would be the same broken-
              // heading shape C1 found.
              return p.leaves.length > 1 ? (
                <div key={p.name} role="group" aria-label={p.name} className="flex flex-col gap-1.5">
                  <div
                    data-testid={`role-group-${p.name}`}
                    className="flex items-baseline gap-3 flex-wrap pt-1"
                  >
                    <h4 className="eyebrow text-(--muted)">{p.name}</h4>
                    {/* THE WHOLE, IN A PLAYER'S WORDS AND NOT AS A FORMULA. "sum of leaves = 9" is
                      *  what the code calls it; what a reader needs is "these rows are shares of
                      *  nine cards, and nine is more than the eight cards you own because one of
                      *  them does two of these jobs". Stated only when the two figures actually
                      *  differ -- on a parent with no overlap the second clause would be a
                      *  disclosure about nothing. */}
                    <span data-testid={`role-group-total-${p.name}`} className="text-xs text-(--muted)">
                      {sumOfLeaves > p.count ? (
                        <>
                          <span className="stat-num">{sumOfLeaves}</span>
                          {" counted across "}
                          <span className="tabular-nums">{plural(p.count, "card")}</span>
                          {" — some fill two of these roles"}
                        </>
                      ) : (
                        <span className="tabular-nums">{plural(sumOfLeaves, "card")}</span>
                      )}
                    </span>
                  </div>
                  <ul className="grid gap-x-8 gap-y-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,28rem),1fr))]">
                    {p.leaves.map((leaf) => leafRow(leaf, p.name, sumOfLeaves))}
                  </ul>
                </div>
              ) : null;
            })}
            {ungrouped.length ? (
              <ul className="grid gap-x-8 gap-y-1.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,28rem),1fr))]">
                {ungrouped.map((c) => bar(c.category, LABEL[c.category] ?? c.category, LABEL[c.category] ?? c.category, c.count, c.target))}
              </ul>
            ) : null}
          </div>
        </>
      )}

      {deckMath ? (
        <DeckMathRows
          deckMath={deckMath}
          answerCoverage={answerCoverage}
          only={sections}
          coverageWeightedName={coverageWeightedName}
          rampCards={parents?.find((p) => p.key === "ramp")?.count}
        />
      ) : null}
    </div>
  );
}

/** The corpus count of RECURRING graveyard hate by type -- the pieces that shut an engine off
 *  rather than eating one card. Measured from `graveyardHateRecurring`, `answer-coverage.ts`'s
 *  `GRAVEYARD_HATE_SHARE` (creature 39 · artifact 19 · enchantment 8, n = 66 typed, 1 other).
 *  Stated as a literal because it is a fact about the FORMAT, not about this deck, and a reader can
 *  check it. A HAND-COPY, and it has to stay one -- `GRAVEYARD_HATE_SHARE` carries the SHARE (a
 *  fraction of 66), this the raw COUNT the sentence below reads aloud, and the two do not round-trip
 *  cleanly enough to derive one from the other at display time. `answer-coverage.ts`'s own doc
 *  comment names this file as the one place that has to move if that table is ever re-measured
 *  (whole-branch review IMPORTANT 2) -- there is no code link between them, only that comment on
 *  both ends.
 *  CORRECTED 2026-08-21 (residual fix wave): was 36/16/6 (n=58), a subset the original probe
 *  produced by nesting inside the wrong branch -- see `answer-coverage.ts`'s `GRAVEYARD_HATE_SHARE`
 *  for the diagnosis. */
const HATE_COUNTS = { creature: 39, artifact: 19, enchantment: 8 } as const;
/** THIS FILE CANNOT IMPORT `GRAVEYARD_HATE_SHARE` -- it is client code, and `answer-coverage.ts`
 *  transitively pulls in `node:fs` through `answer-pool.ts`'s module-scope `readFileSync`, which is
 *  fatal in the browser (see the top-of-file comment; this is the regression that comment documents).
 *  `packages/matcher/src/bin/gen-answer-pool.ts --check` reads THIS FILE as text alongside
 *  `answer-coverage.ts`'s own table and fails on drift, so the two constants cannot silently
 *  disagree even without a code-level import. If you are tempted to import the table directly:
 *  don't, it breaks the app. Hand-copy `HATE_COUNTS` instead and let the gate catch drift.
 *
 *  WHICH CLASSES THE GRAVEYARD SENTENCE CAN NAME -- derived from `HATE_COUNTS`'s own non-zero,
 *  non-creature rows (whole-branch review MINOR 6), not a second hardcoded
 *  `["artifact", "enchantment"]` a few lines below that had no link back to the table it was
 *  standing in for. `creature` is excluded because every deck answers creatures (design §2.2: zero
 *  of the 71 calibration decks read a creature-removal zero), so citing it here would be citing a
 *  threat this sentence has never once needed to name. */
const HATE_CLASSES = (Object.keys(HATE_COUNTS) as (keyof typeof HATE_COUNTS)[]).filter(
  (c) => c !== "creature" && (HATE_COUNTS[c] ?? 0) > 0,
);
/** Below this the deck does not have a graveyard PLAN, it has some graveyard cards. Measured
 *  (design §2.4): 16 of the 71 calibration decks clear it, 33 clear 0.2 -- 0.3 is where the top of
 *  the distribution is aristocrats and reanimator decks rather than incidental recursion. */
const VULNERABLE = 0.3;

/** The deck-math readouts, folded in under the category bars (project owner's call) rather than
 *  given their own tab: they answer the same question the benchmarks do -- "is this deck built" --
 *  and the counts above are what they reprice.
 *
 *  A benchmark says "6 ramp, want 10". These say what that means in a game you actually play. */
function DeckMathRows({
  deckMath, answerCoverage, only, coverageWeightedName, rampCards,
}: {
  /** The Ramp role's count, so the land working can say how much of it the target leans on. */
  rampCards?: number;
  deckMath: NonNullable<DeckReport["deckMath"]>;
  answerCoverage?: DeckReport["answerCoverage"];
  /** Renamed from the `sections` prop `BuildBenchmarks` receives -- this function already has its
   *  own local `sections` array (the four groups themselves), so the incoming selector gets the
   *  boundary-local name instead of shadowing it. */
  only?: readonly DeckMathSectionId[];
  /** The name of the parent the score's coverage multiplier applies to, found by
   *  `coverageWeighted` and never by matching a string (I2, whole-branch review, 2026-09-01).
   *  Absent means no parent carries the flag -- typically because this call site was handed no
   *  `parents` at all -- and the dock sentence then omits the name rather than guessing one. It
   *  still RENDERS: `answerCoverage.coverage < 1` is a fact about what the engine did to the score,
   *  true whether or not this panel happens to know which row wears it, and suppressing a true
   *  disclosure over a missing prop is how the disclosure got lost in the first place. */
  coverageWeightedName?: string;
}) {
  const { isAdded } = useAdded();
  // ON A PHONE, A ROW'S CARDS SHOW ON A TAP (owner, 2026-09-27): six rows of names under their bars
  // read as a block of text at 390px. From `sm` up there is room, and they always show.
  const [shownOn, setShownOn] = useState<ReadonlySet<string>>(() => new Set());
  const toggleShown = (cls: string) => setShownOn((prev) => {
    const next = new Set(prev);
    if (!next.delete(cls)) next.add(cls);
    return next;
  });
  const { turn, seen, demand } = deckMath;
  // WORST FIRST: least likely to be in hand by the turn, a commander's own answer last (it is there
  // every game). The doctrine's fixed order put the rows a reader can act on wherever it happened to.
  const answers = [...deckMath.answers].sort(
    (a, b) => Number(a.fromCommandZone) - Number(b.fromCommandZone) || a.available - b.available || a.count - b.count,
  );
  // WORST FIRST, AGAINST THE NUMBER THE ROW ITSELF PRINTS. This sorted on `supplied` while the row
  // below it printed `available`, so a colour could sort above another and then show the smaller
  // gap -- the third reader of this row, and the one nobody saw disagreeing (2026-09-04).
  const colors = [...(deckMath.colors ?? [])].sort(
    (a, b) => ((b.worst?.required ?? 0) - (b.worst?.available ?? 0))
      - ((a.worst?.required ?? 0) - (a.worst?.available ?? 0)),
  );
  const lands = deckMath.lands;
  const wincons = deckMath.wincons;
  const clock = deckMath.clock;
  const castability = deckMath.castability;
  // THE MODE IS A FINDING, NOT A SUFFIX. Every row on a real deck carries the same one — this deck
  // reads "none exile" six times — and repeated six times it is noise, while said once it is a
  // sentence a deckbuilder acts on. Per-row text survives only when the rows DISAGREE, which is
  // when the suffix is carrying information.
  const answered = answers.filter((a) => a.class !== "graveyard" && a.count > 0);
  const noneExile = answered.length > 1 && answered.every((a) => a.exiling === 0);
  const graveyard = answers.find((a) => a.class === "graveyard");
  const noneRecurring = graveyard !== undefined && graveyard.count > 0 && graveyard.recurring === 0;
  // WHICH of `HATE_CLASSES` this deck cannot remove -- derived from the table, not a second
  // hardcoded pair (whole-branch review MINOR 6).
  const unansweredHate = HATE_CLASSES.filter(
    (c) => (answers.find((a) => a.class === c)?.count ?? 0) === 0,
  );
  const graveyardVulnerability = answerCoverage?.graveyardVulnerability ?? 0;
  // MOVED HERE FROM THE REMOVED INTERACTION PARENT ROW (task 5 fix round 1, 2026-09-01). That row
  // used to carry two disclosures as a suffix on its own ratio; deleting the row along with its
  // tests silently deleted the disclosures too -- the engine still docks Interaction's attainment
  // by `answerCoverage.coverage` and still refuses the colour-pool weight with no commander
  // detected (both in `build.ts`), and until this fix nothing on any screen said either. "A silent
  // wrong answer is worse than a missing one" -- this table is where both belong now: it is the
  // one place on the panel that already states, per class, what this deck answers.
  const coverageCovered = answerCoverage?.rows.filter((r) => r.covered).length ?? 0;
  const coverageClasses = answerCoverage?.rows.length ?? 0;
  const coverageDocked = answerCoverage !== undefined && answerCoverage.coverage < 1;
  const poolUnweighted = answerCoverage?.source === "unweighted";
  const answersBlock = (
      <div className="flex flex-col gap-1.5">
        <h4 className="eyebrow">Answers by turn {turn}</h4>
        {coverageDocked ? (
          <p className="text-xs text-(--muted) max-w-[65ch]">
            {/* THE PARENT IS NAMED FROM THE FLAG, NOT SPELLED INTO THE PROSE (I2, whole-branch
              *  review, 2026-09-01). "Interaction" was a literal here, which is worse than an
              *  unwired selector: rename the parent in `build.ts` and this sentence goes on
              *  confidently naming the old one. */}
            Docked for coverage: this deck's{coverageWeightedName ? ` ${coverageWeightedName}` : ""}{" "}
            score counts at {pct(answerCoverage!.coverage)} of full credit — {coverageCovered} of{" "}
            {coverageClasses} answer classes are covered, not every one these colours could reach.
          </p>
        ) : null}
        {poolUnweighted ? (
          <p className="text-xs text-(--muted) max-w-[65ch]">
            Colour pool unweighted — no commander detected, so every colour was scored as if it
            could supply every class.
          </p>
        ) : null}
        {/* WHICH CARDS, AND HOW OFTEN YOU HOLD ONE (owner, 2026-09-26: "ugly and useless ... having 5
          *  answers for each type is something no deck can provide"). Each row was a count against
          *  a "short" target, the copies it takes to hold an answer more often than not by the
          *  clock turn, which asked nearly every deck for about five of every kind and so told
          *  every deck it was short. What a player can act on is which of their cards answer what,
          *  and how often one is in hand: the count, the chance, and the names. */}
        <ul className="grid gap-x-8 gap-y-2.5 items-start [grid-template-columns:repeat(auto-fill,minmax(min(100%,36rem),1fr))]">
          {answers.map((a) => {
            const none = a.count === 0;
            // The mode sub-counts (design §7): a zero is the finding on a row that HAS answers --
            // four creature answers of which none exiles means a reanimator undoes all four. Spelled
            // out: `0 ex` was the most-misread string on this panel. Said once for the whole deck
            // (below) when every row agrees.
            const mode = none
              ? ""
              : a.class === "graveyard"
                ? noneRecurring ? "" : a.recurring > 0 ? `${a.recurring} keep working` : "none keep working"
                : noneExile ? "" : a.exiling > 0 ? `${a.exiling} exile` : "none exile";
            // A ZERO IS ONLY A FINDING WHEN THE POOL IS NOT. Measured: of the 60 zero rows across
            // the 71 calibration decks, 17 are artifact and their MEDIAN pool is 56 -- the
            // mono-black number. Printing the pool is what separates the colour pie from a gap.
            const odds = none
              ? a.pool !== undefined ? `your colours have ${a.pool} cards that could` : ""
              : a.fromCommandZone
                ? "your commander, so every game"
                : `in hand by turn ${turn} in ${pct(a.available)} of games`;
            // The screen reader hears the mode on every row, even when the screen says it once below.
            const said = none
              ? ""
              : a.class === "graveyard"
                ? a.recurring > 0 ? `${a.recurring} keep working` : "none keep working"
                : a.exiling > 0 ? `${a.exiling} of them exile` : "none of them exile";
            const label = `${a.class}, ${none ? "no answers" : plural(a.count, "card")}${odds ? `, ${odds}` : ""}${said ? `, ${said}` : ""}`;
            return (
              <li key={a.class} className="relative flex flex-col gap-0.5" aria-label={label} data-testid="answer-row">
                {/* THE WHOLE ROW TAPS ON A PHONE (persona round 2026-09-27: a 28px chevron on rows 33px
                  *  apart, "I would expect to mis-hit"). The row is 44px tall below `sm` and the
                  *  chevron's hit area is stretched across it. */}
                <div className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm sm:min-h-0 sm:items-baseline sm:gap-x-3">
                  {/* THE SAME ALPHABET AS THE WAFFLE LEGEND (AM3). `graveyard` is a zone, not a card
                    *  type, and gets no glyph; the fixed slot keeps every word on one left edge. */}
                  <span className="w-28 shrink-0 capitalize inline-flex items-center gap-1.5 sm:w-32">
                    <span aria-hidden className="w-4 shrink-0 inline-flex justify-center">
                      <CardSymbol name={a.class} className="text-(--muted) text-xs" />
                    </span>
                    {a.class}
                  </span>
                  <span className={`whitespace-nowrap stat-num ${none ? "text-(--warning)" : ""}`}>
                    {none ? "none" : plural(a.count, "card")}
                  </span>
                  {/* THE CHANCE AS A BAR (owner, 2026-09-27: "rely more on data visualisation than the
                    *  text"): "in hand by turn 7 in 26% of games" on every row became the bar and its
                    *  figure; the sentence stays in the row's label for a screen reader. */}
                  {!none && !a.fromCommandZone ? (
                    <span className="inline-flex items-center gap-2" aria-hidden="true">
                      <span className="h-1.5 w-20 rounded-full bg-(--surface-secondary) sm:w-28">
                        <span className="block h-full rounded-full bg-(--accent)" style={{ width: `${Math.round(a.available * 100)}%` }} />
                      </span>
                      <span className="stat-num text-xs text-(--muted)">{pct(a.available)}</span>
                    </span>
                  ) : null}
                  <span className="text-xs text-(--muted)">
                    {none || a.fromCommandZone ? odds : null}
                    {mode && (none || a.fromCommandZone) && odds ? " · " : null}
                    {mode ? <span className={mode.startsWith("none") ? "text-(--warning)" : ""}>{mode}</span> : null}
                  </span>
                  {a.cards?.length ? (
                    <button type="button" className="sm:hidden ml-auto inline-flex size-7 items-center justify-center self-center rounded-(--radius) text-(--accent) after:absolute after:inset-x-0 after:top-0 after:h-11 after:content-['']"
                      aria-expanded={shownOn.has(a.class)} aria-controls={`answer-cards-${a.class}`} onClick={() => toggleShown(a.class)}
                      aria-label={shownOn.has(a.class) ? "Hide the cards" : "Which cards"}>
                      <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5"
                        className={shownOn.has(a.class) ? "rotate-180" : ""}><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>
                    </button>
                  ) : null}
                </div>
                {a.cards?.length ? (
                  <span id={`answer-cards-${a.class}`} data-testid="answer-cards"
                    className={`text-xs sm:block sm:pl-[9.75rem] ${shownOn.has(a.class) ? "block" : "hidden"}`}>
                    {a.cards.map((n, i) => <span key={n}>{i > 0 ? <span className="text-(--muted)"> · </span> : null}<CardName name={n} /></span>)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        {/* THE TWO FINDINGS THIS PANEL WAS BURYING. Both were per-row suffixes repeated down the
          *  column; both are single facts about the whole deck, and both are the kind of thing a
          *  player changes a decklist over. */}
        {noneExile ? (
          <p className="text-sm text-(--warning) max-w-[65ch]">
            Nothing this deck kills is exiled — everything it answers can come back.
          </p>
        ) : null}
        {noneRecurring ? (
          <p className="text-sm text-(--warning) max-w-[65ch]">
            Its graveyard hate is one-shot: {plural(graveyard!.count, "card")}, none of which keeps
            working after it resolves.
          </p>
        ) : null}
        {/* THE SCORE DISCOUNTS A GRAVEYARD ZERO ON PURPOSE (task 5) -- the panel is where the finding
          *  survives. Gated on the deck's OWN measured vulnerability, not on any answer row alone, so
          *  a deck with no graveyard plan at all is never told to fear hate it does not need. */}
        {graveyardVulnerability >= VULNERABLE && unansweredHate.length > 0 ? (
          <p className="text-sm text-(--warning) max-w-[65ch]">
            {/* ONLY THE CLASSES THIS DECK ACTUALLY LACKS ARE CITED (whole-branch review MINOR 6) --
              *  the two counts used to print unconditionally, so a deck that answers artifacts but
              *  not enchantments read "16 artifacts and 6 enchantments... shut it off", citing 16
              *  artifacts as a live threat this deck in fact handles. */}
            Your plan runs through the graveyard.{" "}
            {unansweredHate.map((c) => plural(HATE_COUNTS[c], c)).join(" and ")} in the format shut
            it off, and this deck{" "}
            {unansweredHate.length === 2
              ? "answers neither"
              : unansweredHate.length > 2
                ? "answers none of them"
                : `has no ${unansweredHate[0]} removal`}
            .
          </p>
        ) : null}
      </div>
  );

  const castsBlock = castability && castability.cards.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Hardest casts</h4>
          {/* GROUPED BY COST, because the mana figure is a property of the cost and not of the card:
            *  four cards that all cost 5 print the same percentage four times, which three of four
            *  player reviews read as a broken readout. Said once per group, it becomes what it
            *  actually is -- a statement about five-drops in this deck -- and the per-card line is
            *  left carrying only what differs, its colours. */}
          <ul className="flex flex-col gap-2">
            {/* Keyed on the figure itself, not just the turn: two cards only share a heading when
              *  they genuinely share a probability, so a fractional mana value can never be folded
              *  into a group whose number it does not actually carry. */}
            {[...new Set(castability.cards.map((c) => `${c.turn}:${c.castable.low}:${c.castable.high}`))].map((groupKey) => {
              const group = castability.cards.filter(
                (c) => `${c.turn}:${c.castable.low}:${c.castable.high}` === groupKey,
              );
              const { turn: costTurn, castable } = group[0]!;
              // A RANGE, low to high, and never a single number -- but the range is the PLAY POLICY
              // now, not the old pair of arithmetic biases. Collapsed to one figure when the two
              // ends round the same, so a row never reads "78% – 78%".
              const castText = band(castable);
              return (
                <li key={groupKey} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-3 text-sm">
                    <span className="flex-1 stat-num">
                      {costTurn}-drop{group.length === 1 ? "" : "s"}
                    </span>
                    <span className="shrink-0 stat-num">
                      {castText} to cast by turn {costTurn}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 border-l border-(--separator) pl-3">
                    {group.map((c) => {
                      // WHICH PROBLEM IT IS. The headline folds mana and colour together; this is
                      // the same cell with colours ignored, so a wide gap says the deck cannot make
                      // the COLOURS and a narrow one says it cannot make the MANA. Shown only when
                      // the gap is worth acting on -- below that it is a second number saying the
                      // same thing, which is how a panel stops being read.
                      const gap = c.mana.high - c.castable.high;
                      // THE FIGURE PER ROW, THE MEANING ONCE (review 2026-09-24): the full clause on
                      // every row took the row's width and cut the card NAME to "Wate…" or "C".
                      // What the gap means is said once, under the list.
                      const note = gap >= COLOUR_GAP ? `mana alone ${band(c.mana)}` : "";
                      return (
                        <li
                          key={c.name}
                          data-new={isAdded(c.name) ? "1" : undefined}
                          // STACKED AT NARROW. Side by side, the fixed figures kept their full width
                          // while the card name truncated -- "Inalla, Archmage Ritualist" wants
                          // 163px and had 110 -- so the row lost the one thing identifying which
                          // card it is about. On its own line the name always fits.
                          //
                          // PINNED RINGS IT (roadmap S8), the same accent outline the Cards table
                          // and the matrix use. The row already carries a full `aria-label`, so
                          // "pinned" joins that sentence rather than adding a second node beside it.
                          className={`flex flex-col sm:flex-row sm:items-baseline gap-x-3 text-sm ${
                            isAdded(c.name) ? "outline outline-1 outline-(--accent) outline-offset-[-1px]" : ""
                          }`}
                          aria-label={`${c.name}${c.manaCost ? ` ${c.manaCost}` : ""}, ${castText} to cast by turn ${c.turn}`
                            + (note ? `, ${note}` : "") + (isAdded(c.name) ? ", new" : "")}
                        >
                          {/* THE COST, BESIDE THE CARD IT BELONGS TO (roadmap T18a). Owner: *"the
                            *  section with hardest to cast does not show pips for some reason"* --
                            *  and it is the one panel where the cost IS the subject: a row saying
                            *  "42% to cast by turn 1" is unreadable without knowing the card costs
                            *  {R}. Carried on the report rather than joined back on the name, which
                            *  is the MDFC defect this repo has already fixed in eleven places. */}
                          {/* THE NAME WRAPS, IT NEVER TRUNCATES: it is the one thing on the row that
                            *  says which card this is (review 2026-09-24, "Wate…", "Rakd…", "C"). */}
                          <span className="flex-1 min-w-0 text-(--foreground)">
                            {c.name}
                            {c.manaCost ? (
                              <span className="ml-1.5 align-baseline"><ManaSymbols cost={c.manaCost} /></span>
                            ) : null}
                          </span>
                          <span className="shrink-0 sm:text-right stat-num text-(--muted) text-xs">
                            {note}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
          {/* WHICH CARDS WERE REFUSED, NOT JUST HOW MANY (S19). A refused card leaves the list
            *  above entirely, so before this the only trace of it was a count inside a collapsed
            *  caveat -- measured on the example deck, `Blasphemous Act` stopped being called a
            *  9-drop and then appeared nowhere on the report at all. A reader looking for their
            *  most expensive card could not find out what happened to it. Named with the reason,
            *  biggest first, the same call `cheatsIntoPlay` makes one paragraph down. */}
          {castability.refusedCards && castability.refusedCards.length > 0 ? (
            <p className="text-xs text-(--muted) max-w-[65ch]">
              <span className="text-(--foreground)">Not checked:</span>{" "}
              {castability.refusedCards.map((c, i) => (
                <span key={c.name}>
                  {i > 0 ? "; " : ""}<CardName name={c.name} /> — {c.reason}
                </span>
              ))}
              .
            </p>
          ) : null}
        </div>
  ) : null;

  const clockBlock = clock ? (
        <div className="flex flex-col gap-1">
          {/* NAMED FOR WHAT IT MEASURES (roadmap K6). It was "Clock" over "Kills on turn 8", and in a
            *  four-player pod that reads as "wins on turn 8" -- wrong by roughly a factor of three,
            *  since this counts combat damage against ONE opponent's 40 life. `pressure.ts` has
            *  argued exactly that in a comment since it was written ("a deck that can kill the table
            *  three times over is not three times as fast"), and the label said the opposite.
            *  THE NUMBER IS UNCHANGED AND MUST NOT BE DELETED: `deck-math.ts` prices every
            *  availability, `required` and castability figure at this turn, so removing it drops all
            *  71 decks onto the flat corpus median with no instrument saying that is an improvement.
            *  This is a rename and a demotion in the reading order, nothing more. */}
          <h4 className="eyebrow">Combat pressure</h4>
          <div
            className="flex items-center gap-3 text-sm"
            aria-label={
              clock.turn === undefined
                ? `no combat clock, ${clock.powerAtFive} expected power at turn 5`
                : `beats one opponent on turn ${clock.turn}, ${clock.powerAtFive} expected power at turn 5`
            }
          >
            {/* Two turn numbers in one row read as a contradiction unless each says what it is
              *  about — the headline is when this deck kills, the aside is a snapshot on the way
              *  there, and readers took the pair for a mistake. */}
            <span className="w-32 shrink-0 stat-num">
              {clock.turn === undefined ? "no combat clock" : `Beats one opponent turn ${clock.turn}`}
            </span>
            <span className="flex-1 text-xs text-(--muted) tabular-nums">
              {clock.turn === undefined
                ? "nothing here kills through combat — a mill or alt-win deck has no combat clock"
                : `about ${Math.round(clock.powerAtFive)} power of creatures in play by turn 5, on the way there`}
            </span>
          </div>
          {/* A turn number that does not say how it was made reads as a prediction. It is a RATE:
            *  useful for comparing two decks, useless as a date. */}
          <Caveat label="how this turn is worked out">
            How hard your creatures hit against ONE opponent at 40 life, not the whole table. Three
            opponents means three boards and three life totals, and this does not play that out.
            Nobody blocks and nothing gets removed. Your creatures come down cheapest first, using
            the mana this deck makes in our test games, so ramp does make it faster. But that counts
            every point of mana you have, and a real game spends some of it on removal and card
            draw. Use it to compare decks, not to plan a game.
          </Caveat>
        </div>
  ) : null;

  // WIN PLANS, WITH THEIR CARDS (2026-09-26). This was one sentence of counts, "Mostly go-wide 8
  // cards · voltron 7 cards", which folded three bars into words; `WinPlans` keeps the words and
  // names the cards on each plan, which is what the baseline round's plan seat could not do.
  const winBlock = wincons && wincons.classes.length > 0 ? <WinPlans wincons={wincons} /> : null;

  // THE DELTA MUST SAY SO TOO (fix F1, controller review 2026-08-21) -- a landfall deck's target is
  // the gate's answer PLUS `ARCHETYPE_TARGET_DELTAS.landfall`, and staying silent about the `+4` is
  // the identical defect as a silent fallback: a reader sees "wants 43" and deserves to know 4 of
  // those are because this is a landfall deck, not a wider curve. Computed once, worded slightly
  // differently in the two spots it appears (aria-label vs. the visible caveat) purely to match how
  // the pre-existing flat-fallback wording already differs between those two spots.
  const deltaAmount = lands.archetypeDelta !== 0
    ? `${lands.archetypeDelta > 0 ? "plus" : "minus"} ${Math.abs(lands.archetypeDelta)} because this is a ${lands.archetypeLabel?.toLowerCase()} deck`
    : undefined;
  const deltaRaw = `${lands.rawTarget} from the curve `;
  const landsAriaDelta = deltaAmount ? ` — ${deltaRaw}${deltaAmount}` : "";
  const landsVisibleDelta = deltaAmount ? ` · ${deltaRaw}${deltaAmount}` : "";

  // THE WHOLE MANA BASE IN ONE UNIT (owner, 2026-09-29), dearest part first: on most decks the
  // colours cost more than the land count does, and the sentence should lead with what to fix.
  const manaBase = lands.manaBase;
  const manaBaseParts = manaBase
    ? ([["colours", manaBase.costs.colour], ["tapped lands", manaBase.costs.tapped], ["land count", manaBase.costs.count]] as const)
      .slice().sort((a, b) => b[1] - a[1])
    : [];

  const landsBlock = lands ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Lands</h4>
          {/* THE ONLY LAND VERDICT ON THE PANEL now that the benchmark row is gone. Its target is
            *  derived from this deck's own average mana value and acceleration rather than the flat
            *  36 every deck used to be measured against, and the inputs are shown because "34" with
            *  no working is a number to argue with rather than act on.
            *
            *  The formula behind it is `mana-base.ts`'s, and that name is implementation: the reader
            *  is asking how many lands to run, not whose formula answered.
            *
            *  AN ARCHETYPE DELTA MUST SAY SO (fix F1, above) -- see `landsAriaDelta`/`landsVisibleDelta`. */}
          {/* IT WRAPS, BECAUSE THE THREE FIXED COLUMNS ASSUMED A WIDTH THIS ROW RARELY GETS.
            *  Measured 2026-09-03 on the example deck: `w-52` (208px) plus `w-16` (64px) plus two
            *  12px gaps is 296px of a row that gets 326px on a 390px phone and **292px on a 1440px
            *  desktop**, where the `xl:grid-cols-2` above halves it. The middle sentence was left
            *  60px -- a twenty-line ribbon two words wide, 272px tall -- and `wants 36` was pushed
            *  30px past the column edge on a phone and 65px past it on the desktop, over whatever
            *  sits in the next grid column. A phone judge read it as a number running off the
            *  screen; it was worse on the machine it was designed on.
            *
            *  So the row wraps instead of overflowing, and it wraps only when it must: the sentence
            *  keeps a 16rem flex-basis, so wherever 16rem plus the two figures fits (768px and up)
            *  this is still one line, and below that the sentence drops to its own full-width line
            *  under `38 in deck ... wants 36`. No breakpoint: the row responds to the space it is
            *  actually given, which is the whole defect -- a media query would still have been
            *  wrong inside the two-column grid. */}
          <div
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm"
            aria-label={`${lands.actual} lands in the deck${
              lands.mdfc > 0 ? `, ${lands.mdfc} of them modal DFCs with a land back` : ""
            }, this curve wants ${lands.target}${landsAriaDelta}`}
          >
            {/* THE BRACKET NAMES HOW MANY OF THESE LANDS ARE MDFCs, and it used to reconcile two
              *  numbers instead. Until 2026-08-31 `actual` held an MDFC OUT (Karsten prices it as a
              *  spell and discounts the target) while every other reader in this repo, the build
              *  `lands` chip included, counted it by type line -- so this row printed both figures
              *  rather than leave a reader to find the discrepancy. The owner ruled the split away:
              *  an MDFC is a land, `actual` counts it, and the two readers agree. What survives is
              *  the composition, because a reader looking at 38 should know 4 of them are cards
              *  they may cast instead. */}
            <span className="shrink-0 stat-num">
              {lands.actual} in deck
              {lands.mdfc > 0 ? <span className="text-xs text-(--muted)"> ({lands.mdfc} MDFC)</span> : ""}
            </span>
            {/* `ml-auto` rather than a fixed column: on one line it sits at the right edge, and on
              *  the wrapped line it is still the right-hand end of "38 in deck ... wants 36". */}
            <span
              className={`ml-auto shrink-0 text-right stat-num ${
                // The Lands dial's reading, the score's own margin, not a second one of its own (#759).
                bandState(lands.actual, lands.target).tone === "success" ? "text-(--success)" : "text-(--warning)"
              }`}
            >
              wants {lands.target}
            </span>
            {/* A sentence, not a table cell -- "avg mana value 2.6 · 4 cheap ramp/draw · 0 fast
              *  mana" stays the body face and only picks up plain tabular alignment so its three
              *  figures don't shift the "·"s between them.
              *
              *  AFTER the verdict in the DOM, not between the two figures. That is the order a
              *  reader says it in -- "38 in deck, wants 36, and here is the working" -- so the
              *  wrapped layout and the screen-reader order are the same order, with no `order-*`
              *  class pulling them apart. */}
            <span className="min-w-0 flex-1 basis-64 text-xs text-(--muted) tabular-nums">
              {/* ONE LAND NUMBER, WITH THE OTHER ONE EXPLAINED (baseline round 2026-09-26): "wants 36"
                *  beside "asks for 41" read as the site disagreeing with itself, and the slow-deck seat
                *  came for one number it could trust. The working names what the target reads: the
                *  curve, the commander, and the ramp and draw package (2026-09-29), each named by
                *  what it counts. An older report without the package falls back to its own words. */}
              average mana value {lands.avgManaValue}
              {lands.accelerants !== undefined
                ? ` · ${lands.drawPieces ?? 0} draw cards · ${lastingRamp(lands.accelerants, rampCards)}`
                : ` · ${lands.rampPlusDraw} cheap mana makers (2 mana or less)`}
              {lands.commanderManaValue ? ` · a ${lands.commanderManaValue}-mana commander` : ""}
              {lands.mdfc > 0
                ? ` · ${lands.mdfc} modal DFC${lands.mdfc === 1 ? "" : "s"} counted as lands, at full weight and with no discount to the target`
                : ""}
              {landsVisibleDelta}
            </span>
          </div>
          {/* THE TARGET IS FOR THIS RAMP AND DRAW PACKAGE (owner, 2026-09-29: "your consistency should
            *  be this, or your ramp should be that"). A role over its own target is the one case
            *  where the land count would move, so the row says where it goes if the deck trims. */}
          {lands.ifTrimmed?.ramp ? (
            <p className="text-sm">
              Ramp is {lands.ifTrimmed.ramp.over} over its target: if you cut rocks or dorks to get there,
              plan for about <span className="stat-num">{lands.ifTrimmed.ramp.target}</span> lands.
            </p>
          ) : null}
          {lands.ifTrimmed?.draw ? (
            <p className="text-sm">
              Consistency is {lands.ifTrimmed.draw.over} over its target: if you cut draw to get there,
              plan for about <span className="stat-num">{lands.ifTrimmed.draw.target}</span> lands.
            </p>
          ) : null}
          {/* WHAT THE MANA BASE COSTS, in the one unit every part of it shares: turns lost in a
            *  game's first ten, against a perfect mana base of this same deck. Measured by playing
            *  268 decks 2,000 times each (`mana-base.ts`), which is also why it is "about". */}
          {manaBase ? (
            <p className="text-sm">
              {/* SAID AS WHAT IT MEASURES (persona round 2026-09-29: four seats listed "0.6 turns in
                *  every 10" as a phrase they could not decode -- every 10 turns, or games?). */}
              Your mana base loses about <span className="stat-num">{manaBase.total.toFixed(1)}</span> of a turn over a game&apos;s first 10 turns, against a perfect one for this deck
              <span className="text-xs text-(--muted)">
                {" "}— {manaBaseParts.map(([name, cost]) => `${name} ${cost.toFixed(1)}`).join(" · ")}
              </span>
            </p>
          ) : null}
        </div>
  ) : null;

  // WHAT YOUR LIBRARY IS WORTH to a payoff that reads a random card off the top. Sits with "how you
  // win" because it IS the plan for the decks that run one -- Hidetsugu and Kairi drains for the
  // mana value of whatever is on top, so the curve is the payoff. Deck level and naming no member:
  // the trigger CHOOSES nothing, so an edge to one expensive spell would be true of every one of
  // them equally (`topdeck.ts` carries the refusal in full).
  const topdeckBlock = deckMath.topdeck.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Off the top</h4>
          <ul className="flex flex-col gap-1">
            {deckMath.topdeck.map((t) => (
              <li key={t.card} className="flex items-baseline gap-3 text-sm">
                <span className="w-40 shrink-0 truncate">{t.card}</span>
                <span className="flex-1 text-xs text-(--muted) tabular-nums">
                  a random card off your library is worth{" "}
                  <span className="text-(--foreground)">{t.meanManaValue}</span> mana —{" "}
                  {t.nonlandMeanManaValue} when it is not a land, and {Math.round(t.landShare * 100)}% of the
                  time it is one
                  {t.castable
                    ? ` · ${Math.round(t.castable.share * 100)}% of your library is ${t.castable.types.join(" or ")}, which it casts for free`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
  ) : null;

  // CAN THE MANA BASE EVEN HOLD THIS? Each row's `required` is the sources ONE early double-pip card
  // wants at 90% confidence, and the rows are independent demands on the same lands: this deck asks
  // 36 + 33 + 33 = 102 source-slots of 34 lands. A three-colour deck cannot satisfy them all, so
  // painting each row amber says "your mana base is broken" about an arithmetic impossibility, and
  // the honest fix is usually the SPELL rather than the land count. Amber survives only where the
  // gap is closable — a single row whose demand fits inside the deck's own land count, in a deck
  // whose rows together also fit.
  const totalRequired = colors.reduce((n, c) => n + (c.worst?.required ?? 0), 0);
  const landRoom = lands?.actual ?? 0;
  // ONE ROW CANNOT "TOGETHER" WANT ANYTHING, and with a single colour there is no competition for
  // slots to warn about -- the row already states its own shortfall. Found in a live browser on
  // `draguns` (mono-blue, one colour row wanting 37 against 36 lands), where the message fired on a
  // one-land margin and said "which no deck can hold" about a deck that plainly could.
  //
  // CEILING: the comparison is still loose for two or more colours -- `totalRequired` counts
  // SOURCES, which include rocks and dorks, against LANDS, and a dual land answers two rows at once.
  // Tightening that needs a per-colour supply ceiling this component does not have; the guard here
  // only removes the case where the sentence is self-evidently false.
  const overcommitted = colors.filter((c) => c.worst).length > 1 && totalRequired > landRoom;
  const coloursBlock = colors.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Colours</h4>
          <ul className="flex flex-col gap-1">
            {colors.map((c) => {
              // The deadline is the CARD's own mana value, not a chosen turn: a 3-drop wants its
              // pips on turn 3. That is why this row can name a turn without guessing one.
              const label = c.worst
                ? `${c.color}, ${c.supplied} sources, ${c.worst.available} of them by turn ${c.worst.turn}, when ${cardsSubject(c.worst.names ?? [], c.worst.cards)} want${c.worst.cards === 1 ? "s" : ""} ${c.worst.pips} pip${c.worst.pips === 1 ? "" : "s"} and that needs ${c.worst.required}`
                : c.countBound
                  ? `${c.color}, ${c.supplied} sources; its hardest costs need more mana, not other colours`
                  : `${c.color}, ${c.supplied} sources, enough for every card that costs it`;
              return (
                <li key={c.color} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" aria-label={label}>
                  {/* A PIP, NOT A LETTER (roadmap T18a). Owner's call: mana pips everywhere. The
                    *  row already renders its DEMAND as pips ("2 cards want {B}{B}"), so the letter
                    *  beside them was the one place this panel spelled a colour instead of showing
                    *  it. Same renderer, so the two cannot disagree.
                    *
                    *  IT NO LONGER KEEPS A `sm:` WIDTH RULE, and that rule was the same defect the
                    *  lands row above had: `sm:w-24` is a VIEWPORT query, and at 1440 the two-column
                    *  grid gives this list a 292px column. So the wide gutter arrived exactly where
                    *  there was no room for it -- measured, the demand beside it was left 12px and
                    *  wrapped one word per line. One glyph is affordable at every width; the space
                    *  around it was not. */}
                  <span className="w-6 shrink-0">
                    <ManaSymbols cost={`{${c.color}}`} />
                  </span>
                  {/* The subject of this row is the card that sets the DEADLINE, not the colour in
                    *  general — "1 card wants {U}{U} on turn 2" is what makes the shortfall beside
                    *  it a fact about one early double-pip spell rather than about the mana base. */}
                  <span className="min-w-0 flex-1 basis-48 text-(--muted) text-xs">
                    {c.worst
                      // Colour demand now renders in the same notation as a printed cost, so the
                      // reader meets one convention instead of two ("4 W" here, "{3}{B}{B}" in the
                      // Cards table).
                      ? (
                        <>
                          {plural(c.worst.cards, "card")} {c.worst.cards === 1 ? "wants" : "want"}{" "}
                          <ManaSymbols cost={`{${c.color}}`.repeat(c.worst.pips)} /> on turn {c.worst.turn}
                        </>
                      )
                      // #680: a mono-black deck's four-pip turn-4 card is short of MANA, which the
                      // lands row judges; "every cost covered" said the opposite.
                      : c.countBound ? "colour isn't the limit; the land count is" : "every cost covered"}
                  </span>
                  {/* "23 of 36 sources" and "short 13" were the same subtraction printed twice.
                    *  The pair survives as one cell, coloured: the reader can see the gap and its
                    *  size in one place. */}
                  <span
                    className={`ml-auto shrink-0 text-right stat-num ${
                      !c.worst
                        ? c.countBound ? "text-(--muted)" : "text-(--success)"
                        : overcommitted || c.worst.required > landRoom
                          ? "text-(--muted)"
                          : "text-(--warning)"
                    }`}
                  >
                    {/* AND A VERB, NOT JUST A NOUN. `13 of 22 sources` named the unit and left the
                      *  DIRECTION open -- the judge's fourth run: *"I can't tell whether 13 is what
                      *  I have out of 22 wanted, or 13 wanted out of 22 I have."* A fraction cannot
                      *  say which end is the deck; a verb can, and `wants` is the one the lands row
                      *  three blocks up already uses for exactly this ("38 in deck ... wants 36"),
                      *  which is the row the same judge reads without trouble every run.
                      *
                      *  THE NUMBERS HAVE A NOUN, and they lost a turn they were saying twice.
                      *  This read `13 of 22 by turn 2` beside `1 card wants {U}{U} on turn 2`, and
                      *  the phone judge's third run stopped at exactly that: *"the moment I hit `12
                      *  of 17 by turn 1` and realised the noun for 17 lives behind a closed grey
                      *  line below all three rows. That's the point where the screen has stopped
                      *  talking to me in words."* It was the one finding that cost a whole section
                      *  rather than seconds. `worst.turn` is the same value the left half already
                      *  prints, so naming the unit costs nothing: the turn is stated once, on the
                      *  line that says whose deadline it is.
                      *
                      *  THE SHORTFALL IS AGAINST WHAT COULD BE PRODUCING BY THAT TURN, never the
                      *  deck total: printing `supplied` here said "25 of 17 sources" on a row the
                      *  model had just called SHORT, and it read as a contradiction because it was
                      *  one. `supplied` counts two-mana rocks and lands that enter tapped on the
                      *  very turn the demand is due. */}
                    {c.worst ? `${c.worst.available} sources, wants ${c.worst.required}` : c.countBound ? `${c.supplied} sources` : `${c.supplied} sources, enough`}
                  </span>
                </li>
              );
            })}
          </ul>
          {/* THE ONE BLOCK THAT HAD NO FOOTNOTE was the one making the harshest claim, sitting
            *  directly under a green land count — and every player review read it as "your mana
            *  base is broken" and then discarded the whole block for contradicting the row above.
            *  It does not contradict it: a land count and a pip deadline are different questions,
            *  and the honest fix for a demand no 100-card deck can meet is usually the spell. */}
        </div>
  ) : null;

  // WANTS VS SUPPLIES, UNMET FIRST AND THE REST FOLDED. Every row is a pair of counts with no
  // verdict attached, and on a deck that works they all read the same way — "15 want · 47 supply" —
  // so the block spent its height restating that the deck functions. The row that MATTERS is a want
  // with nothing supplying it, and on a good deck there are none, which is exactly why the whole
  // list belongs one click down rather than open by default. A row the GAME supplies (an end step,
  // an upkeep) is never unmet: nothing has to provide it.
  const demandRow = (d: (typeof demand)[number]) => {
    const sentence = demandSentence(d.key);
    const label =
      d.available === null
        // "THE GAME SUPPLIES IT" WAS WRITTEN FOR AN UPKEEP AND IS FALSE OF A SELF TRIGGER. Since
        // 2026-08-27 a trigger watching its OWN entry is self-supplied too — it fires when you play
        // the card — so the wording has to be true of all three cases (a phase, combat, and a card
        // triggering itself). "Nothing has to supply it" is the component's own phrasing from the
        // comment above, and it covers every one.
        ? `${sentence}, ${d.consumers} cards care about it, and it happens on its own`
        : `${sentence}, ${d.consumers} cards care about it, ${d.suppliers} cause it`;
    return (
      <li key={d.key} className="flex items-center gap-3 text-sm" aria-label={label}>
        {/* The raw census key stays reachable on hover, because `bin/deck-availability.ts` prints
          *  keys and a report you cannot match against the bin is a dead end. */}
        <span className="flex-1 truncate" title={d.key}>{sentence}</span>
        <span className={`shrink-0 stat-num ${d.available !== null && d.suppliers === 0 ? "text-(--warning)" : "text-(--muted)"}`}>
          {d.available === null
            ? `${d.consumers} care · happens on its own`
            : `${d.consumers} care · ${d.suppliers} cause it`}
        </span>
      </li>
    );
  };
  const unmet = demand.filter((d) => d.available !== null && d.suppliers === 0);
  const demandBlock = (
      <div className="flex flex-col gap-1.5">
        <h4 className="eyebrow">What they care about, and what causes it</h4>
        {unmet.length > 0 ? (
          <>
            <p className="text-sm text-(--muted)">
              {plural(unmet.length, "thing")} your cards care about, and nothing in the deck
              causes {unmet.length === 1 ? "it" : "them"}.
            </p>
            <ul className="flex flex-col gap-1">{unmet.map(demandRow)}</ul>
          </>
        ) : (
          <p className="text-sm text-(--muted)">
            Everything your cards care about, something in the deck causes.
          </p>
        )}
        <details>
          <summary className="eyebrow cursor-pointer text-(--muted)">
            show all {demand.length}
          </summary>
          <ul className="flex flex-col gap-1 pt-1">{demand.map(demandRow)}</ul>
        </details>
      </div>
  );

  // THE PANEL ANSWERS THREE QUESTIONS, and used to present them as seven interchangeable blocks in
  // the order they happened to be built. A deckbuilder already holds these three; making them the
  // structure means the reader stops deriving the grouping themselves, once per block.
  //
  // `flagged` is a CONDITION, not a score. Cards-short, sources-short and a cast probability are
  // different units, and folding them into one number would be inventing a scale this engine has no
  // basis for -- so a section leads simply because something inside it is already painted as a
  // problem. Flagged sections sort first and `sort` is stable, so everything else holds the fixed
  // order below: the four headings never change, only which of them you meet first.
  const sections: { id: DeckMathSectionId; title: string; flagged: boolean; blocks: ReactNode[] }[] = [
    {
      id: "cast",
      title: "Can you cast your cards",
      // A row nobody can close does not lead the panel either — same ruling as the colour it paints.
      flagged:
        colors.some((c) => c.worst && !overcommitted && c.worst.required <= landRoom)
        || (lands !== undefined && Math.abs(lands.actual - lands.target) > 2),
      blocks: [landsBlock, coloursBlock, castsBlock],
    },
    {
      id: "answers",
      title: "Can you deal with theirs",
      // FLAG WHAT IS PAINTED. A class with NO answers is a fact about the deck, and so are the two
      // findings below it.
      flagged: answers.some((a) => a.count === 0) || noneExile || noneRecurring,
      blocks: [answersBlock],
    },
    { id: "win", title: "How you win", flagged: false, blocks: [clockBlock, winBlock, topdeckBlock] },
    // Not a question a player arrives with -- it describes the deck's own internal engine -- so it
    // is named plainly and sits last whatever else is wrong.
    { id: "waiting", title: "What your cards are waiting for", flagged: false, blocks: [demandBlock] },
  ];
  const shown = only === undefined ? sections : sections.filter((s) => only.includes(s.id));

  return (
    // Rhythm at two levels: blocks inside a section sit closer (gap-5) than the sections do to each
    // other (gap-8), so the three questions read as three regions rather than as one column of
    // seven equal things.
    <div className="flex flex-col gap-8 mt-2 pt-3 border-t border-(--separator)">
      {/* THE HORIZON LEADS, it does not trail. Every probability below is priced at this turn, the
        *  first section heading below depends on it ("Answers by turn 7"), and this sentence used to
        *  sit ~1,400px further down — so the reader met the number, guessed at it, and only later
        *  found out what it meant. The caveats stay with it: they qualify every block, not just the
        *  last one. */}
      {/* THE HORIZON STAYS VISIBLE and its caveats fold: every probability below is priced at this
        *  turn, so a reader who does not know the number cannot read the panel at all — while the
        *  four things the model ignores are what they consult once and then stop needing. */}
      {/* ONE LINE (owner, 2026-09-27: "less is more"): the turn every figure below is priced at. */}
      <p className="text-xs text-(--muted) tabular-nums">Checked at turn {turn}, {seen} cards seen.</p>

      {[...shown]
        .sort((a, b) => Number(b.flagged) - Number(a.flagged))
        // A section whose every block is absent renders nothing at all: a colourless deck has no
        // Colours block, an alt-win deck may have no win plans, and an empty heading is a promise
        // the panel does not keep.
        .filter((s) => s.blocks.some(Boolean))
        .map((s, i) => (
          // A hairline between sections and none above the first: at 11px uppercase mono, a section
          // heading and a block heading differ only in brightness, which is not enough separation
          // for a region. The rule is how this system already separates things -- borders and tonal
          // steps, never shadow.
          <section
            key={s.title}
            className={`flex flex-col gap-5 ${i > 0 ? "border-t border-(--separator) pt-6" : ""}`}
          >
            {/* h3, PROMOTED FROM h4 (I3, whole-branch review, 2026-09-01). Each sub-tab now opens
              *  with an `h2` naming it, and the panels sitting beside these on Mana and Engine
              *  (`ManaAvailability`, `LandMathChart`, `UnmetConditions`, `HighSynergyCards`,
              *  `BracketPanel`) have always been `h3`s -- so an `h4` here both skipped h3 under the
              *  sub-tab's own title and inverted against its own siblings on the same screen. At h3
              *  these sections are siblings of "How the roles are spent" above and of the mana
              *  panels beside them, which is what they are, and the blocks inside them are the h4s.
              *  WCAG 1.3.1, and this repo's own "headings never skip levels". */}
            <h3 className="eyebrow">{s.title}</h3>
            {/* TWO ACROSS WHERE THERE ARE TWO TO PLACE (roadmap T11). Measured on the deployed page
              *  at 1960px: these blocks are full-width containers holding narrow content, and the
              *  ink stopped at 27% of the row on "Win plans", 36% on "Combat pressure" and "How you
              *  win". They stacked in one column because that is what a column does, not because
              *  anything about them is wide.
              *
              *  A GRID AND NOT A MULTI-COLUMN, deliberately: T16 was a disclosure inside a CSS
              *  multi-column re-balancing every sibling when it opened, and these blocks carry
              *  `Caveat` disclosures of their own. A grid track only pushes what is below it.
              *
              *  ONLY WHEN THERE ARE TWO. A one-child two-column grid reserves half a row for
              *  nothing, which is the exact defect this same item found in the Fixes chapter. */}
            {(() => {
              const blocks = s.blocks.filter(Boolean);
              // A LONE BLOCK IS NOT CAPPED (#770): its rows sit in grid cells of their own, so "Land"
              // and its "4 short" stay a cell apart, not a screen (look-and-feel review 2026-09-24).
              if (blocks.length < 2) return <div className="flex flex-col gap-5">{blocks.map((block, i) => <Fragment key={i}>{block}</Fragment>)}</div>;
              return (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-8 gap-y-5 items-start [&>*]:min-w-0">
                  {blocks.map((block, i) => (
                    // Keyed by position within its section: these are fixed, authored blocks, never
                    // a list that reorders inside a section.
                    <Fragment key={i}>{block}</Fragment>
                  ))}
                </div>
              );
            })()}
          </section>
        ))}
    </div>
  );
}
