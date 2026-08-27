import type { DeckReport } from "../types.js";
import { scoreBand, type ScoreTone } from "../lib/score-band.js";
import { Explain } from "./Explain.js";

const TONE_CLASS: Record<ScoreTone, string> = {
  low: "text-(--danger)",
  mid: "text-(--warning)",
  good: "text-(--success)",
  high: "text-(--success)",
};

/** The four bands, printed rather than hidden in a `title`. A tooltip does not exist on touch at
 *  all, and a reader who cannot see where 4.1 sits on the scale cannot read the tile — which is the
 *  page's lead. */
const BANDS = "0–1.5 unfocused · 1.5–3 developing · 3–4 focused · 4–5 tuned";

function ScoreTile({
  label, score, sub, children, partial,
}: { label: string; score: number; sub?: string; children?: React.ReactNode;
  /** The score is computed over less than the whole deck. See `HeadlineScores`. */
  partial?: { derived: number; resolved: number } }) {
  const band = scoreBand(score);
  // A MEASUREMENT KEEPS ITS NUMBER; A VERDICT DOES NOT SURVIVE A HALF-READ DECK. See the component
  // comment below: the tone colour and the band word are the JUDGEMENT half, and they are the two
  // things a partially-read deck has not earned.
  const tone = partial ? "" : TONE_CLASS[band.tone];
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-0.5 rounded-lg border border-(--separator) p-4">
      <span className="eyebrow">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`text-3xl font-semibold stat-num ${tone}`}>{score.toFixed(1)}</span>
        <span className="text-sm text-(--muted) stat-num">/5</span>
      </span>
      {partial ? (
        <span className="text-sm text-(--muted)">
          over the {partial.derived} of {partial.resolved} cards read — too little to call this
          focused or not
        </span>
      ) : (
        <span className={`text-sm ${TONE_CLASS[band.tone]}`}>{band.label}</span>
      )}
      {/* "breadth 4.2 · anchor 5.0" is a sentence, not a table cell -- stays the body face, tabular
        *  only so the two figures don't shift the "·" between them on re-render. */}
      {sub ? <span className="text-xs text-(--muted) tabular-nums">{sub}</span> : null}
      {children}
    </div>
  );
}

/** THE GATE AND THE VERDICT USED TO CONTRADICT EACH OTHER, AND THE VERDICT WON.
 *
 *  The top of the report says the engine read 52 of 100 cards. Three screens later this tile printed
 *  `SYNERGY 0.8 / 5` in DANGER RED under the word "Unfocused" — a figure computed entirely from
 *  edges, on a deck where 48 cards form no edge by construction. An adversarial IA review named it
 *  (2026-08-27): that is the engine's blindness rendered as the player's failure, and it is this
 *  repo's own rule — a silent wrong answer is worse than a missing one — broken at the most
 *  judgemental spot on the page.
 *
 *  THE SPLIT IS THE ONE THE GATE ALREADY DRAWS, so no threshold is invented. `synergyOverall` is
 *  EDGE-derived and loses its judgement rendering the moment any card is unread; `buildScore` counts
 *  ROLES off printed text and type lines, which an unread card still has, so it keeps its band.
 *
 *  THE NUMBER STAYS. Refusing to show it would be a second wrong answer — it is a real measurement
 *  over the cards the engine could read, and the tile now says exactly that instead of grading it. */
export function HeadlineScores({ report }: { report: DeckReport }) {
  const { synergyOverall, buildScore, positiveCoherence, anchoring, cards } = report;
  if (synergyOverall === undefined && buildScore === undefined) return null;
  const sub =
    positiveCoherence !== undefined || anchoring !== undefined
      ? `breadth ${(positiveCoherence ?? 0).toFixed(1)} · anchor ${(anchoring ?? 0).toFixed(1)}`
      : undefined;
  // WHICH CARD THE ANCHOR IS. The figure is computed from the single best-fed card's authority, and
  // that card is sitting 300px to the right of this tile wearing an "⚡ anchor" tag with nothing
  // connecting the two. Recomputed here on the same basis the engine uses (max authority) rather
  // than shipped as a new field.
  const anchorCard = [...(cards ?? [])].sort((a, b) => (b.authority ?? 0) - (a.authority ?? 0))[0];
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {synergyOverall !== undefined ? (
        <ScoreTile
          label="SYNERGY"
          score={synergyOverall}
          sub={sub}
          partial={report.coverage
            ? { derived: report.coverage.derived, resolved: report.coverage.resolved }
            : undefined}
        >
          <Explain label="what this measures">
            The mean of two halves, each 0–5. <span className="text-(--foreground)">Breadth</span> is
            how much of the deck sits on its main theme, counting each nonland card by its strongest
            on-theme edge — a card connected to nothing still counts, and drags it down.{" "}
            <span className="text-(--foreground)">Anchor</span> is how heavily the deck's best-fed
            card is supported
            {anchorCard ? <> — here that is {anchorCard.name}</> : null}; it tops out at 5, so two
            decks with very different engines can both read 5.0. {BANDS}.
          </Explain>
        </ScoreTile>
      ) : null}
      {buildScore !== undefined ? (
        <ScoreTile label="BUILD" score={buildScore}>
          <Explain label="what this measures">
            How close the deck sits to the category targets in the benchmarks below — ramp, draw,
            removal and the rest. It says nothing about how the cards work together, and the targets
            are a deckbuilding convention rather than a number measured from any deck. {BANDS}.
          </Explain>
        </ScoreTile>
      ) : null}
    </div>
  );
}
