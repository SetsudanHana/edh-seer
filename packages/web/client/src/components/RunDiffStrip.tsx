import type { RunDiff } from "../lib/run-diff.js";

const LABEL: Record<string, string> = {
  ramp: "ramp", draw: "draw", cardSelection: "card selection", targetedRemoval: "removal",
  stackInteraction: "stack interaction", boardWipe: "board wipes", burn: "burn & drain", stax: "stax",
  protection: "protection", tutor: "tutors", graveyardHate: "graveyard hate", lands: "lands",
};

const signed = (from: number, to: number): string => `${to > from ? "+" : ""}${(to - from).toFixed(1)}`;

/** A list of card names, capped — the strip is one glance, and a 20-card paste is a new deck being
 *  described rather than an edit being reported. */
function Names({ verb, names }: { verb: string; names: string[] }) {
  if (names.length === 0) return null;
  const shown = names.slice(0, 4);
  const extra = names.length - shown.length;
  return (
    <span>
      {verb} <span className="text-(--foreground)">{shown.join(", ")}</span>
      {extra > 0 ? ` and ${extra} more` : ""}
    </span>
  );
}

/** WHAT YOUR LAST EDIT DID, in one line above the report.
 *
 *  Deliberately NOT a per-card rating diff. A rating is `score / deckMax`, so adding one strong card
 *  moves every other card's number without anything about those cards changing — a table of 94
 *  deltas would be mostly renormalisation, presented as if the deck had shifted under the reader.
 *  What survives is what the user can attribute: the cards they changed, the two headline scores,
 *  the theme, and the build counts those cards moved.
 *  → `specs/2026-08-20-report-usability-review.md` §5
 */
export function RunDiffStrip({ diff }: { diff: RunDiff | null }) {
  if (!diff) return null;
  const parts: React.ReactNode[] = [];
  if (diff.synergy) {
    parts.push(
      <span key="syn">
        SYNERGY <span className="text-(--foreground) tabular-nums">{diff.synergy.from.toFixed(1)} → {diff.synergy.to.toFixed(1)}</span>{" "}
        ({signed(diff.synergy.from, diff.synergy.to)})
      </span>,
    );
  }
  if (diff.build) {
    parts.push(
      <span key="build">
        BUILD <span className="text-(--foreground) tabular-nums">{diff.build.from.toFixed(1)} → {diff.build.to.toFixed(1)}</span>{" "}
        ({signed(diff.build.from, diff.build.to)})
      </span>,
    );
  }
  if (diff.theme) {
    parts.push(
      <span key="theme" className="capitalize">
        theme <span className="text-(--foreground)">{diff.theme.from} → {diff.theme.to}</span>
      </span>,
    );
  }
  for (const c of diff.categories.slice(0, 3)) {
    parts.push(
      <span key={c.category}>
        {LABEL[c.category] ?? c.category}{" "}
        <span className="text-(--foreground) tabular-nums">{c.from} → {c.to}</span>
      </span>,
    );
  }
  if (diff.added.length > 0) parts.push(<Names key="added" verb={`+${diff.added.length}`} names={diff.added} />);
  if (diff.removed.length > 0) parts.push(<Names key="removed" verb={`−${diff.removed.length}`} names={diff.removed} />);

  return (
    <div className="flex flex-col gap-1 rounded-(--radius) border border-(--separator) px-4 py-2">
      <span className="eyebrow">Since your last run</span>
      <p className="text-sm text-(--muted) flex flex-wrap gap-x-2 gap-y-1">
        {parts.map((p, i) => (
          <span key={i} className="flex items-baseline gap-2">
            {i > 0 ? <span aria-hidden className="text-(--separator)">·</span> : null}
            {p}
          </span>
        ))}
      </p>
    </div>
  );
}
