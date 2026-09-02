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
   *  eight, so on the precon `Nalia de'Arnise` sat inside "and 40 more" while the synergy score,
   *  the themes and the graph below were all computed without her. All four personas reached it independently (2026-08-27). */
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
  /* ONE CONVENTION, NOT TWO (S13, owner call 2026-09-02). This paragraph used to open with a `°`
    *  and promise that the same glyph named four figures -- synergy, themes, cut candidates and the
    *  graph. It rendered on ONE thing, a chapter heading, and a judge went looking for it beside
    *  `SYNERGY` and found the only `°` on the page was the one OPENING this sentence.
    *
    *  Checking the four is what retired the mark rather than spreading it. Three already carried a
    *  STRONGER signal than a glyph could: the synergy dial prints "too little of the deck read to
    *  call this" under the number (`scoreState(score, partial)`), `CutList` takes `coverage` and
    *  refuses to rank the unread by name, and the graph draws the hatch per node. Only themes was
    *  silent, and `ArchetypeBoard` now says it in words like the other three. A second glyph
    *  convention beside sentences that already say more was the thing to delete. */
  const legend = (
    /* THE SPECIMEN SITS IN THE SENTENCE THAT NAMES IT, which is how S1 shipped it and it was worth
     * not losing: with the `°` gone I first moved the swatch into the glyph's old lead position,
     * and on screen it read as a bullet two lines away from the words "The hatch", leaving a reader
     * to connect them. A key is only a key next to its claim. */
    <p className="text-xs text-(--muted) leading-relaxed max-w-[52ch]">
      {/* THE REPORT'S OWN SENTENCE, VERBATIM. It already says both halves of the claim, so
        *  paraphrasing it here would be the second copy that starts the drift. */}
      {coverage.caveat}{" "}
      {/* What this SURFACE contributes: the hatch is now the page's only coverage mark, so the
        *  legend explains it and says where the FIGURE-level limit is stated instead -- in the
        *  figure's own words, beside the figure. */}
      <span className="text-(--foreground)">The hatch</span>{" "}
      <span
        aria-hidden="true"
        className="inline-block align-middle h-3 w-3 rounded-[2px] border border-(--separator) bg-(--surface-tertiary)"
        style={{ backgroundImage: hatchImage("var(--background)") }}
      />{" "}
      <span className="text-(--foreground)">marks those cards</span> wherever one is drawn.{" "}
      <span className="text-(--foreground)">A figure computed without them says so in its own
      words</span>, beside the figure.
    </p>
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
            {/* "CARDS", NOT "LINES", AND THE WORD WAS THE WHOLE DEFECT (S12, filed from S1's
              *  judging round). `DeckInput`'s collapsed summary counts non-blank TEXT LINES of the
              *  paste and prints "87 lines"; this counted CARD SLOTS -- `parseDecklistSections`
              *  pushes one entry per copy, so `3 Plains` is one line and three of them -- and said
              *  "lines" too. Both facts were right and eleven hundred pixels apart, 87 against 100,
              *  and the judge could not tell which quantity "100 of 100 lines matched" was a
              *  statement about. It is the sentence carrying the report's only 100%, so the one
              *  that was using the word wrongly is the one that stopped. "all" went with it: it was
              *  printed unconditionally and would have read "all 95 of 100" on a deck with five
              *  unresolved names. */}
            {resolved !== undefined && total !== undefined ? (
              <span className="text-xs text-(--muted) stat-num">
                · {resolved} of {total} cards matched a name
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
              . The synergy score, the themes and the graph below are all computed without{" "}
              {commanderUnread.length === 1 ? "it" : "them"}.
            </p>
          ) : null}
        </div>
        {narrow ? (
          <details>
            <summary className="eyebrow cursor-pointer text-(--muted)">
              which cards, and what the hatch means
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
