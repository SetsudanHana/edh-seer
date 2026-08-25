import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

/** WHICH TABLE THIS DECK IS FOR — WotC's official Commander Brackets, read off two published lists
 *  the engine already carries (roadmap L3).
 *
 *  IT DESCRIBES AND NEVER GRADES, and the copy has to carry that or a number between 1 and 5 reads
 *  as a score out of five sitting one panel away from two real scores out of five. A bracket 4 deck
 *  is not a worse deck than a bracket 2 deck; it is a deck for a different table, and the only
 *  useful thing to tell a reader is which contents put it there.
 *
 *  THREE BANDS, and the missing precision is stated rather than hidden: 1 vs 2 is about how the deck
 *  was BUILT and 4 vs 5 is a META judgement, neither of which is a checkable list. */
export function BracketPanel({ bracket }: { bracket: DeckReport["bracket"] }) {
  if (!bracket) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Which table this is for</h3>
      <div className="flex items-baseline gap-3">
        <span className="stat-num text-2xl">Bracket {bracket.band}</span>
        <span className="text-xs text-(--muted)">by what the deck contains, not how good it is</span>
      </div>

      {bracket.band === "1-2" ? (
        <p className="text-sm text-(--muted)">No Game Changers and no infinite combo.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {bracket.gameChangers.length > 0 && (
            <li className="rounded-lg border border-(--separator) px-3 py-2">
              <div className="eyebrow">
                {bracket.gameChangers.length} Game Changer{bracket.gameChangers.length === 1 ? "" : "s"}
              </div>
              {/* Named, not counted: the list is WotC's and a reader deciding whether to swap one
                *  out needs to know which card it is. */}
              <p className="text-xs text-(--muted)">
                {bracket.gameChangers.map((n, i) => (
                  <span key={n}>{i > 0 ? ", " : ""}<CardName name={n} /></span>
                ))}
              </p>
            </li>
          )}
          {bracket.infiniteCombos > 0 && (
            <li className="rounded-lg border border-(--separator) px-3 py-2">
              <div className="eyebrow">
                {bracket.infiniteCombos} infinite combo{bracket.infiniteCombos === 1 ? "" : "s"}
              </div>
              <p className="text-xs text-(--muted)">
                Any infinite combo puts a deck above brackets 1–2.
              </p>
            </li>
          )}
          {bracket.cheapCombos.map((c) => (
            <li key={c.cards.join("|")} className="rounded-lg border border-(--separator) px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm">
                  {c.cards.map((n, i) => (
                    <span key={n}>{i > 0 ? " + " : ""}<CardName name={n} /></span>
                  ))}
                </span>
                <span className="text-xs stat-num text-(--muted)">{c.manaValue} mana total</span>
              </div>
              <p className="text-xs text-(--muted)">A cheap two-card infinite combo — what bracket 3 rules out.</p>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-(--muted)">
        Bands, not single numbers: 1 vs 2 is about how the deck was built and 4 vs 5 is about the
        table you sit at. Neither of those is something a card list can answer.
      </p>
    </div>
  );
}
