import { Fragment, type ReactNode } from "react";
import type { DeckReport } from "../types.js";

const LABEL: Record<string, string> = {
  ramp: "Ramp", draw: "Draw", cardSelection: "Card selection", targetedRemoval: "Removal",
  stackInteraction: "Stack interaction", boardWipe: "Board wipes", burn: "Burn & drain", stax: "Stax",
  protection: "Protection", tutor: "Tutors",
};

/** Scored here and NOT listed as a benchmark row: the land count is reported once, by the block
 *  below, which derives its target from this deck's own curve instead of the flat 36 every deck was
 *  measured against. Two rows for one quantity, disagreeing on the target, is the panel's most
 *  literal duplicate -- and this component's own comment already said that when they disagree it is
 *  the fixed target that is guessing. `buildScore` still uses the flat target; only the row is gone. */
const REPORTED_ELSEWHERE = new Set(["lands"]);

/** Where the target sits on a benchmark track, as a fraction of its width.
 *
 *  THE BAR USED TO CLAMP AT THE TARGET, so `13/10`, `4/4`, `14/10`, `1/1` and `37/36` all painted
 *  one identical full-width bar -- five of six rows carrying no information, and a land count 4 OVER
 *  its target drawing exactly like a ramp count 1 UNDER it. Parking the target at 70% leaves the
 *  remaining 30% for overshoot, so a row that clears its target visibly runs past the mark and a row
 *  that misses stops short of it. */
const TARGET_MARK = 0.7;

/** A probability as whole percent. Deliberately coarse: these figures carry a stack of stated
 *  biases (no mulligans, no opponent, draw ignored), and a decimal point would dress that up as
 *  precision it does not have. */
const pct = (p: number): string => `${Math.round(p * 100)}%`;

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The event half of a census key (`enters`, `dies`, `cast`, `end-step`…) as the words a player
 *  would use. A verb absent here is NOT guessed at — `demandSentence` falls back to printing the
 *  raw key, which is ugly and true, rather than inventing a phrase for a verb the engine grew
 *  after this map was written. */
const DEMAND_VERB: Record<string, string> = {
  enters: "entering the battlefield",
  "enters-graveyard": "going to a graveyard",
  dies: "dying",
  cast: "being cast",
  attacks: "attacking",
  blocks: "blocking",
  sacrificed: "being sacrificed",
  discarded: "being discarded",
  exiled: "being exiled",
};

/** Phase keys carry no subject — "an end step" is the whole demand, and gluing a subject onto it
 *  ("anything an end step") is nonsense. */
const DEMAND_PHASE: Record<string, string> = {
  "end-step": "an end step",
  upkeep: "an upkeep",
  "draw-step": "a draw step",
  "combat-damage": "combat damage",
};

const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Turn a census key into the sentence its own aria-label already implies — `enters:type:creature`
 *  is "a creature entering the battlefield", not a colon-separated identifier.
 *
 *  THE RAW KEY IS ENGINE VOCABULARY, and four separate player reviews read it as evidence the page
 *  was a template rather than a reading of their deck. It survives on the row's `title` for anyone
 *  who wants to match a report against `bin/deck-availability.ts`, which prints keys. */
export function demandSentence(key: string): string {
  const narrowed = key.endsWith(" (narrowed)");
  const bare = narrowed ? key.slice(0, -" (narrowed)".length) : key;
  const [verb, ...rest] = bare.split(":");
  const subjectKey = rest.join(":");

  const phase = DEMAND_PHASE[verb];
  if (phase && subjectKey === "any") return phase;

  const event = DEMAND_VERB[verb];
  if (!event) return key; // unknown verb: say the true ugly thing rather than a plausible wrong one

  /** "artifact", "battle", "creature" -> "an artifact, battle or creature". */
  const oneOf = (members: string[]): string => {
    const rest = [...members];
    const last = rest.pop()!;
    const noun = rest.length > 0 ? `${rest.join(", ")} or ${last}` : last;
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
  };

  let subject: string;
  if (subjectKey === "any") {
    subject = "anything";
  } else if (subjectKey.startsWith("subtype:")) {
    // Subtypes are proper nouns in Magic — a Wizard, not a wizard.
    subject = oneOf(subjectKey.slice("subtype:".length).split("+").map(capitalize));
  } else if (subjectKey.startsWith("type:")) {
    subject = oneOf(subjectKey.slice("type:".length).split("+"));
  } else {
    return key;
  }

  return `${subject} ${event}${narrowed ? " (a real one, not the game's own)" : ""}`;
}

