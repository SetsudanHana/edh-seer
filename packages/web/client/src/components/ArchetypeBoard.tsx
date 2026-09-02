import { useMemo, useState } from "react";
import type { DeckReport } from "../types.js";
import { Explain } from "./Explain.js";
import { ThemeMatrix } from "./ThemeMatrix.js";
import { themeMatrix } from "../lib/theme-matrix.js";
import { CardName } from "./card-drawer.js";

type Group = NonNullable<DeckReport["archetypes"]>[number];
type Strategy = NonNullable<DeckReport["strategies"]>[number];
const PAIR_CAP = 8;

function StrategyRow({ s, max }: { s: Strategy; max: number }) {
  const pct = Math.round(s.confidence * 100);
  const widthPct = max > 0 ? Math.max(4, Math.round((s.confidence / max) * 100)) : 4;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-(--separator)">
      <span className="w-40 shrink-0 truncate">{s.label}</span>
      <div className="flex-1 h-2 bg-(--separator) rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-(--fill)" style={{ width: `${widthPct}%` }} />
      </div>
      <span className="stat-num text-xs text-(--muted) w-12 text-right shrink-0">{pct}%</span>
    </div>
  );
}

/** The reason sentences of one pair, deduped — see the note in the expanded list below. */
const pairReasons = (pair: Group["pairs"][number]): string[] =>
  [...new Map(pair.reasons.map((r) => [r.text, r] as const)).values()].map((r) => r.text);

