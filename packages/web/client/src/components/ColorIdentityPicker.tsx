import type { ColorLetter } from "../lib/color-identity.js";
import { identityColor, identityGradient, identityLabel } from "../lib/color-identity.js";

const LETTERS: ColorLetter[] = ["W", "U", "B", "R", "G"];

export function ColorIdentityPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (colors: string[]) => void;
}) {
  function toggle(letter: ColorLetter) {
    onChange(value.includes(letter) ? value.filter((c) => c !== letter) : [...value, letter]);
  }

  return (
    <div className="flex items-center gap-2">
      <span className="eyebrow">Your colors</span>
      <div role="group" aria-label="Preferred color identity" className="flex gap-1">
        {LETTERS.map((letter) => {
          const active = value.includes(letter);
          const color = identityColor([letter]);
          return (
            <button
              key={letter}
              type="button"
              aria-pressed={active}
              aria-label={identityLabel([letter])}
              title={identityLabel([letter])}
              onClick={() => toggle(letter)}
              className="pip"
              style={{
                ["--pip-color" as string]: active ? color : "var(--separator)",
                color: active ? color : "var(--muted)",
                opacity: active ? 1 : 0.7,
              }}
            >
              {letter}
            </button>
          );
        })}
      </div>
      {value.length > 0 ? (
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="w-8 h-4 rounded-[4px] border border-(--border)"
            style={{ background: identityGradient(value) }}
          />
          <span className="text-xs text-(--muted) font-mono">{identityLabel(value)}</span>
        </span>
      ) : null}
    </div>
  );
}