export function BuildBenchmarks({
  categories, deckMath,
}: {
  categories: DeckReport["buildCategories"];
  deckMath?: DeckReport["deckMath"];
}) {
  if (!categories || categories.length === 0) return null;
  // zero-target = neutral, omitted (mirrors engine)
  const rows = categories.filter((c) => c.target > 0 && !REPORTED_ELSEWHERE.has(c.category));
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {/* The parent of eight headings, and until now indistinguishable from the seven beneath it --
        *  the rank was correct in the DOM (one h3, seven h4s) and invisible in pixels, so a screen
        *  reader got a structure a sighted reader could not see. Foreground weight is the whole
        *  difference; the children keep the muted eyebrow they already had. */}
      <h3 className="eyebrow text-(--foreground)">Build benchmarks</h3>
      <ul className="flex flex-col gap-1.5">
        {rows.map((c) => {
          const name = LABEL[c.category] ?? c.category;
          // Every remaining category is a FLOOR -- lands were the one two-sided band, and they are
          // reported by their own block now, so over-target needs no case here.
          const flagged = c.count < c.target;
          const state = flagged ? "under target" : "on target";
          const fill = Math.max(0, Math.min(1, (c.count / c.target) * TARGET_MARK));
          return (
            <li key={c.category} className="flex items-center gap-3" aria-label={`${name} ${c.count} of ${c.target}, ${state}`}>
              <span className="w-24 shrink-0 text-sm">{name}</span>
              <span className="relative flex-1 h-2 rounded-full bg-(--separator) overflow-hidden">
                <span
                  className={`absolute inset-y-0 left-0 rounded-full ${flagged ? "bg-(--warning)" : "bg-(--success)"}`}
                  style={{ width: `${+(fill * 100).toFixed(2)}%` }}
                />
                {/* The target itself, so a row is read against a landmark rather than against the
                  *  end of its own track. Every row's mark sits at the same x, which is what makes
                  *  rows with different targets comparable at a glance. */}
                <span
                  className="absolute inset-y-0 w-px bg-(--foreground) opacity-70"
                  style={{ left: `${TARGET_MARK * 100}%` }}
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
  const { turn, seen, demand } = deckMath;
  // WORST FIRST, in both ranked blocks. The doctrine's order (creature, artifact, enchantment,
  // planeswalker, land, graveyard) is a fixed list, so the rows a reader can act on landed wherever
  // that list happened to put them -- on this deck, at the bottom -- and the bars zigzagged, which
  // is the one thing a shared axis is for. Sorting by shortfall makes the column monotonic and puts
  // the deck's real holes under the heading.
  const answers = [...deckMath.answers].sort(
    (a, b) => (b.required - b.count) - (a.required - a.count) || a.available - b.available,
  );
  const colors = [...(deckMath.colors ?? [])].sort(
    (a, b) => ((b.worst?.required ?? 0) - b.supplied) - ((a.worst?.required ?? 0) - a.supplied),
  );
  const lands = deckMath.lands;
  const wincons = deckMath.wincons;
  const clock = deckMath.clock;
  const castability = deckMath.castability;
  const answersBlock = (
      <div className="flex flex-col gap-1.5">
        <h5 className="eyebrow">Answers by turn {turn}</h5>
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
            //
            // SPELLED OUT, not abbreviated. `0 ex` and `0 rec` were the two most-misread strings on
            // this panel -- four player reviews, four failures to decode, including the reader who
            // correctly guessed "exile" and still called it broken because every row read `0 ex`.
            // It is also the row's only independent fact: see below.
            const mode = none
              ? ""
              : a.class === "graveyard"
                ? a.recurring > 0 ? `${a.recurring} recurring` : "none recurring"
                : a.exiling > 0 ? `${a.exiling} exile` : "none exile";
            const modeLabel = none
              ? ""
              : a.class === "graveyard"
                ? a.recurring > 0 ? `, ${a.recurring} recurring` : ", none recurring"
                : a.exiling > 0 ? `, ${a.exiling} of them exile` : ", none of them exile";
            const label = none
              ? `${a.class}, no answers${shortfall}`
              : a.fromCommandZone
                ? `${a.class}, ${a.count} card${a.count === 1 ? "" : "s"}${modeLabel}, always (commander)`
                : `${a.class}, ${a.count} card${a.count === 1 ? "" : "s"}${modeLabel}${shortfall}`;
            return (
              // THE ROW HAD ONE NUMBER IN FOUR DRESSES. The bar painted `available`; the percentage
              // at the end printed the same `available` in digits; `available` is itself a pure
              // function of `count` at a fixed library and turn; and the shortfall is `required -
              // count` against a fixed threshold. Only the count and the mode were independent
              // facts, and only the shortfall said what to do -- so those three stay and the two
              // restatements of likelihood are gone. Ranking the rows worst-first (above) is what
              // the bar was really buying, and that survives.
              <li key={a.class} className="flex items-center gap-3 text-sm" aria-label={label}>
                {/* `planeswalker` and `enchantment` both overrun 80px and clipped mid-word with no
                  *  ellipsis, at every viewport -- the longest class name has to fit, because a
                  *  truncated row label is a row the reader cannot identify. */}
                <span className="w-24 shrink-0 capitalize">{a.class}</span>
                <span className="flex-1 text-right tabular-nums flex items-baseline justify-end gap-1.5">
                  <span className={none ? "text-(--warning)" : "text-(--muted)"}>
                    {none ? "none" : plural(a.count, "card")}
                  </span>
                  <span className={`text-xs ${mode.startsWith("none") ? "text-(--warning)" : "text-(--muted)"}`}>{mode}</span>
                </span>
                {/* The one prescriptive figure on the panel, and now the only number in its row
                  *  besides the count it is measured from. Narrower at 390px, where the label needs
                  *  96px for "planeswalker" and the count group was wrapping onto two lines. */}
                <span className="w-16 sm:w-24 shrink-0 text-right tabular-nums text-(--warning)">
                  {a.fromCommandZone ? "" : short > 0 ? `${short} short` : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {/* The shortfall column is meaningless without the confidence it is measured against, and
          *  that confidence is a stated doctrine rather than a fact about the deck. Say it out loud
          *  next to the numbers it produces, the way the pricing turn is. */}
        {answers.some((a) => a.required > a.count) ? (
          <p className="text-xs text-(--muted) max-w-[65ch]">
            "Short" counts the cards this deck would have to add before it holds an answer of that
            class more often than not by turn {turn}.
          </p>
        ) : null}
      </div>
  );

  const castsBlock = castability && castability.cards.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h5 className="eyebrow">Hardest casts</h5>
          {/* GROUPED BY COST, because the mana figure is a property of the cost and not of the card:
            *  four cards that all cost 5 print the same percentage four times, which three of four
            *  player reviews read as a broken readout. Said once per group, it becomes what it
            *  actually is -- a statement about five-drops in this deck -- and the per-card line is
            *  left carrying only what differs, its colours. */}
          <ul className="flex flex-col gap-2">
            {/* Keyed on the figure itself, not just the turn: two cards only share a heading when
              *  they genuinely share a probability, so a fractional mana value can never be folded
              *  into a group whose number it does not actually carry. */}
            {[...new Set(castability.cards.map((c) => `${c.turn}:${c.mana}`))].map((groupKey) => {
              const group = castability.cards.filter((c) => `${c.turn}:${c.mana}` === groupKey);
              const { turn: costTurn, mana } = group[0]!;
              return (
                <li key={groupKey} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-3 text-sm">
                    <span className="flex-1">
                      {costTurn}-drop{group.length === 1 ? "" : "s"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {pct(mana)} to have {costTurn} mana by turn {costTurn}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1 border-l border-(--separator) pl-3">
                    {group.map((c) => {
                      const colourPart = c.colors
                        .map((x) => `${pct(x.p)} for ${x.pips} ${x.color}`)
                        .join(", ");
                      return (
                        <li
                          key={c.name}
                          // STACKED AT NARROW. Side by side, the fixed colour figures kept their
                          // full width while the card name truncated -- "Inalla, Archmage Ritualist"
                          // wants 163px and had 110 -- so the row lost the one thing identifying
                          // which card it is about. On its own line the name always fits.
                          className="flex flex-col sm:flex-row sm:items-baseline gap-x-3 text-sm"
                          aria-label={
                            `${c.name}, ${pct(c.mana)} to have ${c.turn} mana by turn ${c.turn}`
                            + (colourPart ? `, ${colourPart}` : "")
                          }
                        >
                          {/* Two axes, never multiplied into one. Both are driven by the same lands,
                            *  so the correlation is positive -- and the product would hide whether
                            *  the deck's problem is mana or colour. */}
                          <span className="flex-1 sm:truncate text-(--muted)">{c.name}</span>
                          <span className="shrink-0 sm:text-right tabular-nums text-(--muted) text-xs">
                            {colourPart || "no coloured pips"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-(--muted) max-w-[65ch]">
            {castability.refused > 0
              ? `${plural(castability.refused, "card")} refused — X costs, delve, convoke and free casts are not priced rather than guessed. `
              : ""}
            {castability.biases}
          </p>
        </div>
  ) : null;

  const clockBlock = clock ? (
        <div className="flex flex-col gap-1">
          <h5 className="eyebrow">Clock</h5>
          <div
            className="flex items-center gap-3 text-sm"
            aria-label={
              clock.turn === undefined
                ? `no combat clock, ${clock.powerAtFive} expected power at turn 5`
                : `clock turn ${clock.turn}, ${clock.powerAtFive} expected power at turn 5`
            }
          >
            {/* Two turn numbers in one row read as a contradiction unless each says what it is
              *  about — the headline is when this deck kills, the aside is a snapshot on the way
              *  there, and readers took the pair for a mistake. */}
            <span className="w-32 shrink-0">
              {clock.turn === undefined ? "no clock" : `Kills on turn ${clock.turn}`}
            </span>
            <span className="flex-1 text-xs text-(--muted)">
              {clock.turn === undefined
                ? "nothing here kills through combat — a mill or alt-win deck has no combat clock"
                : `${clock.powerAtFive} expected power on board by turn 5, on the way there`}
            </span>
          </div>
          {/* A turn number that does not say how it was made reads as a prediction. It is a RATE:
            *  useful for comparing two decks, useless as a date. */}
          <p className="text-xs text-(--muted) max-w-[65ch]">
            Expected attacking power against one opponent's 40 life. Nobody blocks in this model and
            nothing is removed, so it is optimistic — read it to compare decks, not to plan a game.
          </p>
        </div>
  ) : null;

  const winBlock = wincons && wincons.classes.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h5 className="eyebrow">Win plans</h5>
          <ul className="flex flex-col gap-1">
            {wincons.classes.map((w) => (
              <li
                key={w.class}
                className="flex items-center gap-3 text-sm"
                aria-label={`${w.class}, ${w.count} cards, ${Math.round(w.share * 100)}% of the deck's win plan`}
              >
                <span className="w-24 shrink-0">{w.class}</span>
                {/* The bar IS the share, so the share is not printed again beside it. The count is
                  *  the one thing the bar cannot say -- 46% of a three-card plan and 46% of a
                  *  thirteen-card plan are different decks. */}
                <span className="flex-1 h-1.5 rounded-full bg-(--separator) overflow-hidden">
                  <span className="block h-full rounded-full bg-(--accent)" style={{ width: `${w.share * 100}%` }} />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-(--muted)">{plural(w.count, "card")}</span>
              </li>
            ))}
          </ul>
          {/* Says which direction is good, because this is the ONE number here scored the opposite
            *  way to everything above it. Answers want breadth; a win plan wants concentration, and
            *  a reader who assumes "more is better" reads a scattered deck as a versatile one. */}
          {/* The scale, because a bare 0.41 has no top and no bottom. It is a Herfindahl over the
            *  plan shares: 1.00 is one plan, and n even plans is 1/n — so the floor moves with how
            *  many plans the deck has, and stating both ends is the only way to read the number. */}
          <p className="text-xs text-(--muted) max-w-[65ch]">
            Focus {wincons.focus.toFixed(2)} of 1.00 — how concentrated the win plan is, where 1.00
            is a deck all-in on one plan and {(1 / Math.max(1, wincons.classes.length)).toFixed(2)} is
            these {wincons.classes.length} plans split evenly. Concentration, not coverage: higher is
            better here, unlike every other figure on this panel.
          </p>
        </div>
  ) : null;

  const landsBlock = lands ? (
        <div className="flex flex-col gap-1.5">
          <h5 className="eyebrow">Lands</h5>
          {/* THE ONLY LAND VERDICT ON THE PANEL now that the benchmark row is gone. Its target is
            *  derived from this deck's own average mana value and acceleration rather than the flat
            *  36 every deck used to be measured against, and the inputs are shown because "34" with
            *  no working is a number to argue with rather than act on.
            *
            *  The regression behind it is Karsten's, and that name is implementation: the reader is
            *  asking how many lands to run, not whose formula answered. It lives in the code and in
            *  `land-count.ts`, not in the label. */}
          <div
            className="flex items-center gap-3 text-sm"
            aria-label={`${lands.actual} lands in the deck, this curve wants ${lands.target}`}
          >
            <span className="w-32 shrink-0 tabular-nums">{lands.actual} in deck</span>
            <span className="flex-1 text-xs text-(--muted)">
              avg mana value {lands.avgManaValue} · {lands.rampPlusDraw} cheap ramp/draw · {lands.fastMana} fast mana
            </span>
            <span
              className={`w-16 shrink-0 text-right tabular-nums ${
                Math.abs(lands.actual - lands.target) > 2 ? "text-(--warning)" : "text-(--success)"
              }`}
            >
              wants {lands.target}
            </span>
          </div>
        </div>
  ) : null;

  const coloursBlock = colors.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h5 className="eyebrow">Colours</h5>
          <ul className="flex flex-col gap-1">
            {colors.map((c) => {
              // The deadline is the CARD's own mana value, not a chosen turn: a 3-drop wants its
              // pips on turn 3. That is why this row can name a turn without guessing one.
              const label = c.worst
                ? `${c.color}, ${c.supplied} sources, ${c.worst.cards} card${c.worst.cards === 1 ? "" : "s"} want ${c.worst.pips} pip${c.worst.pips === 1 ? "" : "s"} by turn ${c.worst.turn}, which needs ${c.worst.required}`
                : `${c.color}, ${c.supplied} sources, enough for every card that costs it`;
              return (
                <li key={c.color} className="flex items-center gap-3 text-sm" aria-label={label}>
                  {/* One letter in a 96px cell is affordable at 1440 and not at 390, where the
                    *  spelled-out demand and "of N sources" both need the room. */}
                  <span className="w-6 sm:w-24 shrink-0 font-mono">{c.color}</span>
                  {/* The subject of this row is the card that sets the DEADLINE, not the colour in
                    *  general — "1 card wants {U}{U} on turn 2" is what makes the shortfall beside
                    *  it a fact about one early double-pip spell rather than about the mana base. */}
                  <span className="flex-1 text-(--muted) text-xs">
                    {c.worst
                      ? `${plural(c.worst.cards, "card")} ${c.worst.cards === 1 ? "wants" : "want"} ${("{" + c.color + "}").repeat(c.worst.pips)} on turn ${c.worst.turn}`
                      : "every cost covered"}
                  </span>
                  {/* "23 of 36 sources" and "short 13" were the same subtraction printed twice.
                    *  The pair survives as one cell, coloured: the reader can see the gap and its
                    *  size in one place. */}
                  <span
                    className={`w-40 shrink-0 text-right tabular-nums ${c.worst ? "text-(--warning)" : "text-(--success)"}`}
                  >
                    {c.worst ? `${c.supplied} of ${c.worst.required} sources` : `${c.supplied} sources, enough`}
                  </span>
                </li>
              );
            })}
          </ul>
          {/* THE ONE BLOCK THAT HAD NO FOOTNOTE was the one making the harshest claim, sitting
            *  directly under a green land count — and every player review read it as "your mana
            *  base is broken" and then discarded the whole block for contradicting the row above.
            *  It does not contradict it: a land count and a pip deadline are different questions,
            *  and the honest fix for a demand no 100-card deck can meet is usually the spell. */}
          {colors.some((c) => c.worst) ? (
            <p className="text-xs text-(--muted) max-w-[65ch]">
              "Short" is measured against the earliest double-pip card named on each row, at 90%
              confidence — not against the deck's land count, which is judged above. A single early
              double pip can ask for more sources than a three-colour deck can hold, and cutting or
              delaying that card answers it as well as adding lands does.
            </p>
          ) : null}
        </div>
  ) : null;

  const demandBlock = (
      <div className="flex flex-col gap-1.5">
        <h5 className="eyebrow">Wants vs supplies</h5>
        <ul className="flex flex-col gap-1">
          {demand.map((d) => {
            const sentence = demandSentence(d.key);
            const label =
              d.available === null
                ? `${sentence}, ${d.consumers} cards want it, the game supplies it`
                : `${sentence}, ${d.consumers} cards want it, ${d.suppliers} supply it`;
            return (
              <li key={d.key} className="flex items-center gap-3 text-sm" aria-label={label}>
                {/* The raw census key stays reachable on hover, because `bin/deck-availability.ts`
                  *  prints keys and a report you cannot match against the bin is a dead end. */}
                <span className="flex-1 truncate" title={d.key}>{sentence}</span>
                {/* The availability percentage is GONE from this block. It was derived from the two
                  *  counts beside it, and on a real deck it reads 100% on every row with a supplier
                  *  and "—" on every row without one -- a column with no variance, restating a
                  *  comparison the counts already make. "0 supply" is likewise not printed: nothing
                  *  supplies an end step because nothing has to, and every reviewer read the zero as
                  *  a hole in their deck. */}
                <span className="shrink-0 tabular-nums text-(--muted)">
                  {d.available === null
                    ? `${d.consumers} want · the game supplies it`
                    : `${d.consumers} want · ${d.suppliers} supply`}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
  );

  // THE PANEL ANSWERS THREE QUESTIONS, and used to present them as seven interchangeable blocks in
  // the order they happened to be built. A deckbuilder already holds these three; making them the
  // structure means the reader stops deriving the grouping themselves, once per block.
  //
  // `flagged` is a CONDITION, not a score. Cards-short, sources-short and a cast probability are
  // different units, and folding them into one number would be inventing a scale this engine has no
  // basis for -- so a section leads simply because something inside it is already painted as a
  // problem. Flagged sections sort first and `sort` is stable, so everything else holds the fixed
  // order below: the four headings never change, only which of them you meet first.
  const sections: { title: string; flagged: boolean; blocks: ReactNode[] }[] = [
    {
      title: "Can you cast your cards",
      flagged: colors.some((c) => c.worst) || (lands !== undefined && Math.abs(lands.actual - lands.target) > 2),
      blocks: [landsBlock, coloursBlock, castsBlock],
    },
    {
      title: "Can you deal with theirs",
      flagged: answers.some((a) => a.count === 0 || a.required > a.count),
      blocks: [answersBlock],
    },
    { title: "How you win", flagged: false, blocks: [clockBlock, winBlock] },
    // Not a question a player arrives with -- it describes the deck's own internal engine -- so it
    // is named plainly and sits last whatever else is wrong.
    { title: "What your cards are waiting for", flagged: false, blocks: [demandBlock] },
  ];

  return (
    // Rhythm at two levels: blocks inside a section sit closer (gap-5) than the sections do to each
    // other (gap-8), so the three questions read as three regions rather than as one column of
    // seven equal things.
    <div className="flex flex-col gap-8 mt-2 pt-3 border-t border-(--separator)">
      {/* THE HORIZON LEADS, it does not trail. Every probability below is priced at this turn, the
        *  first section heading below depends on it ("Answers by turn 7"), and this sentence used to
        *  sit ~1,400px further down — so the reader met the number, guessed at it, and only later
        *  found out what it meant. The caveats stay with it: they qualify every block, not just the
        *  last one. */}
      <p className="text-xs text-(--muted) max-w-[65ch]">
        Everything below is priced at turn {turn} —{" "}
        {deckMath.turnSource === "corpus-median"
          ? "the median of the calibration decks, because this deck has no combat clock"
          : deckMath.turnSource === "override"
            ? "a fixed horizon"
            : "this deck's own clock"}
        , {seen} cards seen. Supply is unweighted — a repeatable outlet counts the same as a
        one-shot. No mulligans and no opponent, and card draw is ignored, so each figure is
        conservative for a deck that draws.
      </p>

      {[...sections]
        .sort((a, b) => Number(b.flagged) - Number(a.flagged))
        // A section whose every block is absent renders nothing at all: a colourless deck has no
        // Colours block, an alt-win deck may have no win plans, and an empty heading is a promise
        // the panel does not keep.
        .filter((s) => s.blocks.some(Boolean))
        .map((s, i) => (
          // A hairline between sections and none above the first: at 11px uppercase mono, a section
          // heading and a block heading differ only in brightness, which is not enough separation
          // for a region. The rule is how this system already separates things -- borders and tonal
          // steps, never shadow.
          <section
            key={s.title}
            className={`flex flex-col gap-5 ${i > 0 ? "border-t border-(--separator) pt-6" : ""}`}
          >
            <h4 className="eyebrow text-(--foreground)">{s.title}</h4>
            {s.blocks.filter(Boolean).map((block, i) => (
              // Keyed by position within its section: these are fixed, authored blocks, never a
              // list that reorders inside a section.
              <Fragment key={i}>{block}</Fragment>
            ))}
          </section>
        ))}
    </div>
  );
}
