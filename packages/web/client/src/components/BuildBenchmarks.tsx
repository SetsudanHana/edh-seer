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
  return (
    <div className="flex flex-col gap-3 mt-2 pt-3 border-t border-(--separator)">
      <div className="flex flex-col gap-1.5">
        <h4 className="eyebrow">Answers by turn {turn}</h4>
        <ul className="flex flex-col gap-1">
          {answers.map((a) => {
            // Zero is flagged; nothing else is. A "low" threshold would be invented -- the
            // doctrine says carry each class, and it does not say how many.
            const none = a.count === 0;
            const label = none
              ? `${a.class}, no answers`
              : a.fromCommandZone
                ? `${a.class}, ${a.count} card${a.count === 1 ? "" : "s"}, always (commander)`
                : `${a.class}, ${a.count} card${a.count === 1 ? "" : "s"}, ${pct(a.available)} by turn ${turn}`;
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
                <span className={`w-8 shrink-0 text-right tabular-nums ${none ? "text-(--warning)" : "text-(--muted)"}`}>{a.count}</span>
                <span className={`w-16 shrink-0 text-right tabular-nums ${none ? "text-(--warning)" : ""}`}>
                  {a.fromCommandZone ? "always" : pct(a.available)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

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
      <p className="text-xs text-(--muted)">
        {seen} cards seen by turn {turn}. Supply is unweighted — a repeatable outlet counts the same
        as a one-shot. No mulligans and no opponent, and card draw is ignored, so each figure is
        conservative for a deck that draws.
      </p>
    </div>
  );
}
