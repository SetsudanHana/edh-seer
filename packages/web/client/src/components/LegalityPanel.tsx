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
export function LegalityPanel({ legality, companions = [] }: {
  legality: DeckReport["legality"];
  /** CR 702.139, outside the 100: named here because this is where it is judged. */
  companions?: readonly string[];
}) {
  if (!legality) return null;
  const companionClause = companions.length > 0 ? `, and ${companions.join(" and ")} as your companion` : "";
  // A CLEAN RESULT SAYS WHAT WAS CHECKED (owner, 2026-09-22). Silence was meant to read "nothing
  // found", and the deck-build agent read it as "the report never checks legality". So a deck with
  // nothing off gets one line naming the five rules and what they do NOT cover. It still never says
  // "legal": that is a claim five rules cannot make, which is what the old silence was protecting.
  if (legality.length === 0) {
    return (
      // ONE LINE, THE DETAIL ONE TAP AWAY (appeal review 2026-09-26): the full sentence was the
      // first paragraph on the page, and a clean deck needs only the word.
      <details className="text-xs text-(--muted) max-w-[65ch]">
        <summary className="cursor-pointer min-h-6 inline-flex items-center gap-1.5">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-(--success) shrink-0">
            <path d="M2 6.5l2.5 2.5L10 3.5" />
          </svg>
          {/* Never "legal": the banned list is as of the card data (owner, 2026-09-22). */}
          Deck rules checked: nothing breaks them
        </summary>
        <p className="pt-1">
          Checked against Commander&rsquo;s deck rules, and nothing breaks them: 100 cards, singleton,
          colour identity, who can lead, partner pairing and the banned list{companionClause}. The
          banned list is as of our card data, so it can lag a fresh announcement.
        </p>
      </details>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Against the format</h3>
      <ul className="flex flex-col gap-2">
        {legality.map((l) => (
          // ONE RULE CAN FIND SEVERAL THINGS (a companion outside the identity AND short of its condition),
          // so the rule alone is not a key. The detail is what differs.
          <li key={`${l.rule}:${l.detail}`} className="rounded-lg border border-(--separator) px-3 py-2">
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
        A report, not a verdict — nothing here stops the analysis. The banned list is as of the card
        data, and a card that changes deck building in a way this tool does not read is listed rather
        than passed.
      </p>
    </div>
  );
}
