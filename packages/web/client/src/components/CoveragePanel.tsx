import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";
import { useIsNarrow } from "../lib/use-narrow.js";
import { hatchImage } from "../lib/unread.js";

/** HOW MUCH OF THE DECK THE SYNERGY ENGINE COULD READ — the gate, and it sits ABOVE THE TABS
 *  because it qualifies every one of them.
 *
 *  `MissingCards` reports names that failed to RESOLVE. A card that resolves and carries no derived
 *  tags is a different failure and looked identical to a fully analysed one: it forms no edges,
 *  carries no theme and cannot reach an archetype. **Measured on a real precon: 52 of 100 cards
 *  derived, so 48 were invisible to every synergy number on the page and nothing said so.**
 *
 *  IT WAS ONE PANEL AMONG FIFTEEN AND THAT WAS THE DEFECT. It shipped inside the Overview's
 *  multi-column flow, where the skeptic persona (2026-08-26) called it "prominent, honestly worded,
 *  and joined to nothing" — a reader had no way to tell WHICH numbers it limited. So it leaves the
 *  tab panel entirely and becomes a strip over the whole report, carrying the legend that draws the
 *  line: **the synergy half speaks for 52 cards; the printed-data half counts all 100.**
 *
 *  That line is not a hedge, it is the most useful sentence on the page. `detectBuildRules` matches
 *  on ORACLE TEXT and TYPE LINE, and the mana model, land count, castability, legality, bracket and
 *  combo detection all read PRINTED data — so the whole DIAGNOSIS is sound on a half-read deck and
 *  only the VERIFICATION half is limited.
 *
 *  THE SENTENCE COMES FROM THE REPORT, not from here. No subpath of `@edh-seer/matcher` is safe to
 *  value-import from client code, and a second copy of a claim is how two surfaces start disagreeing
 *  — which this repo has now measured twice (N6's number format, `DeckIdentity`'s stale caveat).
 *
 *  ABSENT WHEN THE ENGINE READ EVERYTHING: the 71 calibration decks are ~99% derived, so this is
 *  built for the arbitrary pasted list, exactly as the legality report is. */
