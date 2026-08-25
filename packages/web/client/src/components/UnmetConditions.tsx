import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

/** WHAT THE DECK CANNOT TURN ON — the deck-level half of the conditional-land family (roadmap I9).
 *
 *  THE PAIRWISE PASS STATES THE POSITIVE AND CAN SAY NOTHING WHEN THE ANSWER IS ZERO. "Rootbound
 *  Crag enters untapped because you run Steam Vents" is an edge; a Crag with no supplier forms no
 *  edge, shows no row, and reads to a player exactly like a land with no condition on it at all.
 *  This is the surface for that silence.
 *
 *  A REASON, NEVER A GATE, and the copy has to carry it: the card still taps for mana and still
 *  rates. `draguns` runs Mistrise Village — a BLUE land whose condition names Mountain or Forest —
 *  and it enters tapped every game forever, which is worth telling the reader and is not worth
 *  demoting the card over. */
export function UnmetConditions({ landConditions }: { landConditions: DeckReport["landConditions"] }) {
  if (!landConditions || landConditions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Conditions this deck cannot meet</h3>
      <p className="text-sm text-(--muted)">
        These cards ask the board for something the deck never provides. They still work — a land
        still taps for mana — but the printed upside never turns on.
      </p>
      <ul className="flex flex-col gap-2">
        {landConditions.map((l) => (
          <li key={l.card} className="rounded-lg border border-(--separator) px-3 py-2">
            <div className="text-sm"><CardName name={l.card} /></div>
            <p className="text-xs text-(--muted)">Wants {l.wants} — {l.has}.</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
