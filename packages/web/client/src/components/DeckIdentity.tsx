import type { DeckReport } from "../types.js";
import { identityLabel } from "../lib/color-identity.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { Explain } from "./Explain.js";
import { percent, policyBand } from "@edh-seer/engine/percent";

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
  coverage,
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
  /** Present only when the engine could NOT read the whole deck. The theme, its share and the
   *  "no dominant theme" verdict are all EDGE-derived, so on a partly-read deck they are computed
   *  over a fraction of the cards — and "No dominant theme · unfocused · 0.08" reads as a judgement
   *  on the deck rather than a statement about what the engine could see. Same correction as
   *  `HeadlineScores`, and the same split: this is the synergy half, so it declines to grade. */
  coverage?: DeckReport["coverage"];
}) {
  if (!cohesion) return null;
  // The share is printed beside the label because the label alone is a bucket boundary: "focused"
  // spans 0.3 to 0.6, and 0.31 and 0.59 are different decks. Two decimals, since the whole scale
  // lives inside one unit.
  // THE SHARE IS A MEASUREMENT AND THE LABEL IS A VERDICT. On a partly-read deck the number stays
  // and the word goes — "unfocused" is not a thing the engine can say about a deck it read half of.
  // A SHARE WITH ITS DENOMINATOR, WHICH IS WHAT IT NEVER HAD (roadmap T4). This read
  // "focused · 0.47", and the owner's question about it was "what does it even mean" -- the two
  // numbers 0.47 is the ratio of were computed and thrown away. It also collided with the 0-5 deck
  // score's own "Focused" band one panel over; `cohesionLabel` no longer uses that word.
  const pct = Math.round(cohesion.score * 100);
  // THE DENOMINATOR NEEDS NO BRIDGE ANY MORE (roadmap T3, 2026-09-03). It used to carry
  // "(4 modal DFCs count as lands)", because the glance line above counted FRONT faces (66 on the
  // example deck) while `cohesion.nonlandCount` applies the 2026-08-31 ruling that an MDFC is a
  // land (62) -- the phone judge hit the unexplained change on all three runs: *"the denominator
  // changed from 66 to 62 with nothing in between saying why."* `landCount`/`typeSlices` now apply
  // the same ruling, so the glance line says 62 too and the clause was explaining a gap that no
  // longer exists. The `mdfc` prop went with it: `DeckWaffle` states the composition once, on the
  // line that prints the land count, and a second copy here would be the third wording of one fact.
  const share = cohesion.nonlandCount > 0
    ? `${cohesion.onThemeCount} of ${cohesion.nonlandCount} nonlands work with it (${pct}%, ${cohesion.label})`
    : `${pct}% of nonlands (${cohesion.label})`;
  const focus = coverage ? `${share}, over the ${coverage.derived} cards read` : share;
  // The WIDER FAMILY, and only when it differs — the same rule the CLI settled on (A10). A specific
  // primary measures itself, so "daleks entering · 0.08" is true and reads as a broken deck until
  // you are also told the family it sits inside is 0.46.
  const family =
    cohesion.familyScore !== undefined && cohesion.familyScore.toFixed(2) !== cohesion.score.toFixed(2)
      ? cohesion.familyScore.toFixed(2)
      : null;
  const top = (strategies ?? []).slice(0, 3);
  return (
    <div className="border border-(--separator) rounded-(--radius) p-5 bg-(--surface) flex flex-col gap-2">
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="eyebrow shrink-0">Deck identity</span>
        {/* NAMING A DECK IS A CLAIM, AND IT CAN BE DECLINED (roadmap A15). Under the floor the
            headline is carried by one or two cards, so the title says so and the tag drops to the
            subtitle -- the same shape the CLI prints. The engine's own invariant is that a silent
            wrong answer is worse than a missing one, and this heading was the loudest place it did
            not hold. */}
        {cohesion.dominant === false ? (
          <h2 className="text-2xl font-bold leading-none text-(--muted)">
            {/* "No dominant theme" is a verdict about the DECK; on a partly-read deck the true
              *  statement is about the ENGINE, and printing the first over the second is what made
              *  a Party-themed precon read as themeless. */}
            {coverage ? "No theme found in the cards read" : "No dominant theme"}
          </h2>
        ) : (
          // THE THEME HEADLINE MOVED TO `RecognitionPanel`, at the top of the Overview, so the
          // page names the deck ONCE and not twice -- this file printing `cohesion.theme` here
          // AND RecognitionPanel printing the same string above it is exactly the duplication
          // this whole redesign exists to remove, and it is what "Found multiple elements with
          // the text: Tokens" was catching. This panel keeps the half recognition deliberately
          // does not carry: the focus score, the coverage qualifier and the wider-family share
          // printed just below.
          null
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
          //
          // PIPS, NOT A GRADIENT (roadmap T5). Owner: "where does it stand section still uses
          // gradient and not mana pips". A two-tone swatch is this tool's own invention for a thing
          // Magic has printed on every card since 1993, and a three-colour identity blurred into a
          // smear that named none of them. `ManaSymbols` is the renderer the Cards table and the
          // colour rows already use, so a pip means one thing everywhere.
          <span className="flex items-center gap-1.5 ml-auto">
            <ManaSymbols cost={colorIdentity.map((c) => `{${c}}`).join("")} />
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
        <p className="text-sm text-(--foreground) tabular-nums">
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
        <p className="text-sm text-(--foreground) tabular-nums">
          {/* "28 cards DO IT" (roadmap T7). Owner: *"we have to stop with this 'do it', it does not
            *  make any sense and is confusing"* -- and the reason it stopped making sense is that
            *  its antecedent MOVED: the theme headline went to `RecognitionPanel`, two panels up, so
            *  "it" pointed at nothing on this line. The count is also the same fact as the share
            *  directly above (29 of 62 at 47%), printed a second time with a different denominator,
            *  because this one drops the commander into its own clause. So the share carries the
            *  count and this line carries only what the share cannot say: how likely you are to
            *  have drawn enough of them in time. */}
          {percent(thing.probability)} to have {thing.k} of them by turn {thing.turn}
          {thing.fromCommandZone.length > 0 ? `, plus ${thing.fromCommandZone.join(", ")} every game` : ""}
          {/* THE COMMANDER-TAX SENTENCE IS GONE FROM HERE (roadmap T6). It read *"free the first
            *  time only — each recast from the command zone costs {2} more (CR 903.8), and nothing
            *  here models how often it dies"*, and the owner's note on it was simply that Magic
            *  players know that. It was written for a reader who might take "every game" as free
            *  and repeatable; a commander player is not that reader. `commanderTax` stays on the
            *  report and the CLI still prints it -- this is a decision about THIS line, not about
            *  the data. */}
          <span className="block text-xs text-(--muted)">
            owner-judged 95% precise on what it lists; it misses roughly one in six a player would count
          </span>
        </p>
      ) : null}
      {/* WHEN IS THE COMMANDER ONLINE (roadmap K5). A RANGE, never one number, and the range is the
        *  PLAY POLICY: the low end holds up two mana before casting an accelerant, the high end
        *  spends everything on acceleration. MANA AND COLOURS TOGETHER (L4a) -- the old pair of
        *  hypergeometric axes could not be combined and so no figure here meant "you can cast it".
        *  A refused cost prints an em dash and never 0%, because a reader treats 0% as
        *  "cannot happen". */}
      {commanderCast && commanderCast.length > 0 ? (
        /* A `<div>`, NOT A `<p>` (roadmap U2). This line holds an `Explain`, which is a
         * `<details>` -- flow content, and a paragraph may hold phrasing content only, so the
         * browser CLOSED the paragraph early and reparented the disclosure as its sibling. Six
         * React errors on every report load, and the DOM the tests queried was not the DOM that
         * shipped. The classes are the paragraph's, unchanged: nothing here needed `<p>` semantics
         * -- it is a labelled readout, and it already contained a `block` span. */
        <div className="text-sm text-(--muted) tabular-nums">
          {/* SUBJECT FIRST. The first cut read "21-72% by turn 6 to cast your commander", which makes
              a reader hold a number before knowing what it is about -- seen on the live page, not in
              any test. */}
          <span>Commander castable: </span>
          {commanderCast.map((c) => {
            const odds = c.castable === null
              ? `— (${c.refused ?? "cost not modelled"})`
              : `${policyBand(c.castable.low, c.castable.high)} by turn ${c.turn}`;
            return `${commanderCast.length > 1 ? `${c.name}: ` : ""}${odds}`;
          }).join(" · ")}
          {/* THE CAVEAT LEAVES THE BODY BUT NOT THE PAGE (roadmap T8). Owner: it *"belongs in a
              tooltip"* -- and a `title` is exactly what this line WAS, refused here on the record
              because a tooltip is not a caveat on a touch device or for anyone who never hovers.
              `Explain` is the report's standing answer to that: a `<details>`, one click, works the
              same on a phone. The words survive verbatim; only their cost in vertical space goes.
              WHAT IT SAYS IS THE PLAY POLICY, because that is what the interval now IS. It used to
              read "lands and mana rocks only -- land-fetch ramp like Cultivate is not counted, so
              this reads low", which L4a deleted from the CLI when the figure became a SIMULATION that
              models land-fetch ramp -- and this copy of the sentence went on being read for a week.
              FOUND IN A LIVE BROWSER, and it is the N6 shape one panel over: two copies of a
              sentence, one of them updated. */}
          {commanderCast.some((c) => c.mana !== null) ? (
            <Explain label="what the range means">
              simulated: the low end holds up two mana, the high end spends everything on ramp
            </Explain>
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
        </div>
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
              {/* "signals Tokens 42%" (T1). The verb is the engine's, and the bare percentage reads
                *  as confidence -- "42% sure it is tokens" -- rather than as a share of the deck,
                *  which is what it is. `ArchetypeBoard`'s disclosure carries the denominator. */}
              themes {top.map((s) => `${s.label} ${Math.round(s.confidence * 100)}%`).join(" · ")}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
