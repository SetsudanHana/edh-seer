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
  identity,
  thing,
  commanderCast,
  manaAvailability,
}: {
  cohesion: DeckReport["cohesion"];
  colorIdentity?: string[];
  strategies?: DeckReport["strategies"];
  identity?: DeckReport["identity"];
  thing?: DeckReport["thing"];
  commanderCast?: NonNullable<DeckReport["deckMath"]>["castability"]["commanders"];
  /** Only to reconcile the two readouts of the same cell — never to render a second figure of its
   *  own; the mana-availability panel owns that. */
  manaAvailability?: DeckReport["manaAvailability"];
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
        {/* NAMING A DECK IS A CLAIM, AND IT CAN BE DECLINED (roadmap A15). Under the floor the
            headline is carried by one or two cards, so the title says so and the tag drops to the
            subtitle -- the same shape the CLI prints. The engine's own invariant is that a silent
            wrong answer is worse than a missing one, and this heading was the loudest place it did
            not hold. */}
        {cohesion.dominant === false ? (
          <h2 className="text-2xl font-bold leading-none text-(--muted)">No dominant theme</h2>
        ) : (
          <h2 className="text-2xl font-bold leading-none text-(--accent) capitalize">{cohesion.theme}</h2>
        )}
        <span className="text-sm text-(--muted) tabular-nums">
          {cohesion.dominant === false ? `strongest: ${cohesion.theme} · ` : ""}
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
      {/* THE THREE-SLOT SENTENCE (roadmap A16): win route · engine · means, each from the instrument
        *  that already answers it. It sits directly under the heading because the heading is the
        *  ENGINE slot alone -- and reading one slot as the whole answer is the mistake four naming
        *  designs were refused for. A null slot is dropped, never phrased: the engine clause is
        *  absent exactly when the theme layer declined to name the deck (A15). */}
      {/* THE ENGINE CLAUSE IS DROPPED HERE AND ONLY HERE: this component's own heading IS the engine
        *  slot, so printing both read as "creatures dying … fueled by creatures dying (46% of
        *  nonlands)" one line apart -- caught in a live browser, invisible to every test, which is
        *  the same way the "33 in deck" over "lands 37/36" pair was found. The CLI keeps all three,
        *  because there the sentence is its own section and the theme is printed further down under
        *  its own heading. When the theme ABSTAINS the heading says so and there is no engine clause
        *  to drop, so nothing is lost. */}
      {identity && (identity.win || identity.means) ? (
        <p className="text-sm text-(--fg) tabular-nums">
          {[identity.win, identity.means].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {/* DOES THE DECK DO ITS THING (roadmap K2), directly under the heading, because the heading
        *  NAMES the thing and this counts it. The theme phrase is deliberately not repeated -- it is
        *  the h2 one line above.
        *
        *  IT CARRIES ITS OWN CEILING (K3b): owner-judged at 95.0% precision on the cards it lists,
        *  and measured to miss about one in six a player would count. A count that looks exact and
        *  is not is the failure this whole layer is built to avoid, so the caveat is a title on the
        *  figure rather than a footnote somewhere else. */}
      {thing ? (
        <p className="text-sm text-(--fg) tabular-nums">
          <strong>{thing.count} cards</strong> do it · {Math.max(1, Math.round(thing.probability * 100))}% to have{" "}
          {thing.k} of them by turn {thing.turn}
          {thing.fromCommandZone.length > 0 ? `, plus ${thing.fromCommandZone.join(", ")} every game` : ""}
          <span className="block text-xs text-(--muted)">
            owner-judged 95% precise on what it lists; it misses roughly one in six a player would count
          </span>
        </p>
      ) : null}
      {/* WHEN IS THE COMMANDER ONLINE (roadmap K5). A RANGE, never one number, and it ships with the
        *  reason it reads low: `manaWithRocks` counts only permanents that produce mana, so a deck
        *  ramping on Farseek and Cultivate is priced without its ramp -- on the owner's own Samut
        *  deck the range is 34-43% against a simulated 55.8% (I11). A refused cost prints an em dash
        *  and never 0%, because a reader treats 0% as "cannot happen". */}
      {commanderCast && commanderCast.length > 0 ? (
        <p className="text-sm text-(--muted) tabular-nums">
          {/* SUBJECT FIRST. The first cut read "21-72% by turn 6 to cast your commander", which makes
              a reader hold a number before knowing what it is about -- seen on the live page, not in
              any test. */}
          <span>Commander castable: </span>
          {commanderCast.map((c) => {
            const odds = c.mana === null
              ? `— (${c.refused ?? "cost not modelled"})`
              : `${Math.max(1, Math.round(c.mana * 100))}–${Math.max(1, Math.round((c.manaWithRocks ?? c.mana) * 100))}% by turn ${c.turn}`;
            return `${commanderCast.length > 1 ? `${c.name}: ` : ""}${odds}`;
          }).join(" · ")}
          {/* THE CAVEAT IS VISIBLE, NOT A TOOLTIP. It was a `title` first, and a tooltip is not a
              caveat on a touch device or for anyone who never hovers -- the CLI prints this line
              outright and the web hid it. The figure is measurably LOW for a land-fetch ramp deck
              (I11: 34-43% against a simulated 55.8% on the owner's own list), so a reader who never
              hovers would take a wrong number at face value. */}
          {commanderCast.some((c) => c.mana !== null) ? (
            <span className="block text-xs text-(--muted)">
              lands and mana rocks only — land-fetch ramp like Cultivate is not counted, so this reads low
            </span>
          ) : null}
          {/* …AND THE ENGINE NOW KNOWS BY HOW MUCH, so the caveat names the better number instead of
              gesturing at it. Two readouts of the SAME cell on one page is the trap this repo
              recorded once already (the land row reading "33 in deck" above a chip reading "lands
              37/36"). ONLY WHEN IT IS LITERALLY THE SAME CELL: the commander row's `turn` is its own
              mana value, and the simulation's headline is fixed at six mana on turn six, so they
              coincide only for a six-mana commander. */}
          {manaAvailability && manaAvailability.headline.mana === manaAvailability.headline.turn
            && commanderCast.some((c) => c.mana !== null && c.turn === manaAvailability.headline.turn) ? (
              <span className="block text-xs text-(--muted)">
                the mana-availability panel models that ramp and reads{" "}
                {Math.round(manaAvailability.headline.low * 100)}–{Math.round(manaAvailability.headline.high * 100)}%
                {" "}for the same cell
              </span>
            ) : null}
        </p>
      ) : null}
      {/* The second theme and the archetype shares, on one muted line. A percentage is printed for
        *  each strategy because the list is ranked and the gaps matter — "Tokens 22% · Aristocrats
        *  14%" says something a bare ordered list does not. */}
      {cohesion.secondary || top.length > 0 ? (
        <p className="text-sm text-(--muted) tabular-nums">
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