function GroupRow({ group, size }: { group: Group; size?: { earned: number; total: number } }) {
  const [open, setOpen] = useState(false);
  // NO BAR (T15). A bar scaled to the biggest group IS a ranking, and it was read as one: on an
  // Enchantress deck the widest track said `Spellslinger`, against a chapter-1 headline saying
  // "enchantments entering". Group size is not an identity claim under ANY key -- ranking these on
  // earned membership instead was measured over the 71 decks and is WORSE, making `Ramp Payoff` the
  // modal winner on 41 of them against `Spellslinger`'s 19 today. The theme leads; these are
  // membership. Roadmap T15.
  const shown = group.pairs.slice(0, PAIR_CAP);
  const extra = group.pairs.length - shown.length;
  // TWO PAIRS IN THE OPEN, because a collapsed row is a label and a number, and a label is exactly
  // what a reader cannot check. The one thing that told the review "Aristocrats" was mislabelled
  // was reading its pairs — which took a click, on one group, out of thirteen.
  const preview = group.pairs.slice(0, 2);
  return (
    <div className="flex flex-col gap-1 py-2 border-b border-(--separator)">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-3 text-left w-full" aria-expanded={open}>
        <span className="w-40 shrink-0 truncate flex items-center gap-1">
          <span aria-hidden className="text-(--muted) text-xs">{open ? "▾" : "▸"}</span>
          {group.label}
        </span>
        <span className="flex-1" />
        {/* WHAT THE CARD COUNT MEANT, BESIDE IT. `cards.length` counts a card that joined by being
          *  PLAYED -- the matcher synthesises "any nonland is cast" and "any permanent enters" so a
          *  payoff has something to feed on -- which is how 61 of 99 cards became `Spellslinger`.
          *  The earned half is the one that means the card does something about the group, and it
          *  is the same split the matrix above draws its dots from. */}
        <span className="stat-num text-xs text-(--muted) w-44 text-right shrink-0">
          {group.pairs.length} pair{group.pairs.length === 1 ? "" : "s"}
          {size ? ` · ${size.earned} of ${size.total} cards earn it` : ` · ${group.cards.length} cards`}
        </span>
      </button>
      {open ? null : (
        <ul className="flex flex-col pl-6 text-xs text-(--muted)">
          {preview.map((pair, i) => (
            <li key={`${pair.a}-${pair.b}-${i}`} className="truncate">
              {/* THE NAMES OPEN THE CARDS (roadmap S8). This list is the evidence behind a group --
                *  the one surface naming the pair a membership rests on -- and it was the one
                *  surface you could not open a card from, because it printed raw text. */}
              <CardName name={pair.a} /> + <CardName name={pair.b} />
              {pairReasons(pair)[0] ? <span> — {pairReasons(pair)[0]}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <ul className="flex flex-col gap-2 pl-4 pt-1">
          {shown.map((pair, i) => (
            <li key={`${pair.a}-${pair.b}-${i}`} className="text-sm">
              <span className="font-semibold"><CardName name={pair.a} /> + <CardName name={pair.b} /></span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {/* ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER. Archon of
                    Cruelty's entry trigger derives six reasons identical in tag and text, differing
                    only in `effectKind` -- and the objects survive on purpose, because `effectKind`
                    is load-bearing for archetype detection. So the dedupe belongs at the reader, as
                    it already does on the graph wire (`data.module.ts`). Inline rather than shared:
                    the client value-imports nothing from `@edh-seer/engine` today, and pulling the engine
                    into the browser bundle for four lines is a worse trade than repeating them. */}
                {pairReasons(pair).map((text, j) => (
                  <li key={j} className="text-(--muted) border-l border-(--separator) pl-2">{text}</li>
                ))}
              </ul>
            </li>
          ))}
          {extra > 0 ? <li className="text-xs text-(--muted)">+{extra} more pair{extra === 1 ? "" : "s"}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}

export function ArchetypeBoard({ strategies, archetypes, nonlandNames = [], coverage }: {
  strategies?: DeckReport["strategies"];
  archetypes: DeckReport["archetypes"];
  /** Nonland card names, for the matrix's rows. Supplied by the caller because the land rule is
   *  `primaryType`'s and reads TYPES, which this component is never given -- one copy of that rule,
   *  the same one `DeckWaffle` uses. */
  nonlandNames?: readonly string[];
  /** THE COVERAGE LIMIT, IN WORDS (S13, 2026-09-02). Everything this component draws is
   *  derived-only: `cardSignals` (`matcher/src/analyze.ts:835`) filters on `dc.tags`, and the
   *  groups are built from edges. This was the ONE coverage-limited surface on the page carrying
   *  neither a worded caveat nor the hatch -- the synergy dial prints "too little of the deck read
   *  to call this", `CutList` names the unjudged, the graph hatches its nodes, and the board said
   *  nothing. Absent on a fully-read deck, like every other coverage-keyed line. */
  coverage?: DeckReport["coverage"];
}) {
  const hasStrategies = !!strategies && strategies.length > 0;
  const hasGroups = !!archetypes && archetypes.length > 0;
  if (!hasStrategies && !hasGroups) {
    return <p className="text-(--muted) text-sm">No recognizable archetype patterns — try adding more synergy pieces.</p>;
  }
  const sMax = hasStrategies ? Math.max(...strategies!.map((s) => s.confidence)) : 1;
  const unread = coverage ? coverage.resolved - coverage.derived : 0;
  // THE SAME SPLIT THE MATRIX DRAWS, asked once. `themeMatrix` is pure and its column stats are the
  // only definition of "earned" on the page -- deriving a second one here is how two counts of one
  // thing start disagreeing.
  const groupSize = useMemo(() => {
    const m = themeMatrix(archetypes, nonlandNames);
    return new Map((m?.columns ?? []).map((c) => [c.category, { earned: c.earned, total: c.total }] as const));
  }, [archetypes, nonlandNames]);
  return (
    <div className="flex flex-col gap-6">
      {/* A FLOOR, NOT A READING, and the asymmetry is the reason it has to be said. The numerator
        *  is derived-only and the denominator is not: `detectArchetypes` is handed `cardSignals`
        *  (cards with tags) against `nonlandCount` (`nonlands.length`, every nonland whether read
        *  or not). So an unread card contributes no signal and still divides -- a plan the unread
        *  cards actually run reads LOWER here than it is, which is the silent-wrong-answer shape
        *  rather than a missing one. */}
      {coverage && unread > 0 ? (
        <p className="text-xs text-(--muted) max-w-[62ch]">
          Read from the{" "}
          <span className="stat-num text-(--foreground)">{coverage.derived}</span> cards of{" "}
          <span className="stat-num">{coverage.resolved}</span> the engine could read. The other{" "}
          {unread} card{unread === 1 ? "" : "s"} {unread === 1 ? "signals" : "signal"} no strategy
          and still {unread === 1 ? "counts" : "count"} in the share below, so every percentage here
          is a floor.
        </p>
      ) : null}
      {/* ONE PANEL, ONE IDENTITY CLAIM (T15). These were two panels, "Strategies" and the groups,
        *  and a reader met three answers to "what is this deck" on one screen: the chapter-1 theme
        *  said enchantments entering, Strategies said Tokens, and the groups' widest bar said
        *  Spellslinger. None of them was lying and nothing on the page said they were different
        *  questions. The theme is the identity -- it is the EDGE-derived reading, and `DeckIdentity`
        *  has said since it was written that "the strategies are which named archetypes its cards
        *  signal" and are context. So they share a heading and the sentence that separates them,
        *  and neither sub-list claims a winner. */}
      {/* NOT A HEADING AND NOT A DISCLOSURE (T1). The h3 restated the chapter title one line above
        *  it, and the sentence under it was the whole of T15 -- which is exactly the thing that must
        *  not sit behind a toggle a reader never opens. It is one visible line now. */}
      <p className="text-xs text-(--muted) max-w-[65ch]">
        The theme at the top of the report is what this deck is. Nothing here competes with it —
        these are two ways of showing which cards belong to which theme, and neither is ranked.
      </p>
      {hasStrategies ? (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Archetypes</h3>
          {/* A PERCENTAGE WITH NO DENOMINATOR IS NOT A FIGURE. "Tokens 22%" was 22% of something the
            *  page never named — and the bars are scaled to the leader, not to 100%, so the widest
            *  one says "most" and not "all". */}
          <Explain label="what the percentages count">
            The share of the deck's nonland cards whose own text signals that plan. A card can
            signal several, so these do not add to 100% — and the bars are drawn against the
            strongest plan rather than against the whole deck.
            {/* WHY THE DECK'S OWN HEADLINE IS NOT IN THIS LIST (S16, 2026-09-02). Chapter 1 prints
              *  the theme in the largest type on the page -- "enchantments entering" -- and none of
              *  these six bars says enchantment, because they are two different classifiers: this
              *  is a FIXED list of named archetypes a card's text signals, and the theme is
              *  whatever this deck's own EDGES turned out to be about. Both judges who read both
              *  chapters filed it, the beginner as *"I now feel like I don't know what I own."*
              *  Saying it is the fix; renaming either classifier is not this item's. */}
            {" "}These are named archetypes from a fixed list, so the deck&rsquo;s own theme will
            often not be one of these names.
          </Explain>
          <div className="flex flex-col">{strategies!.map((s) => <StrategyRow key={s.name} s={s} max={sMax} />)}</div>
        </div>
      ) : null}
      {/* THE MATRIX IS THE GROUPS' MEMBERSHIP, drawn per CARD (roadmap S6). It goes above the
        *  group rows rather than replacing them: a group row's expanded PAIRS are the evidence for
        *  a membership -- "Krenko + Impact Tremors, and the sentence why" -- and the matrix has
        *  room for a dot and not for a reason. Same posture as the waffle over `MissingCards` and
        *  the bracket band over its named list.
        *
        *  THE TOP-LEVEL ARCHETYPES TAB STAYS FOR NOW, though S6's line says the matrix absorbs it.
        *  `strategies` above is not group data and the matrix does not carry it, and removing a tab
        *  is a NAVIGATION change -- S7's, and it wants every chapter visible at once before
        *  deciding. Same call as leaving `CoveragePanel` above the tabs in S3. */}
      {hasGroups ? <ThemeMatrix archetypes={archetypes} nonlandNames={nonlandNames} /> : null}
      {hasGroups ? (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">The pairs behind each group</h3>
          <Explain label="what a group counts">
            Pairs of cards whose synergy matches a known mechanism, and the cards those pairs touch.
            One pair can belong to several groups, and a group saying nothing a bigger one has not
            already said is dropped. These are not ranked, because a card can join a group just by
            being played — every nonland counts as cast, every permanent as entering. The card count
            says how far a group reaches, never how much the deck is about it; the earned figure is
            the members that do something about it.
          </Explain>
          <div className="flex flex-col">
            {archetypes!.map((g) => (
              <GroupRow key={g.category} group={g} size={groupSize.get(g.category)} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
