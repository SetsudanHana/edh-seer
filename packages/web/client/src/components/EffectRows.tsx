import { useId } from "react";
import { ABILITY_KINDS, REPEATS_LADDER, type FactKind } from "@edh-seer/matcher/member-facts";
import type { Repeats } from "@edh-seer/tagger";
import { RangeRow } from "./RangeRow.js";

/** HOW THE ASKED EVENTS HAPPEN (owner, 2026-10-24): three rows that narrow the sentence's events
 *  rather than the cards. Each says so in its own words, because a reader who adds "Amount" and
 *  sees nothing change needs to know it is waiting for a "causes" event. */

/** The rules' own words for the five kinds. "Spell" is what an instant or sorcery does when it
 *  resolves; "Whenever you cast" is a trigger. */
export const ABILITY_KIND_LABEL: Record<FactKind, string> = {
  spell: "Spell",
  triggered: "Triggered",
  activated: "Activated",
  static: "Static",
  replacement: "Replacement",
};

/** THE LADDER IN A PLAYER'S WORDS, EACH OPTION SAYING WHAT IT KEEPS (#1405 B). The filter is a
 *  minimum on the ladder, so every rung keeps the ones above it: a bare "at least" beside "Any number
 *  of times" read as no limit, which is the opposite -- the top rung. `per-cycle` is once a round
 *  (your turn, or one use of a tap ability); `per-turn` fires on every player's turn; `once` is NOT
 *  "Any": any minimum runs `memberPasses`, so a card on the event by being cast, entering or a keyword
 *  (no ability fact) fails it, and the left-out note counts it -- the same restriction the Ability type
 *  row expresses, kept as a rung because a shared `?repeats=once` link must still select. `repeatable`
 *  (an activated ability with no limit, a trigger that fires every time) keeps `continuous` too (`factPasses` compares ladder positions), so it says so. */
export const REPEATS_LABEL: Record<(typeof REPEATS_LADDER)[number], string> = {
  once: "Once or more (by an ability)",
  "per-cycle": "At least once a round",
  "per-turn": "At least every turn",
  repeatable: "No limit, or always on",
  continuous: "Always on",
};

export function AbilityKindRow(
  { chosen, onChange }: { chosen: readonly FactKind[]; onChange: (next: FactKind[]) => void },
): React.JSX.Element {
  return (
    <fieldset className="flex flex-wrap items-center gap-2">
      <legend className="eyebrow">Ability type</legend>
      {ABILITY_KINDS.map((k) => {
        const on = chosen.includes(k);
        return (
          <button
            key={k} type="button" aria-pressed={on} className="chip"
            onClick={() => onChange(on ? chosen.filter((x) => x !== k) : [...chosen, k])}
          >
            {ABILITY_KIND_LABEL[k]}
          </button>
        );
      })}
    </fieldset>
  );
}

export function RepeatsRow(
  { min, onChange }: { min: Repeats | undefined; onChange: (next: Repeats | undefined) => void },
): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label className="eyebrow" htmlFor={id}>How often</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={id} className="field w-full sm:w-80"
          value={min ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value as Repeats)}
        >
          <option value="">Any</option>
          {REPEATS_LADDER.map((r) => <option key={r} value={r}>{REPEATS_LABEL[r]}</option>)}
        </select>
      </div>
    </div>
  );
}

/** THE SIZE OF ONE OCCURRENCE (owner: "per occurrence, cause I am looking for noncombat pingers
 *  that ping for exactly 1"). "1 to 1" is exactly one. A variable size is left out unless asked
 *  for: "equal to its power" is not an answer to "exactly 1".
 *
 *  ON A "CARES ABOUT" EVENT THE SAME RANGE READS A REPLACEMENT'S CHANGE (owner, 2026-10-24), and
 *  ONLY ONCE AN OP IS CHOSEN: Torbran adds 2, Furnace of Rath doubles. With no op the range narrows
 *  the causes and leaves the "cares about" side alone (askers state no amount; review of #1339). */
export function AmountRow(
  { min, max, variable, change, caresAbout, onChange }: {
    min: number | undefined; max: number | undefined; variable: boolean; change: "plus" | "times" | undefined;
    /** The query has a "cares about" term: only then does a replacement's change mean anything. */
    caresAbout: boolean;
    onChange: (next: { min: number | undefined; max: number | undefined; variable: boolean; change: "plus" | "times" | undefined }) => void;
  },
): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <RangeRow
        label="Amount, each time" min={min} max={max} ceiling={20}
        onChange={(r) => onChange({ ...r, variable, change })}
      />
      <p className="text-(--muted) text-sm max-w-[55ch]">How many each time it happens.</p>
      {/* THE TARGET IS THE WHOLE ROW, NOT THE 13px BOX (24px floor, #1405 B). */}
      <label className="flex items-center gap-2 text-sm min-h-6 py-1">
        <input type="checkbox" className="size-6 shrink-0" checked={variable} onChange={(e) => onChange({ min, max, variable: e.target.checked, change })} />
        Include variable amounts (X, “equal to its power”)
      </label>
      {/* ONLY BESIDE A "CARES ABOUT" EVENT (#1405 B): on a causes event the op is ignored, and both
        * review seats skipped the control and its paragraph as jargon. A link's `amtop` with none is
        * kept in the URL untouched; the filter logic ignores it on the causes side. */}
      {caresAbout && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor={id}>A replacement that</label>
            <select
              id={id} className="field w-40"
              value={change ?? ""}
              onChange={(e) => onChange({ min, max, variable, change: e.target.value === "" ? undefined : e.target.value as "plus" | "times" })}
            >
              <option value="">adds or multiplies</option>
              <option value="plus">adds (+N)</option>
              <option value="times">multiplies (×N)</option>
            </select>
          </div>
          <p className="text-(--muted) text-sm max-w-[55ch]">
            For cards that change it, like Torbran (+2 damage) or a doubler (×2): how much they add or multiply.
          </p>
        </div>
      )}
    </div>
  );
}
