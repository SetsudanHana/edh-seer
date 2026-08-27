import type { DeckReport } from "../types.js";

/** WHAT TO ADD, MINUS WHATEVER A FINDING ALREADY SAID.
 *
 *  Every suggestion is generated from a build parent under target — and so is a finding, which
 *  prints the same sentence as its own action line beside the evidence that motivates it. So this
 *  panel restated, verbatim, prescriptions the reader had already been given three screens up: an
 *  IA review (2026-08-27) found that on the review deck its entire novel content was a refusal.
 *
 *  Two copies of a sentence is how two surfaces start disagreeing — the N6 defect as information
 *  architecture. The finding keeps the prescription, because that is where the argument for it is;
 *  this list keeps whatever the findings did not reach, and renders nothing when that is empty. */
export function SuggestionsList({ suggestions, shownAsFindings = [] }: {
  suggestions: DeckReport["suggestions"];
  /** Parent names already carrying this prescription as a finding action. */
  shownAsFindings?: readonly string[];
}) {
  const unseen = (suggestions ?? []).filter(
    (s) => !shownAsFindings.some((name) => s.startsWith(`${name} `)),
  );
  if (unseen.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Suggestions</h3>
      {/* A SENTENCE KEEPS INTER — "Consistency 6/14 — add ~8, typically 2–4 mana" is prose with
        *  figures in it, and `index.css`'s own `.stat-num` comment reserves mono for a figure.
        *  `tabular-nums` keeps the counts from shifting without making the words monospace. */}
      <ul className="flex flex-wrap gap-2">
        {unseen.map((s) => (
          <li key={s} className="text-sm tabular-nums rounded-full border border-(--separator) px-3 py-1 text-(--muted)">{s}</li>
        ))}
      </ul>
    </div>
  );
}
