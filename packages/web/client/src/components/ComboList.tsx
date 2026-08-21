import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

function ArrowIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

/** How many results a row leads with. The rest are counted, not hidden: a combo producing thirteen
 *  things is a real fact about it, and "+10 more" says so in four characters where the full list
 *  took three lines a reader skips.
 *
 *  `result` arrives as one string because `spellbook.ts` joins Commander Spellbook's `produces`
 *  array at INGEST — so this splits what was joined. Lossless for every result in the corpus today
 *  (a feature name is a phrase like "Infinite creature tokens with haste"); a name that contained a
 *  comma would render as two shorter clauses, which is cosmetic rather than a wrong claim.
 *  ponytail: the honest fix is keeping the array through the pipeline, which costs a re-ingest.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F10 */
const RESULTS_SHOWN = 3;

export function ComboList({ combos }: { combos: DeckReport["combos"] }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="eyebrow">Combos</h3>
      {/* WHERE THESE COME FROM, which also says why the STEPS are not here: the combo database is an
        *  external list of card sets and what they produce, not a derivation this engine performs,
        *  so it can say what a set does and not how. */}
      {combos.length > 0 ? (
        <p className="text-xs text-(--muted)">
          Card sets known to go infinite together, from the Commander Spellbook database — what they
          produce, not how to assemble it.
        </p>
      ) : null}
      {combos.length === 0 ? (
        <p className="text-(--muted) text-sm">None found.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {combos.map((c, i) => (
            <li key={i} className="flex items-center gap-3 py-1.5 border-b border-(--separator)">
              <span className="pip shrink-0">{c.cards.length}</span>
              <span className="text-sm flex items-center gap-2 flex-wrap">
                {/* Each piece opens its own inspector: "these three go infinite" is only
                    actionable once you can ask what each one is doing. */}
                <span className="font-semibold flex flex-wrap items-baseline gap-1">
                  {c.cards.map((name, k) => (
                    <span key={name}>
                      {k > 0 ? <span className="text-(--muted) font-normal"> + </span> : null}
                      <CardName name={name} />
                    </span>
                  ))}
                </span>
                <span className="text-(--accent)">
                  <ArrowIcon />
                </span>
                {(() => {
                  // `?? ""` because a combo row arriving without a result is a database gap, and a
                  // gap should render as no results rather than take the tab down.
                  const results = (c.result ?? "").split(", ").filter(Boolean);
                  const shown = results.slice(0, RESULTS_SHOWN);
                  const extra = results.length - shown.length;
                  return (
                    <span title={c.result}>
                      {shown.join(" · ")}
                      {extra > 0 ? <span className="text-(--muted)"> +{extra} more</span> : null}
                    </span>
                  );
                })()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
