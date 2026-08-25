import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

/** WHAT IS OFF ABOUT THIS DECK, AS A REPORT AND NEVER A GATE (roadmap J4, plus J12's pairing rule).
 *
 *  A REFUSAL IS THE WRONG FAILURE DIRECTION HERE. A partial paste is a normal thing to hand this
 *  tool — someone testing a shell, someone mid-build, someone pasting forty cards to see what it
 *  says — and refusing to analyse any of them would be a worse product. So the analysis runs
 *  regardless and this panel sits beside it.
 *
 *  SILENCE MEANS NOTHING WAS FOUND, NOT THAT THE DECK IS LEGAL, and the copy has to say so: five
 *  rules are checked (903.5a size · 903.5b duplicates · 903.5c/d colour identity · 903.3 who may
 *  lead · 702.124 pairing) and the format has more.
 *
 *  IT FIRES ON NOTHING IN THE 71 CALIBRATION DECKS, by construction — they are the owner's own
 *  well-built lists. This exists for the arbitrary pasted one. */
export function LegalityPanel({ legality }: { legality: DeckReport["legality"] }) {
  if (!legality || legality.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Against the format</h3>
      <ul className="flex flex-col gap-2">
        {legality.map((l) => (
          <li key={l.rule} className="rounded-lg border border-(--separator) px-3 py-2">
            <p className="text-sm">{l.detail}</p>
            {l.cards.length > 0 && (
              // CAPPED AT EIGHT, as the CLI caps it: a colour-identity finding on a badly pasted
              // deck can name dozens, and a list that long stops being read.
              <p className="text-xs text-(--muted) mt-1">
                {l.cards.slice(0, 8).map((c, i) => (
                  <span key={c}>
                    {i > 0 && " · "}
                    <CardName name={c} />
                  </span>
                ))}
                {l.cards.length > 8 && ` … and ${l.cards.length - 8} more`}
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-(--muted)">
        A report, not a verdict — nothing here stops the analysis. Five rules are checked and the
        format has more, so an empty list means nothing was <em>found</em>.
      </p>
    </div>
  );
}
