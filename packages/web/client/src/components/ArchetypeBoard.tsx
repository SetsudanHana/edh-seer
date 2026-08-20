import { useState } from "react";
import type { DeckReport } from "../types.js";

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
        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundImage: "var(--accent-gradient)" }} />
      </div>
      <span className="font-mono text-xs text-(--muted) w-12 text-right shrink-0 tabular-nums">{pct}%</span>
    </div>
  );
}

/** The reason sentences of one pair, deduped — see the note in the expanded list below. */
const pairReasons = (pair: Group["pairs"][number]): string[] =>
  [...new Map(pair.reasons.map((r) => [r.text, r] as const)).values()].map((r) => r.text);

function GroupRow({ group, max }: { group: Group; max: number }) {
  const [open, setOpen] = useState(false);
  // SIZED BY PAIRS, NOT CARDS. Card count is what a group REACHES; pairs are what it CLAIMS, and
  // the two disagree wildly — on the review deck four groups all read "70 cards" while their pair
  // counts ran 334 to 440, so the bars were four identical full-width tracks over four different
  // findings. The engine ranks by pairs now (`mechanisms.ts`); this makes the bar agree with it.
  const widthPct = Math.max(4, Math.round((group.pairs.length / max) * 100));
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
        <div className="flex-1 h-2 bg-(--separator) rounded-full overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundImage: "var(--accent-gradient)" }} />
        </div>
        <span className="font-mono text-xs text-(--muted) w-28 text-right shrink-0 tabular-nums">
          {group.pairs.length} pair{group.pairs.length === 1 ? "" : "s"} · {group.cards.length} cards
        </span>
      </button>
      {open ? null : (
        <ul className="flex flex-col pl-6 text-xs text-(--muted)">
          {preview.map((pair, i) => (
            <li key={`${pair.a}-${pair.b}-${i}`} className="truncate">
              {pair.a} + {pair.b}
              {pairReasons(pair)[0] ? <span> — {pairReasons(pair)[0]}</span> : null}
            </li>
          ))}
        </ul>
      )}
      {open ? (
        <ul className="flex flex-col gap-2 pl-4 pt-1">
          {shown.map((pair, i) => (
            <li key={`${pair.a}-${pair.b}-${i}`} className="text-sm">
              <span className="font-semibold">{pair.a} + {pair.b}</span>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {/* ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER. Archon of
                    Cruelty's entry trigger derives six reasons identical in tag and text, differing
                    only in `effectKind` -- and the objects survive on purpose, because `effectKind`
                    is load-bearing for archetype detection. So the dedupe belongs at the reader, as
                    it already does on the graph wire (`data.module.ts`). Inline rather than shared:
                    the client value-imports nothing from `@mtg/engine` today, and pulling the engine
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

export function ArchetypeBoard({ strategies, archetypes }: { strategies?: DeckReport["strategies"]; archetypes: DeckReport["archetypes"] }) {
  const hasStrategies = !!strategies && strategies.length > 0;
  const hasGroups = !!archetypes && archetypes.length > 0;
  if (!hasStrategies && !hasGroups) {
    return <p className="text-(--muted) text-sm">No recognizable archetype patterns — try adding more synergy pieces.</p>;
  }
  const sMax = hasStrategies ? Math.max(...strategies!.map((s) => s.confidence)) : 1;
  const gMax = hasGroups ? Math.max(1, ...archetypes!.map((g) => g.pairs.length)) : 1;
  return (
    <div className="flex flex-col gap-6">
      {hasStrategies ? (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Strategies</h3>
          <div className="flex flex-col">{strategies!.map((s) => <StrategyRow key={s.name} s={s} max={sMax} />)}</div>
        </div>
      ) : null}
      {hasGroups ? (
        <div className="flex flex-col gap-2">
          <h3 className="eyebrow">Synergy groups</h3>
          <div className="flex flex-col">{archetypes!.map((g) => <GroupRow key={g.category} group={g} max={gMax} />)}</div>
        </div>
      ) : null}
    </div>
  );
}
