import type { DeckReport } from "../types.js";
import { identityGradient, identityLabel } from "../lib/color-identity.js";

/** WHAT IS THIS DECK — answered by the instrument built to answer it.
 *
 *  This headline took `strategies[0].label` for three weeks (8de3c72, 2026-08-01), and on a wizard
 *  tribal deck that reads "Tokens" — a 22% card-signal share that merely edged Aristocrats' 14% —
 *  while `cohesion.theme` read "wizards entering · 0.60 · highly focused" and appeared NOWHERE else
 *  in the report. The stronger answer was computed and discarded.
 *
 *  THE REASON IT WAS DISCARDED WAS REAL AND IS NOW STALE, which is the only thing that makes this
 *  safe to flip. On 2026-08-01 a cohesion theme was routinely a bare functional role: `rankThemes`
 *  was handed `UNIFORM_STATS`, so `globalIDF` was `log 2` for every tag, ranking collapsed to raw
 *  frequency and SEVEN OF EIGHT decks themed "draw" (fixed 0c59087) — and `BARE_LABELS` rendered a
 *  structured theme as its bare verb, so `enters:wizard` printed as "enters" (fixed 38e5248). Both
 *  landed 2026-08-18, and A1/A3/A9/A10/A11 then took the modal headline from 16 of 71 decks to 9,
 *  distinct headlines 21 → 36, and made the score hand-checkable against a decklist.
 *
 *  So cohesion leads and the archetype shares follow it. They are not competing answers: the theme
 *  is what the deck's cards WATCH FOR, the strategies are which named archetypes its cards signal,
 *  and a reader wants the first as a title and the second as context.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F1
 */
export function DeckIdentity({
  cohesion,
  colorIdentity,
  strategies,
}: {
  cohesion: DeckReport["cohesion"];
  colorIdentity?: string[];
  strategies?: DeckReport["strategies"];
}) {
  if (!cohesion) return null;
  // The share is printed beside the label because the label alone is a bucket boundary: "focused"
  // spans 0.3 to 0.6, and 0.31 and 0.59 are different decks. Two decimals, since the whole scale
  // lives inside one unit.
  const focus = `${cohesion.label} · ${cohesion.score.toFixed(2)}`;
  // The WIDER FAMILY, and only when it differs — the same rule the CLI settled on (A10). A specific
  // primary measures itself, so "daleks entering · 0.08" is true and reads as a broken deck until
  // you are also told the family it sits inside is 0.46.
  const family =
    cohesion.familyScore !== undefined && cohesion.familyScore.toFixed(2) !== cohesion.score.toFixed(2)
      ? cohesion.familyScore.toFixed(2)
      : null;
  const top = (strategies ?? []).slice(0, 3);
  return (
    <div className="border border-(--border) rounded-(--radius) p-5 bg-(--surface) flex flex-col gap-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="eyebrow shrink-0">Deck identity</span>
        <h2 className="text-2xl font-bold leading-none text-(--accent) capitalize">{cohesion.theme}</h2>
        <span className="text-sm text-(--muted)">
          {focus}
          {family ? ` (wider family ${family})` : ""}
        </span>
        {colorIdentity && colorIdentity.length > 0 ? (
          // Only shown when the deck actually has a color identity (a resolved
          // commander). A deck with no commander reports [] here — showing a
          // "Colorless" swatch for a deck full of colored cards is misleading, so
          // suppress it rather than claim the deck is colorless.
          <span className="flex items-center gap-1.5 ml-auto">
            <span
              aria-hidden="true"
              className="w-10 h-5 rounded-[4px] border border-(--border)"
              style={{ background: identityGradient(colorIdentity) }}
            />
            <span className="text-xs text-(--muted) font-mono">{identityLabel(colorIdentity)}</span>
          </span>
        ) : null}
      </div>
      {/* The second theme and the archetype shares, on one muted line. A percentage is printed for
        *  each strategy because the list is ranked and the gaps matter — "Tokens 22% · Aristocrats
        *  14%" says something a bare ordered list does not. */}
      {cohesion.secondary || top.length > 0 ? (
        <p className="text-sm text-(--muted)">
          {cohesion.secondary ? <span>also cares about {cohesion.secondary}</span> : null}
          {cohesion.secondary && top.length > 0 ? <span> · </span> : null}
          {top.length > 0 ? (
            <span>
              signals {top.map((s) => `${s.label} ${Math.round(s.confidence * 100)}%`).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
