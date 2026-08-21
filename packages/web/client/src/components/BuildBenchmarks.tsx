import { Fragment, type ReactNode } from "react";
import type { DeckReport } from "../types.js";
import { BUILD_CATEGORY_LABEL as LABEL } from "../lib/build-category-labels.js";
import { Explain } from "./Explain.js";
import { ManaSymbols } from "./ManaSymbols.js";

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

/** A CAVEAT, ONE CLICK AWAY — `Explain` under this panel's own label, since everything folded here
 *  is a statement about what a figure IGNORES rather than what it means.
 *  → `specs/2026-08-20-report-usability-review.md` §4 */
function Caveat({ label = "what this number ignores", children }: { label?: string; children: ReactNode }) {
  return <Explain label={label}>{children}</Explain>;
}

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
  categories, parents, deckMath,
}: {
  categories: DeckReport["buildCategories"];
  /** The four Command-Zone template groups (`computeBuild`'s `buildParents`). This is what carries
   *  a target now — see the doc comment on `parentRow` below. The engine owns the grouping; there
   *  is no local `PARENTS` const to fall out of sync with it any more. */
  parents?: DeckReport["buildParents"];
  deckMath?: DeckReport["deckMath"];
}) {
  if (!categories || categories.length === 0) return null;
  const countByLeaf = new Map(categories.map((c) => [c.category, c.count]));
  const groupedLeaves = new Set((parents ?? []).flatMap((p) => p.leaves));
  // Anything no parent names (burn, stax) renders after them, exactly as before this task -- those
  // are win-plan and tax signals, never build roles, and each still carries its OWN target (today
  // always 0, per `build.ts`'s `BASE_TARGETS`, so nothing renders here in practice).
  const ungrouped = categories.filter((c) => c.target > 0 && !REPORTED_ELSEWHERE.has(c.category) && !groupedLeaves.has(c.category));
  if ((parents?.length ?? 0) === 0 && ungrouped.length === 0 && !deckMath) return null;

  /** ONE BAR SHAPE, geometry and `TARGET_MARK` unchanged from before grouping existed — only WHO
   *  gets a bar changed. Owner's 2026-08-21 ruling overrides the shape shipped 2026-08-20 ("a parent
   *  carries no target of its own"): a target declared ONCE at the parent, with leaves showing only
   *  how the deck spent it, is a different object, and that is what a parent's own row draws here. */
  const bar = (key: string, label: ReactNode, ariaName: string, count: number, target: number, note = "") => {
    const flagged = count < target;
    const state = flagged ? "under target" : "on target";
    const fill = Math.max(0, Math.min(1, (count / target) * TARGET_MARK));
    return (
      <li key={key} className="flex items-center gap-3" aria-label={`${ariaName} ${count} of ${target}, ${state}${note}`}>
        <span className="w-24 shrink-0 text-sm">{label}</span>
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
        <span className="w-14 shrink-0 text-right text-sm stat-num">{count}/{target}</span>
        <span className={`w-4 shrink-0 text-sm ${flagged ? "text-(--warning)" : "text-(--success)"}`} aria-hidden>{flagged ? "▲" : "✓"}</span>
      </li>
    );
  };

  /** THE PARENT'S OWN ROW — target, ratio and flag, exactly the bar a leaf used to draw. Its `<h4>`
   *  rides inside the label span (same slot a leaf's name would sit in), so the column is never
   *  blank and there is exactly one heading in the DOM whether the parent has one leaf or four —
   *  the single/multi-leaf branch this used to need (CONFLICT 8, F2) is gone: every parent has a
   *  ratio of its own now, so there is no more "no separate heading" special case to make.
   *
   *  `sumOfLeaves` is passed in rather than recomputed -- the caller already has it, because the
   *  leaf rows below need the identical number for F4's share fix. When it exceeds the parent's own
   *  UNION count, a card fills more than one of this parent's leaves (Grave Researcher: cardSelection
   *  AND draw-adjacent) -- said in the aria-label rather than left for a reader to notice the leaf
   *  shares summing past 100% of a total they can't see (fix F4, controller review 2026-08-21). */
  const parentRow = (p: NonNullable<typeof parents>[number], sumOfLeaves: number) => {
    const overlapNote = sumOfLeaves > p.count
      ? `; its leaves sum to ${sumOfLeaves} because some cards fill more than one`
      : "";
    return bar(p.name, <h4 className="eyebrow">{p.name}</h4>, p.name, p.count, p.target, overlapNote);
  };

  /** A LEAF UNDER A MULTI-LEAF PARENT — count and SHARE, never a target, ratio or flag (owner's
   *  ruling: "only a parent can be under target"). A single-leaf parent (Ramp, Board wipes) never
   *  calls this: its leaf row would just repeat the parent's own bar as "100%", which is the exact
   *  duplicate the folded shape exists to avoid.
   *
   *  SHARE IS OF THE LEAF SUM, NOT THE PARENT'S UNION (fix F4). Interaction's leaves summed to 9
   *  against a union of 8 (one card fills two), so dividing by the union read 114% across the row
   *  -- a distribution that doesn't total 100% reads as a broken number on a panel whose whole
   *  argument is that its numbers mean what they say. Dividing by the leaf sum instead makes every
   *  row's shares total 100% ALWAYS, by construction; the overlap is reported once, on the parent
   *  row above, rather than smeared invisibly across every leaf's percentage. */
  const leafRow = (category: string, parentName: string, sumOfLeaves: number) => {
    const name = LABEL[category] ?? category;
    const count = countByLeaf.get(category) ?? 0;
    const share = sumOfLeaves > 0 ? Math.round((count / sumOfLeaves) * 100) : 0;
    return (
      <li key={category} className="flex items-center gap-3 text-sm text-(--muted)" aria-label={`${name} ${count}, ${share}% of ${parentName}`}>
        {/* FIX F3 (controller review, 2026-08-21): `w-24` with a `pl-3` indent left only 84px for
          *  the label text, and three real leaf names need more -- "Stack interaction" measures
          *  121px, "Graveyard hate" 110px, "Card selection" 105px, all truncating (the graveyard one
          *  dangerously: "Graveyard …" reads as either hate or recursion, opposite things). Widened
          *  to `w-36` (144px, clears the widest with room to spare) and the indent DROPPED -- the
          *  missing bar/ratio/flag and the muted colour already mark a leaf row as subordinate, so
          *  the indent was decorative, not load-bearing, and it was the thing costing the width. */}
        <span className="w-36 shrink-0 truncate">{name}</span>
        <span className="flex-1 stat-num">{count} · {share}%</span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The parent of eight headings, and until now indistinguishable from the seven beneath it --
        *  the rank was correct in the DOM (one h3, seven h4s) and invisible in pixels, so a screen
        *  reader got a structure a sighted reader could not see. Foreground weight is the whole
        *  difference; the children keep the muted eyebrow they already had. */}
      <h3 className="eyebrow text-(--foreground)">Build benchmarks</h3>
      <ul className="flex flex-col gap-1.5">
        {(parents ?? []).map((p) => {
          // Computed once per parent and shared by its own row (the overlap note) and every leaf
          // beneath it (the share denominator) -- see the two doc comments above for why each reads it.
          const sumOfLeaves = p.leaves.reduce((s, l) => s + (countByLeaf.get(l) ?? 0), 0);
          return (
            <Fragment key={p.name}>
              {parentRow(p, sumOfLeaves)}
              {/* Ordered by the parent's own `leaves` list, never re-sorted -- a parent groups its
                *  leaves together on the page regardless of what order the engine happened to report
                *  them in. Every leaf renders, including a zero-count one (tutor at 0 IS the finding
                *  a combo deck's Consistency group is thin on). */}
              {p.leaves.length > 1 ? p.leaves.map((leaf) => leafRow(leaf, p.name, sumOfLeaves)) : null}
            </Fragment>
          );
        })}
        {ungrouped.map((c) => bar(c.category, LABEL[c.category] ?? c.category, LABEL[c.category] ?? c.category, c.count, c.target))}
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
  // THE MODE IS A FINDING, NOT A SUFFIX. Every row on a real deck carries the same one — this deck
  // reads "none exile" six times — and repeated six times it is noise, while said once it is a
  // sentence a deckbuilder acts on. Per-row text survives only when the rows DISAGREE, which is
  // when the suffix is carrying information.
  const answered = answers.filter((a) => a.class !== "graveyard" && a.count > 0);
  const noneExile = answered.length > 1 && answered.every((a) => a.exiling === 0);
  const graveyard = answers.find((a) => a.class === "graveyard");
  const noneRecurring = graveyard !== undefined && graveyard.count > 0 && graveyard.recurring === 0;
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
                ? noneRecurring ? "" : a.recurring > 0 ? `${a.recurring} recurring` : "none recurring"
                : noneExile ? "" : a.exiling > 0 ? `${a.exiling} exile` : "none exile";
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
                <span className="flex-1 text-right stat-num flex items-baseline justify-end gap-1.5">
                  <span className={none ? "text-(--warning)" : "text-(--muted)"}>
                    {none ? "none" : plural(a.count, "card")}
                  </span>
                  <span className={`text-xs ${mode.startsWith("none") ? "text-(--warning)" : "text-(--muted)"}`}>{mode}</span>
                </span>
                {/* The one prescriptive figure on the panel, and now the only number in its row
                  *  besides the count it is measured from. Narrower at 390px, where the label needs
                  *  96px for "planeswalker" and the count group was wrapping onto two lines. */}
                {/* MUTED, NOT AMBER, and this is a ruling rather than a style choice. A count of
                  *  ZERO is a fact about the deck — it cannot answer that class at all — and keeps
                  *  the warning colour above. "3 short of 5" is a CONVENTION's opinion about how
                  *  many you should hold, over classes (land, graveyard) whose floor nobody here
                  *  has calibrated; `BASE_TARGETS` is recorded as uncalibrated doctrine. Painting
                  *  five of six rows amber on a deck this engine rates 4.9/5 teaches the reader
                  *  that amber means nothing, and the one row that earns it loses with them. */}
                <span className="w-16 sm:w-24 shrink-0 text-right stat-num text-(--muted)">
                  {a.fromCommandZone ? "" : short > 0 ? `${short} short` : ""}
                </span>
              </li>
            );
          })}
        </ul>
        {/* The shortfall column is meaningless without the confidence it is measured against, and
          *  that confidence is a stated doctrine rather than a fact about the deck. Say it out loud
          *  next to the numbers it produces, the way the pricing turn is. */}
        {/* THE TWO FINDINGS THIS PANEL WAS BURYING. Both were per-row suffixes repeated down the
          *  column; both are single facts about the whole deck, and both are the kind of thing a
          *  player changes a decklist over. */}
        {noneExile ? (
          <p className="text-sm text-(--warning) max-w-[65ch]">
            Nothing this deck kills is exiled — everything it answers can come back.
          </p>
        ) : null}
        {noneRecurring ? (
          <p className="text-sm text-(--warning) max-w-[65ch]">
            Its graveyard hate is one-shot: {plural(graveyard!.count, "card")}, none of which keeps
            working after it resolves.
          </p>
        ) : null}
        {answers.some((a) => a.required > a.count) ? (
          <Caveat label={'what "short" is measured against'}>
            "Short" counts the cards this deck would have to add before it holds an answer of that
            class more often than not by turn {turn}. The COUNT is this deck's own; that it should
            hold one of every class is a deckbuilding convention someone typed, not a number
            measured from any deck — and nobody has calibrated the floor for land or graveyard
            answers at all.
          </Caveat>
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
            {[...new Set(castability.cards.map((c) => `${c.turn}:${c.mana}:${c.manaWithRocks}`))].map((groupKey) => {
              const group = castability.cards.filter(
                (c) => `${c.turn}:${c.mana}:${c.manaWithRocks}` === groupKey,
              );
              const { turn: costTurn, mana, manaWithRocks } = group[0]!;
              // A RANGE, low to high, and never a single number: lands-only under-states, and
              // lands-plus-rocks over-states because the rock needs lands too. Collapsed to one
              // figure when the deck runs no rock cheap enough to matter, so a rockless deck does
              // not print "78% – 78%".
              const manaText = pct(manaWithRocks) === pct(mana)
                ? pct(mana)
                : `${pct(mana)} – ${pct(manaWithRocks)}`;
              return (
                <li key={groupKey} className="flex flex-col gap-1">
                  <div className="flex items-baseline gap-3 text-sm">
                    <span className="flex-1 stat-num">
                      {costTurn}-drop{group.length === 1 ? "" : "s"}
                    </span>
                    <span className="shrink-0 stat-num">
                      {manaText} to have {costTurn} mana by turn {costTurn}
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
                            `${c.name}, ${manaText} to have ${c.turn} mana by turn ${c.turn}`
                            + (colourPart ? `, ${colourPart}` : "")
                          }
                        >
                          {/* Two axes, never multiplied into one. Both are driven by the same lands,
                            *  so the correlation is positive -- and the product would hide whether
                            *  the deck's problem is mana or colour. */}
                          <span className="flex-1 sm:truncate text-(--muted)">{c.name}</span>
                          <span className="shrink-0 sm:text-right stat-num text-(--muted) text-xs">
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
          <Caveat label="how these are priced">
            {castability.refused > 0
              ? `${plural(castability.refused, "card")} refused — X costs, delve, convoke and free casts are not priced rather than guessed. `
              : ""}
            {castability.biases}
          </Caveat>
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
            <span className="w-32 shrink-0 stat-num">
              {clock.turn === undefined ? "no clock" : `Kills on turn ${clock.turn}`}
            </span>
            <span className="flex-1 text-xs text-(--muted) tabular-nums">
              {clock.turn === undefined
                ? "nothing here kills through combat — a mill or alt-win deck has no combat clock"
                : `${clock.powerAtFive} expected power on board by turn 5, on the way there`}
            </span>
          </div>
          {/* A turn number that does not say how it was made reads as a prediction. It is a RATE:
            *  useful for comparing two decks, useless as a date. */}
          <Caveat label="how the clock is modelled">
            Expected attacking power against one opponent's 40 life. Nobody blocks in this model,
            nothing is removed, and there is no mana budget — a creature counts once the turn number
            reaches its cost, however many others arrived with it, and no ramp shortens that. Read it
            to compare decks, not to plan a game.
          </Caveat>
        </div>
  ) : null;

  // WIN PLANS, FOLDED INTO A SENTENCE. Three bars carried three shares, and a share is the one
  // thing a bar says worst here: the counts are what distinguish "46% of a three-card plan" from
  // "46% of a thirteen-card one", and the concentration figure needed a footnote apologising that
  // its direction is inverted against every other number on the panel. Said in words, the direction
  // is in the sentence and the apology is unnecessary.
  const winBlock = wincons && wincons.classes.length > 0 ? (
        <div className="flex flex-col gap-1">
          <h5 className="eyebrow">Win plans</h5>
          <p
            className="text-sm"
            aria-label={`win plans: ${wincons.classes.map((w) => `${w.class} ${w.count} cards`).join(", ")}, focus ${wincons.focus.toFixed(2)} of 1.00`}
          >
            <span className="text-(--muted)">Mostly </span>
            {wincons.classes.map((w, i) => (
              <span key={w.class}>
                {i > 0 ? <span className="text-(--muted)"> · </span> : null}
                {w.class} <span className="tabular-nums text-(--muted)">{plural(w.count, "card")}</span>
              </span>
            ))}
          </p>
          <p className="text-xs text-(--muted) max-w-[65ch] tabular-nums">
            Concentration {wincons.focus.toFixed(2)} of 1.00, where 1.00 is a deck all-in on one plan
            and {(1 / Math.max(1, wincons.classes.length)).toFixed(2)} is these {wincons.classes.length}{" "}
            plans split evenly. Higher is better here, unlike every other figure on this panel.
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
            <span className="w-32 shrink-0 stat-num">{lands.actual} in deck</span>
            {/* A sentence, not a table cell -- "avg mana value 2.6 · 4 cheap ramp/draw · 0 fast
              *  mana" stays the body face and only picks up plain tabular alignment so its three
              *  figures don't shift the "·"s between them. */}
            <span className="flex-1 text-xs text-(--muted) tabular-nums">
              avg mana value {lands.avgManaValue} · {lands.rampPlusDraw} cheap ramp/draw · {lands.fastMana} fast mana
              {lands.mdfc > 0
                ? ` · ${lands.mdfc} modal DFC${lands.mdfc === 1 ? "" : "s"} counted as spells, not lands`
                : ""}
            </span>
            <span
              className={`w-16 shrink-0 text-right stat-num ${
                Math.abs(lands.actual - lands.target) > 2 ? "text-(--warning)" : "text-(--success)"
              }`}
            >
              wants {lands.target}
            </span>
          </div>
        </div>
  ) : null;

  // WHAT YOUR LIBRARY IS WORTH to a payoff that reads a random card off the top. Sits with "how you
  // win" because it IS the plan for the decks that run one -- Hidetsugu and Kairi drains for the
  // mana value of whatever is on top, so the curve is the payoff. Deck level and naming no member:
  // the trigger CHOOSES nothing, so an edge to one expensive spell would be true of every one of
  // them equally (`topdeck.ts` carries the refusal in full).
  const topdeckBlock = deckMath.topdeck.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <h5 className="eyebrow">Off the top</h5>
          <ul className="flex flex-col gap-1">
            {deckMath.topdeck.map((t) => (
              <li key={t.card} className="flex items-baseline gap-3 text-sm">
                <span className="w-40 shrink-0 truncate">{t.card}</span>
                <span className="flex-1 text-xs text-(--muted) tabular-nums">
                  a random card off your library is worth{" "}
                  <span className="text-(--fg)">{t.meanManaValue}</span> mana —{" "}
                  {t.nonlandMeanManaValue} when it is not a land, and {Math.round(t.landShare * 100)}% of the
                  time it is one
                  {t.castable
                    ? ` · ${Math.round(t.castable.share * 100)}% of your library is ${t.castable.types.join(" or ")}, which it casts for free`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
  ) : null;

  // CAN THE MANA BASE EVEN HOLD THIS? Each row's `required` is the sources ONE early double-pip card
  // wants at 90% confidence, and the rows are independent demands on the same lands: this deck asks
  // 36 + 33 + 33 = 102 source-slots of 34 lands. A three-colour deck cannot satisfy them all, so
  // painting each row amber says "your mana base is broken" about an arithmetic impossibility, and
  // the honest fix is usually the SPELL rather than the land count. Amber survives only where the
  // gap is closable — a single row whose demand fits inside the deck's own land count, in a deck
  // whose rows together also fit.
  const totalRequired = colors.reduce((n, c) => n + (c.worst?.required ?? 0), 0);
  const landRoom = lands?.actual ?? 0;
  const overcommitted = totalRequired > landRoom;
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
                      // Colour demand now renders in the same notation as a printed cost, so the
                      // reader meets one convention instead of two ("4 W" here, "{3}{B}{B}" in the
                      // Cards table).
                      ? (
                        <>
                          {plural(c.worst.cards, "card")} {c.worst.cards === 1 ? "wants" : "want"}{" "}
                          <ManaSymbols cost={`{${c.color}}`.repeat(c.worst.pips)} /> on turn {c.worst.turn}
                        </>
                      )
                      : "every cost covered"}
                  </span>
                  {/* "23 of 36 sources" and "short 13" were the same subtraction printed twice.
                    *  The pair survives as one cell, coloured: the reader can see the gap and its
                    *  size in one place. */}
                  <span
                    className={`w-40 shrink-0 text-right stat-num ${
                      !c.worst
                        ? "text-(--success)"
                        : overcommitted || c.worst.required > landRoom
                          ? "text-(--muted)"
                          : "text-(--warning)"
                    }`}
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
          {overcommitted ? (
            <p className="text-xs text-(--muted) max-w-[65ch]">
              Together these rows want {totalRequired} sources from {landRoom} lands, which no deck
              can hold — read them as what each card is asking for, not as a shortfall to fix.
            </p>
          ) : null}
          {colors.some((c) => c.worst) ? (
            <Caveat label="what each row is measured against">
              Each row is the earliest double-pip card in that colour, at 90% confidence — not the
              deck's land count, which is judged above. Cutting or delaying one early double pip
              answers a gap as well as adding lands does
              {overcommitted ? ", and here it is the only thing that can" : ""}.
            </Caveat>
          ) : null}
        </div>
  ) : null;

  // WANTS VS SUPPLIES, UNMET FIRST AND THE REST FOLDED. Every row is a pair of counts with no
  // verdict attached, and on a deck that works they all read the same way — "15 want · 47 supply" —
  // so the block spent its height restating that the deck functions. The row that MATTERS is a want
  // with nothing supplying it, and on a good deck there are none, which is exactly why the whole
  // list belongs one click down rather than open by default. A row the GAME supplies (an end step,
  // an upkeep) is never unmet: nothing has to provide it.
  const demandRow = (d: (typeof demand)[number]) => {
    const sentence = demandSentence(d.key);
    const label =
      d.available === null
        ? `${sentence}, ${d.consumers} cards want it, the game supplies it`
        : `${sentence}, ${d.consumers} cards want it, ${d.suppliers} supply it`;
    return (
      <li key={d.key} className="flex items-center gap-3 text-sm" aria-label={label}>
        {/* The raw census key stays reachable on hover, because `bin/deck-availability.ts` prints
          *  keys and a report you cannot match against the bin is a dead end. */}
        <span className="flex-1 truncate" title={d.key}>{sentence}</span>
        <span className={`shrink-0 stat-num ${d.available !== null && d.suppliers === 0 ? "text-(--warning)" : "text-(--muted)"}`}>
          {d.available === null
            ? `${d.consumers} want · the game supplies it`
            : `${d.consumers} want · ${d.suppliers} supply`}
        </span>
      </li>
    );
  };
  const unmet = demand.filter((d) => d.available !== null && d.suppliers === 0);
  const demandBlock = (
      <div className="flex flex-col gap-1.5">
        <h5 className="eyebrow">Wants vs supplies</h5>
        {unmet.length > 0 ? (
          <>
            <p className="text-sm text-(--muted)">
              {plural(unmet.length, "want")} with nothing in the deck supplying{" "}
              {unmet.length === 1 ? "it" : "them"}.
            </p>
            <ul className="flex flex-col gap-1">{unmet.map(demandRow)}</ul>
          </>
        ) : (
          <p className="text-sm text-(--muted)">
            Every want in this deck has something supplying it.
          </p>
        )}
        <details>
          <summary className="eyebrow cursor-pointer text-(--muted)">
            all {demand.length} wants
          </summary>
          <ul className="flex flex-col gap-1 pt-1">{demand.map(demandRow)}</ul>
        </details>
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
      // A row nobody can close does not lead the panel either — same ruling as the colour it paints.
      flagged:
        colors.some((c) => c.worst && !overcommitted && c.worst.required <= landRoom)
        || (lands !== undefined && Math.abs(lands.actual - lands.target) > 2),
      blocks: [landsBlock, coloursBlock, castsBlock],
    },
    {
      title: "Can you deal with theirs",
      // FLAG WHAT IS PAINTED. A class with NO answers is a fact about the deck, and so are the two
      // findings below it; "3 short of 5" is a convention's opinion and is rendered muted, so it no
      // longer decides which section a reader meets first either.
      flagged: answers.some((a) => a.count === 0) || noneExile || noneRecurring,
      blocks: [answersBlock],
    },
    { title: "How you win", flagged: false, blocks: [clockBlock, winBlock, topdeckBlock] },
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
      {/* THE HORIZON STAYS VISIBLE and its caveats fold: every probability below is priced at this
        *  turn, so a reader who does not know the number cannot read the panel at all — while the
        *  four things the model ignores are what they consult once and then stop needing. */}
      <div className="flex flex-col gap-1">
        <p className="text-xs text-(--muted) max-w-[65ch] tabular-nums">
          Everything below is priced at turn {turn} —{" "}
          {deckMath.turnSource === "corpus-median"
            ? "the median of the calibration decks, because this deck has no combat clock"
            : deckMath.turnSource === "override"
              ? "a fixed horizon"
              : "this deck's own clock"}
          , {seen} cards seen.
        </p>
        <Caveat>
          Supply is unweighted — a repeatable outlet counts the same as a one-shot. No mulligans and
          no opponent, and card draw is ignored: a deck five cards ahead of that reads about 11
          points higher on a coverage figure, ten cards ahead about 20, so each one is conservative
          for a deck that draws.
        </Caveat>
      </div>

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
            <h4 className="eyebrow">{s.title}</h4>
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
