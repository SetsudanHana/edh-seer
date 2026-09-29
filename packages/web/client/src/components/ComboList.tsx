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
 *  CEILING: the honest fix is keeping the array through the pipeline, which costs a re-ingest.
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
        // A BARE "None found." ON AN EMPTY PANEL READ AS A PAGE STILL LOADING (review 2026-09-24).
        // Say what was checked, so the zero reads as an answer.
        <p className="text-(--muted) text-sm">
          No known infinite combos in this list, checked against the Commander Spellbook database.
        </p>
      ) : (
        // A GRID OF CARDS, AS WIDE AS THE PAGE ALLOWS (designer review 2026-09-29): one text line per
        // combo ended at 40% of a 1920 screen, 20% of a 3840 one, under a divider that ran the full
        // width. A phone still gets one column.
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,24rem),1fr))]">
          {combos.map((c, i) => (
            <li key={i} className="flex flex-wrap items-center content-start gap-x-3 gap-y-1 rounded-(--radius) border border-(--separator) bg-(--surface) p-3">
              <span className="pip shrink-0">{c.cards.length + (c.requires?.length ?? 0)}</span>
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
                  {/* A PIECE NAMED BY KIND, not by card (#568): "+ any creature with undying". */}
                  {(c.requires ?? []).map((r, k) => (
                    <span key={`req-${k}`} className="font-normal">
                      <span className="text-(--muted)"> + </span>any {r.toLowerCase()}
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
              {/* A LOOP'S PAYOFF IS ITS WIN (owner, 2026-09-29): the cards in this deck that eat what the
                *  loop repeats and reach the opponents, found in the graph rather than the database. */}
              {c.payoffs?.length ? (
                <span className="basis-full text-xs text-(--muted) flex flex-wrap items-baseline gap-1" data-testid="combo-payoffs">
                  Wins through
                  {c.payoffs.map((p, k) => (
                    <span key={p.name}>
                      {k > 0 ? ", " : " "}
                      <CardName name={p.name} />
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
