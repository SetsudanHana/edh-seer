import type { DeckReport } from "../types.js";
import { CardName } from "./card-drawer.js";

/** HOW MUCH OF THE DECK THE SYNERGY ENGINE COULD READ — the admission that was missing entirely.
 *
 *  `MissingCards` reports names that failed to RESOLVE. A card that resolves and carries no derived
 *  tags is a different failure and looked identical to a fully analysed one: it forms no edges,
 *  carries no theme and cannot reach an archetype. **Measured on a real precon: 52 of 100 cards
 *  derived, so 48 were invisible to every synergy number on the page and nothing said so.**
 *
 *  IT LEADS THE COLUMN, above the legality panel, for the same reason legality leads it today:
 *  every number below is computed over the part of the deck the engine could read, and a reader who
 *  is not told that will read a half-deck figure as a whole-deck one.
 *
 *  THE SENTENCE COMES FROM THE REPORT, not from here. No subpath of `@mtg/matcher` is safe to
 *  value-import from client code, and a second copy of a claim is how two surfaces start disagreeing
 *  — which this repo has now measured twice (N6's number format, `DeckIdentity`'s stale caveat).
 *
 *  ABSENT WHEN THE ENGINE READ EVERYTHING: the 71 calibration decks are ~99% derived, so this panel
 *  is built for the arbitrary pasted list, exactly as the legality one is. */
export function CoveragePanel({ coverage }: { coverage: DeckReport["coverage"] }) {
  if (!coverage) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">What this report could not read</h3>
      <div className="rounded-lg border border-(--separator) px-3 py-2">
        <p className="text-sm">{coverage.caveat}</p>
        <p className="text-xs text-(--muted) mt-1">
          {coverage.underivedNames.map((c, i) => (
            <span key={c}>
              {i > 0 && " · "}
              <CardName name={c} />
            </span>
          ))}
          {coverage.more > 0 && `, and ${coverage.more} more`}
        </p>
      </div>
    </div>
  );
}
