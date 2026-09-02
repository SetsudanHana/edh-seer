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
 *  was BUILT and 4 vs 5 is a META judgement, neither of which is a checkable list.
 *
 *  AND IT DRAWS AS A BAND, NOT AS A NUMBER (roadmap S2, journey rule 7: a deck-relative dial and a
 *  WotC band must not read as the same scale). `Bracket 4-5` shipped as a 24px `stat-num` one
 *  column from SYNERGY and BUILD, both genuinely out of five -- so the one figure on this page that
 *  is NOT a score was the one wearing a score's clothes. Three cells cannot be read as "x out of
 *  5"; a big numeral can, and the sentence beside it was the only thing saying otherwise. */

/** The three bands, in the order WotC publishes them. A literal rather than derived from the union
 *  so the ORDER is stated once here instead of falling out of however `band` happens to be typed --
 *  the band's whole job is to put the deck somewhere on a line, and a line needs an order. */
const BANDS = ["1-2", "3", "4-5"] as const;

/** The band's cell labels use an EN DASH; the wire's `band` uses a hyphen, and they are different
 *  things: one is a range a reader sees, the other is a key the client joins on. */
const CELL_LABEL: Record<(typeof BANDS)[number], string> = { "1-2": "1–2", "3": "3", "4-5": "4–5" };

export function BracketPanel({ bracket }: { bracket: DeckReport["bracket"] }) {
  if (!bracket) return null;
  // ONE PIP PER PIECE OF EVIDENCE THE LIST BELOW NAMES, so the eye goes band -> why without
  // reading. Counted, never summed from `reasons`: that field is a second rendering of these same
  // facts and the panel already prints the more checkable one (named cards, per-combo rows).
  /** EVERY CHEAP COMBO IS ALREADY AN INFINITE ONE, so adding both counts each of them twice.
   *  `brackets.ts` derives `cheapCombos` by FILTERING `infinite` (two cards or fewer, mana value at
   *  or under `CHEAP_COMBO_MV`) — it is a subset by construction, never a separate set.
   *
   *  Measured on the example deck (S16, 2026-09-02): 1 Game Changer + 5 infinite combos, all five
   *  of them cheap, painted **11 pips over a list of six things**. A skeptic counted the list,
   *  found six, and could not reconcile it: *"eleven dots are painted, so the count is deliberate;
   *  nothing names the other five."* The count was simply wrong. */
  const pips = bracket.gameChangers.length + bracket.infiniteCombos;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Which table this is for</h3>
      {/* The text form stays, at label size rather than display size: it is what a screen reader
        *  reads and what a reader copies into a pod chat, and the band above cannot be either. */}
      <div className="flex flex-col gap-1.5">
        {/* ONE TRACK, SEGMENTED -- not three pills. Three separately bordered, separately rounded
          *  cells with one filled are built exactly like this app's own tab strip, and a judge said
          *  so: "I can't tell whether the panel is reporting a result or offering me a choice, and
          *  pressing one might change my deck's answer". A band REPORTS; a tab strip INVITES, and
          *  the difference has to be visible before the copy is read. The outer border and radius
          *  belong to the whole track, the cells are divided by hairlines, and nothing here has a
          *  pill's shape. */}
        <div
          className="flex overflow-hidden rounded-(--radius) border border-(--separator)"
          role="img"
          aria-label={`Bracket ${bracket.band} of WotC's five Commander brackets`}
        >
          {BANDS.map((b, i) => {
            const here = b === bracket.band;
            return (
              <span
                key={b}
                data-testid="bracket-cell"
                data-here={here ? "1" : undefined}
                className={`flex-1 text-center stat-num text-sm py-1.5 ${
                  i > 0 ? "border-l border-(--separator)" : ""
                } ${
                  here
                    // --fill, NOT --accent: index.css is explicit that a large filled area takes the
                    // ladder's mid-violet and reads as substrate, while the accent is meant to be
                    // scarce. A bracket is not an alert.
                    ? "bg-(--fill) text-(--foreground)"
                    : "text-(--muted)"
                }`}
              >
                {CELL_LABEL[b]}
              </span>
            );
          })}
        </div>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-sm">Bracket {bracket.band}</span>
          {/* THE PIPS CARRY A WORD, because bare ones carried nothing. A judge did not see them at
            *  all until asked and then could not decode them: "two marks, no legend, no text, I'd
            *  have to guess what they count". The count is what the row is FOR -- a deck with eight
            *  Game Changers and one with one are different situations, and the list below says so
            *  only after it is read. */}
          {pips > 0 ? (
            <span className="flex items-baseline gap-1.5 text-xs text-(--muted)">
              <span className="flex items-center gap-1" aria-hidden="true">
                {Array.from({ length: pips }, (_, i) => (
                  <span key={i} data-testid="bracket-pip" className="h-1.5 w-1.5 rounded-full bg-(--fill)" />
                ))}
              </span>
              {pips === 1 ? "one thing puts it here" : `${pips} things put it here`}
            </span>
          ) : null}
        </div>
        <p className="text-xs text-(--muted)">by what the deck contains, not how good it is</p>
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
