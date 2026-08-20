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
  label, score, sub, children,
}: { label: string; score: number; sub?: string; children?: React.ReactNode }) {
  const band = scoreBand(score);
  return (
    <div className="flex-1 min-w-0 flex flex-col gap-0.5 rounded-lg border border-(--separator) p-4">
      <span className="eyebrow">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`text-3xl font-semibold tabular-nums ${TONE_CLASS[band.tone]}`}>{score.toFixed(1)}</span>
        <span className="text-sm text-(--muted)">/5</span>
      </span>
      <span className={`text-sm ${TONE_CLASS[band.tone]}`}>{band.label}</span>
      {sub ? <span className="text-xs text-(--muted)">{sub}</span> : null}
      {children}
    </div>
  );
}

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
        <ScoreTile label="SYNERGY" score={synergyOverall} sub={sub}>
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
