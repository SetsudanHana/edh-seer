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

/** THE LADDER IN A PLAYER'S WORDS. `per-cycle` is once a round -- your turn, or one use of a tap
 *  ability; `per-turn` fires on every player's turn. */
export const REPEATS_LABEL: Record<(typeof REPEATS_LADDER)[number], string> = {
  once: "Once",
  "per-cycle": "Once a round",
  "per-turn": "Every turn",
  repeatable: "Any number of times",
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
        <span className="text-(--muted) text-sm">at least</span>
        <select
          id={id} className="field w-52"
          value={min ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value as Repeats)}
        >
          <option value="">any</option>
          {REPEATS_LADDER.map((r) => <option key={r} value={r}>{REPEATS_LABEL[r]}</option>)}
        </select>
      </div>
    </div>
  );
}

/** THE SIZE OF ONE OCCURRENCE (owner: "per occurrence, cause I am looking for noncombat pingers
 *  that ping for exactly 1"). "1 to 1" is exactly one. A variable size is left out unless asked
 *  for: "equal to its power" is not an answer to "exactly 1". */
export function AmountRow(
  { min, max, variable, onChange }: {
    min: number | undefined; max: number | undefined; variable: boolean;
    onChange: (next: { min: number | undefined; max: number | undefined; variable: boolean }) => void;
  },
): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <RangeRow
        label="Amount, each time" min={min} max={max} ceiling={20}
        onChange={(r) => onChange({ ...r, variable })}
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={variable} onChange={(e) => onChange({ min, max, variable: e.target.checked })} />
        Include variable amounts (X, “equal to its power”)
      </label>
      <p className="text-(--muted) text-sm max-w-[55ch]">Counts what a card causes, not what it cares about.</p>
    </div>
  );
}