export function CoveragePanel({ coverage, resolved, total, commanderUnread }: {
  coverage: DeckReport["coverage"];
  /** THE OTHER COUNT, FOLDED IN. `ReportView` printed "Resolved 100/100" as its own line directly
   *  under this panel — two counters, two meanings, two denominators of 100, four inches apart.
   *  Three of four personas stopped on the pair (2026-08-27) and one could not tell which was true.
   *  Name resolution and corpus reading are different questions; they now answer in one place, in
   *  the order a reader asks them. */
  resolved?: number;
  total?: number;
  /** Commanders the engine could not read. The deck's defining card being unread is the single fact
   *  a reader most needs and the one this panel buried: the name list is alphabetical and capped at
   *  eight, so on the precon `Nalia de'Arnise` sat inside "and 40 more" while every ° figure below
   *  was computed without her. All four personas reached it independently (2026-08-27). */
  commanderUnread?: readonly string[];
}) {
  // The gate qualifies every tab, so it is always on screen — which on a phone meant Cards and
  // Graph each opened with two thirds of a screen of caveat before their own content (phone
  // persona, 2026-08-27). The CLAIM stays at full weight; its EVIDENCE folds away below `sm`.
  const narrow = useIsNarrow();
  if (!coverage) return null;
  const share = coverage.resolved > 0 ? coverage.derived / coverage.resolved : 0;
  const names = (
    <p className="text-xs text-(--muted) leading-relaxed max-w-[56ch]">
      <span className="eyebrow mr-1.5">Not read</span>
      {coverage.underivedNames.map((c, i) => (
        <span key={c}>
          {i > 0 && ", "}
          <CardName name={c} />
        </span>
      ))}
      {coverage.more > 0 && ` and ${coverage.more} more`}.
    </p>
  );
  const legend = (
    <div className="flex gap-2.5 items-start">
      <span aria-hidden="true" className="text-(--accent) font-mono text-base leading-none pt-0.5">°</span>
      <p className="text-xs text-(--muted) leading-relaxed max-w-[52ch]">
        {/* THE REPORT'S OWN SENTENCE, VERBATIM. It already says both halves of the claim, so
          *  paraphrasing it here would be the second copy that starts the drift. */}
        {coverage.caveat}{" "}
        {/* The only thing added is what this SURFACE contributes: which glyph marks which figures.
          *  The engine has no view on that. */}
        <span className="text-(--foreground)">The ° mark names those figures</span> — synergy,
        themes, cut candidates and the graph.{" "}
        {/* THE CARD-LEVEL HALF OF THE SAME CLAIM, and it needs its own mark because it answers a
          *  different question. `°` says A FIGURE is computed over a subset; the hatch says THIS
          *  CARD is one of the ones left out of it. A reader meets both on the graph, where an
          *  unread card is a disc like any other and its zero is a structural one. */}
        <span className="text-(--foreground)">
          The hatch marks the cards themselves
        </span>{" "}
        <span
          aria-hidden="true"
          className="inline-block align-middle h-3 w-3 rounded-[2px] border border-(--separator) bg-(--surface-tertiary)"
          style={{ backgroundImage: hatchImage("var(--background)") }}
        />{" "}
        wherever one is drawn.
      </p>
    </div>
  );
  return (
    // NO NEGATIVE MARGINS. Bleeding a strip into the page padding made three ancestors wider than
    // their own content box and read on a real screen as content cropped off the right edge — a
    // recorded defect from the tab bar one component over. The strip stays inside the box.
    <div className="rounded-(--radius) border border-(--separator) bg-(--surface) px-4 sm:px-5 py-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 min-w-0">
          <p className="flex items-baseline gap-2.5 flex-wrap">
            <span className="text-2xl font-semibold stat-num leading-none">{coverage.derived}</span>
            <span className="text-sm text-(--muted)">of {coverage.resolved} cards read</span>
            {resolved !== undefined && total !== undefined ? (
              <span className="text-xs text-(--muted) stat-num">
                · all {resolved} of {total} lines matched a card
              </span>
            ) : null}
          </p>
          {/* The share as a bar, because "52 of 100" and "97 of 100" are different situations and a
            *  reader scanning past the number should still see which one this is. */}
          <span aria-hidden="true" className="block h-1.5 max-w-[330px] rounded-full bg-(--surface-tertiary) overflow-hidden">
            <span className="block h-full rounded-full bg-(--fill)" style={{ width: `${Math.round(share * 100)}%` }} />
          </span>
          {/* THE COMMANDER IS NAMED, ALWAYS, when it is one of the unread. Everything below — the
            *  theme, the synergy score, the graph — is then computed without the card the deck is
            *  built around, and a caveat covering 48 cards equally does not say so. */}
          {commanderUnread && commanderUnread.length > 0 ? (
            <p className="text-sm">
              <span className="text-(--warning)">
                {commanderUnread.length === 1 ? "Your commander is one of them" : "Your commanders are among them"}
              </span>
              {" — "}
              {commanderUnread.map((n, i) => (
                <span key={n}>{i > 0 && ", "}<CardName name={n} /></span>
              ))}
              . Every ° figure below is computed without{" "}
              {commanderUnread.length === 1 ? "it" : "them"}.
            </p>
          ) : null}
        </div>
        {narrow ? (
          <details>
            <summary className="eyebrow cursor-pointer text-(--muted)">
              which cards, and what the ° mark means
            </summary>
            <div className="flex flex-col gap-3 pt-3">{names}{legend}</div>
          </details>
        ) : (
          <div className="flex flex-col xl:flex-row gap-3 xl:gap-10">
            <div className="xl:basis-1/2 min-w-0">{names}</div>
            <div className="xl:basis-1/2">{legend}</div>
          </div>
        )}
      </div>
    </div>
  );
}

/** THE MARK ITSELF, so every figure limited by coverage carries the same glyph and the legend above
 *  explains all of them at once. Absent when the engine read the whole deck — a mark that is always
 *  present marks nothing. */
export function DerivedMark({ coverage }: { coverage: DeckReport["coverage"] }) {
  if (!coverage) return null;
  return (
    <span
      className="text-(--accent) font-mono align-super text-[0.7em] leading-none"
      title={`computed over the ${coverage.derived} cards the engine could read, not all ${coverage.resolved}`}
    >
      °
    </span>
  );
}
