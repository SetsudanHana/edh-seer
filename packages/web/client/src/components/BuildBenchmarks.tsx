import type { DeckReport } from "../types.js";

const LABEL: Record<string, string> = {
  ramp: "Ramp", draw: "Draw", cardSelection: "Card selection", targetedRemoval: "Removal",
  stackInteraction: "Stack interaction", boardWipe: "Board wipes", burn: "Burn & drain", stax: "Stax",
  protection: "Protection", tutor: "Tutors", lands: "Lands",
};
const LAND_BAND = 3; // lands are two-sided: satisfied within ±3 of target.

/** A probability as whole percent. Deliberately coarse: these figures carry a stack of stated
 *  biases (no mulligans, no opponent, draw ignored), and a decimal point would dress that up as
 *  precision it does not have. */
const pct = (p: number): string => `${Math.round(p * 100)}%`;

export function BuildBenchmarks({
  categories, deckMath,
}: {
  categories: DeckReport["buildCategories"];
  deckMath?: DeckReport["deckMath"];
}) {
  if (!categories || categories.length === 0) return null;
  const rows = categories.filter((c) => c.target > 0); // zero-target = neutral, omitted (mirrors engine)
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="eyebrow">Build benchmarks</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((c) => {
          const name = LABEL[c.category] ?? c.category;
          const under = c.category === "lands" ? c.count < c.target - LAND_BAND : c.count < c.target;
          const over = c.category === "lands" && c.count > c.target + LAND_BAND;
          const flagged = under || over;
          const state = under ? "under target" : over ? "over target" : "on target";
          const fill = Math.max(0, Math.min(1, c.count / c.target));
          return (
            <li key={c.category} className="flex items-center gap-3" aria-label={`${name} ${c.count} of ${c.target}, ${state}`}>
              <span className="w-24 shrink-0 text-sm">{name}</span>
              <span className="flex-1 h-2 rounded-full bg-(--separator) overflow-hidden">
                <span
                  className={`block h-full rounded-full ${flagged ? "bg-(--warning)" : "bg-(--success)"}`}
                  style={{ width: `${fill * 100}%` }}
                />
              </span>
              <span className="w-14 shrink-0 text-right text-sm tabular-nums">{c.count}/{c.target}</span>
              <span className={`w-4 shrink-0 text-sm ${flagged ? "text-(--warning)" : "text-(--success)"}`} aria-hidden>{flagged ? "▲" : "✓"}</span>
            </li>
          );
        })}
      </ul>

      {deckMath ? <DeckMathRows deckMath={deckMath} /> : null}
    </div>
  );
}

/** The deck-math readouts, folded in under the category bars (project owner's call) rather than
 *  given their own tab: they answer the same question the benchmarks do -- "is this deck built" --
 *  and the counts above are what they reprice.
 *
 *  A benchmark says "6 ramp, want 10". These say what that means in a game you actually play. */
function DeckMathRows({ deckMath }: { deckMath: NonNullable<DeckReport["deckMath"]> }) {
  const { turn, seen, answers, demand } = deckMath;
  const colors = deckMath.colors ?? [];
  const lands = deckMath.lands;
  const wincons = deckMath.wincons;
  const clock = deckMath.clock;
  const castability = deckMath.castability;
  return (
    <div className="flex flex-col gap-3 mt-2 pt-3 border-t border-(--separator)">
      <div className="flex flex-col gap-1.5">
        <h4 className="eyebrow">Answers by turn {turn}</h4>
        <ul className="flex flex-col gap-1">
          {answers.map((a) => {
            const none = a.count === 0;
            // How many short of the doctrine's confidence, DERIVED rather than a template: the
            // count moves with the deck's own clock, so a fast deck is asked for more than a slow
            // one. (This row used to flag only zero, on the reasoning that any other threshold
            // would be invented. It no longer is -- that is what step C bought.)
            const short = Math.max(0, a.required - a.count);
            const shortfall = short > 0 ? `, ${short} short of ${a.required}` : "";
            // The mode sub-counts (design §7). A zero is the finding on a row that HAS answers --
            // 4 creature answers of which none exiles means a reanimator undoes all four -- so a
            // zero is rendered in warning colour rather than omitted. On a row with no answers at
            // all the count already says everything, and a mode suffix would be noise.
            const mode = none
              ? ""
              : a.class === "graveyard"
                ? a.recurring > 0 ? `${a.recurring} rec` : "0 rec"
                : a.exiling > 0 ? `${a.exiling} ex` : "0 ex";
            const modeLabel = none
              ? ""
              : a.class === "graveyard"
                ? a.recurring > 0 ? `, ${a.recurring} recurring` : ", none recurring"
                : a.exiling > 0 ? `, ${a.exiling} of them exile` : ", none of them exile";
            const label = none
              ? `${a.class}, no answers${shortfall}`
              : a.fromCommandZone
                ? `${a.class}, ${a.count} card${a.count === 1 ? "" : "s"}${modeLabel}, always (commander)`
                : `${a.class}, ${a.count} card${a.count === 1 ? "" : "s"}${modeLabel}, ${pct(a.available)} by turn ${turn}${shortfall}`;
            return (
              <li key={a.class} className="flex items-center gap-3 text-sm" aria-label={label}>
                <span className="w-24 shrink-0 capitalize">{a.class}</span>
                <span className="flex-1 h-1.5 rounded-full bg-(--separator) overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${none ? "bg-(--warning)" : "bg-(--success)"}`}
                    style={{ width: `${a.available * 100}%` }}
                  />
                </span>
                {/* A zero row's BAR is zero-width, so colouring the bar cannot flag it -- the one
                  *  row that most needs to be visible would be the one row with nothing painted.
                  *  The numbers carry the warning instead. */}
                <span className="w-16 shrink-0 text-right tabular-nums flex items-baseline justify-end gap-1.5">
                  <span className={none ? "text-(--warning)" : "text-(--muted)"}>{a.count}</span>
                  <span className={`text-xs ${mode.startsWith("0") ? "text-(--warning)" : "text-(--muted)"}`}>{mode}</span>
                </span>
                {/* The shortfall, where there is one. A percentage says how likely; only this says
                  *  what to do about it, which is the difference between a readout and advice. */}
                <span className="w-12 shrink-0 text-right tabular-nums text-xs text-(--muted)">
                  {short > 0 ? `−${short}` : ""}
                </span>
                <span className={`w-16 shrink-0 text-right tabular-nums ${none ? "text-(--warning)" : ""}`}>
                  {a.fromCommandZone ? "always" : pct(a.available)}
                </span>
              </li>
            );
          })}
        </ul>
        {/* The shortfall column is meaningless without the confidence it is measured against, and
          *  that confidence is a stated doctrine rather than a fact about the deck. Say it out loud
          *  next to the numbers it produces, the way the pricing turn is. */}
        {answers.some((a) => a.required > a.count) ? (
          <p className="text-xs text-(--muted)">
            −n is how many more it takes for an answer to be in hand more often than not by turn {turn}.
          </p>
        ) : null}
      </div>

      {castability && castability.cards.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Hardest casts</h4>
          <ul className="flex flex-col gap-1">
            {castability.cards.map((c) => {
              const colourPart = c.colors
                .map((x) => `${pct(x.p)} for ${x.pips} ${x.color}`)
                .join(", ");
              return (
                <li
                  key={c.name}
                  className="flex items-center gap-3 text-sm"
                  aria-label={
                    `${c.name}, ${pct(c.mana)} to have ${c.turn} mana by turn ${c.turn}`
                    + (colourPart ? `, ${colourPart}` : "")
                  }
                >
                  <span className="flex-1 truncate">{c.name}</span>
                  {/* Two columns, never one. Multiplying them would read cleaner and be wrong:
                    *  both are driven by the same lands, so the correlation is positive -- and it
                    *  would hide whether the deck's problem is mana or colour. */}
                  <span className="w-20 shrink-0 text-right tabular-nums">{pct(c.mana)} mana</span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-(--muted)">
                    {colourPart || "—"}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-(--muted)">
            {castability.refused > 0 ? `${castability.refused} cards refused — X costs, delve, convoke and free casts are not priced rather than guessed. ` : ""}
            {castability.biases}
          </p>
        </div>
      ) : null}

      {clock ? (
        <div className="flex flex-col gap-1">
          <h4 className="eyebrow">Clock</h4>
          <div
            className="flex items-center gap-3 text-sm"
            aria-label={
              clock.turn === undefined
                ? `no combat clock, ${clock.powerAtFive} expected power at turn 5`
                : `clock turn ${clock.turn}, ${clock.powerAtFive} expected power at turn 5`
            }
          >
            <span className="w-24 shrink-0">
              {clock.turn === undefined ? "no clock" : `Turn ${clock.turn}`}
            </span>
            <span className="flex-1 text-xs text-(--muted)">
              {clock.turn === undefined
                ? "nothing here kills through combat — a mill or alt-win deck has no combat clock"
                : `${clock.powerAtFive} expected power on board at turn 5`}
            </span>
          </div>
          {/* A turn number that does not say how it was made reads as a prediction. It is a RATE:
            *  useful for comparing two decks, useless as a date. */}
          <p className="text-xs text-(--muted)">
            Expected attacking power against one opponent's 40 life. Nobody blocks in this model and
            nothing is removed, so it is optimistic — read it to compare decks, not to plan a game.
          </p>
        </div>
      ) : null}

      {wincons && wincons.classes.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Win plans</h4>
          <ul className="flex flex-col gap-1">
            {wincons.classes.map((w) => (
              <li
                key={w.class}
                className="flex items-center gap-3 text-sm"
                aria-label={`${w.class}, ${w.count} cards, ${Math.round(w.share * 100)}% of the deck's win plan`}
              >
                <span className="w-24 shrink-0">{w.class}</span>
                <span className="flex-1 h-1.5 rounded-full bg-(--separator) overflow-hidden">
                  <span className="block h-full rounded-full bg-(--accent)" style={{ width: `${w.share * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums text-(--muted)">{w.count}</span>
                <span className="w-16 shrink-0 text-right tabular-nums">{Math.round(w.share * 100)}%</span>
              </li>
            ))}
          </ul>
          {/* Says which direction is good, because this is the ONE number here scored the opposite
            *  way to everything above it. Answers want breadth; a win plan wants concentration, and
            *  a reader who assumes "more is better" reads a scattered deck as a versatile one. */}
          <p className="text-xs text-(--muted)">
            Focus {wincons.focus.toFixed(2)} — concentration, not coverage: one plan pursued hard
            beats three half-plans, so higher is better here.
          </p>
        </div>
      ) : null}

      {lands ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Lands, from this deck's curve</h4>
          {/* The benchmark above scores against a flat 36 for every deck. This one is derived from
            *  the deck's own average mana value and acceleration, so when the two disagree it is
            *  the fixed target that is guessing. The inputs are shown because "34" with no working
            *  is a number to argue with rather than act on. */}
          <div
            className="flex items-center gap-3 text-sm"
            aria-label={`${lands.actual} lands, Karsten wants ${lands.target}`}
          >
            <span className="w-24 shrink-0">Karsten</span>
            <span className="flex-1 text-xs text-(--muted)">
              avg MV {lands.avgManaValue} · {lands.rampPlusDraw} cheap ramp/draw · {lands.fastMana} fast mana
            </span>
            <span className="shrink-0 tabular-nums text-(--muted)">{lands.actual} run</span>
            <span
              className={`w-16 shrink-0 text-right tabular-nums ${
                Math.abs(lands.actual - lands.target) > 2 ? "text-(--warning)" : "text-(--success)"
              }`}
            >
              wants {lands.target}
            </span>
          </div>
        </div>
      ) : null}

      {colors.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h4 className="eyebrow">Colours</h4>
          <ul className="flex flex-col gap-1">
            {colors.map((c) => {
              // The deadline is the CARD's own mana value, not a chosen turn: a 3-drop wants its
              // pips on turn 3. That is why this row can name a turn without guessing one.
              const label = c.worst
                ? `${c.color}, ${c.supplied} sources, ${c.worst.cards} card${c.worst.cards === 1 ? "" : "s"} want ${c.worst.pips} pip${c.worst.pips === 1 ? "" : "s"} by turn ${c.worst.turn}, which needs ${c.worst.required}`
                : `${c.color}, ${c.supplied} sources, enough for every card that costs it`;
              return (
                <li key={c.color} className="flex items-center gap-3 text-sm" aria-label={label}>
                  <span className="w-24 shrink-0 font-mono">{c.color}</span>
                  <span className="flex-1 text-(--muted) text-xs">
                    {c.worst
                      ? `${c.worst.cards} card${c.worst.cards === 1 ? "" : "s"} want ${"{" + c.color + "}"}${c.worst.pips > 1 ? "{" + c.color + "}".repeat(c.worst.pips - 1) : ""} by T${c.worst.turn}`
                      : "every cost covered"}
                  </span>
                  <span className="shrink-0 tabular-nums text-(--muted)">
                    {c.supplied}{c.worst ? ` / ${c.worst.required}` : ""}
                  </span>
                  <span className={`w-16 shrink-0 text-right tabular-nums ${c.worst ? "text-(--warning)" : "text-(--success)"}`}>
                    {c.worst ? `short ${c.worst.required - c.supplied}` : "ok"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <h4 className="eyebrow">Wants vs supplies</h4>
        <ul className="flex flex-col gap-1">
          {demand.map((d) => {
            const label =
              d.available === null
                ? `${d.key}, ${d.consumers} cards want it, the game supplies it`
                : `${d.key}, ${d.consumers} cards want it, ${d.suppliers} supply it, ${pct(d.available)} by turn ${turn}`;
            return (
              <li key={d.key} className="flex items-center gap-3 text-sm" aria-label={label}>
                <span className="flex-1 truncate font-mono text-xs">{d.key}</span>
                <span className="shrink-0 tabular-nums text-(--muted)">
                  {d.consumers} want · {d.suppliers} supply
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums">
                  {/* The game supplies a combat trigger, so there is no card to draw. 0% would
                    *  invent a hole and 100% would claim a board state nothing here models. */}
                  {d.available === null ? "—" : pct(d.available)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Not a footnote to look up later. Without these a reader takes 41% as a fact about their
        *  deck rather than about a hypergeometric draw with three stated biases in it. */}
      {/* The horizon is per-deck now, so a reader comparing two reports has to be told it moved.
        *  "By turn 5" used to mean the same thing everywhere and no longer does. */}
      <p className="text-xs text-(--muted)">
        Priced at turn {turn} —{" "}
        {deckMath.turnSource === "corpus-median"
          ? "the median of the calibration decks, because this deck has no combat clock"
          : deckMath.turnSource === "override"
            ? "a fixed horizon"
            : "this deck's own clock"}
        , {seen} cards seen. Supply is unweighted — a repeatable outlet counts the same as a
        one-shot. No mulligans and no opponent, and card draw is ignored, so each figure is
        conservative for a deck that draws.
      </p>
    </div>
  );
}
