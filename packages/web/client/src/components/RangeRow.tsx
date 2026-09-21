import { useId } from "react";

/** A NUMBER RANGE, BOTH ENDS OPTIONAL (owner, 2026-09-21: "the mana value should support like
 *  'operator' or something cause not everyone looks for just X or less").
 *
 *  A RANGE RATHER THAN AN OPERATOR AND A NUMBER, which was the other shape on the table: "exactly
 *  3" is 3 to 3, "3 or less" is any to 3, "3 or more" is 3 to any, and a genuine span -- the two
 *  and three drops a deck actually wants -- is the one question an operator cannot ask at all.
 *
 *  ONE CONTROL, THREE ROWS. Mana value, power and toughness are the same question about different
 *  numbers, so they are the same control with a different label. */
export function RangeRow(
  { label, min, max, ceiling = 15, onChange }: {
    label: string;
    min: number | undefined;
    max: number | undefined;
    /** Highest offered bound. 15 covers Emrakul and every printed power; a reader wanting more
     *  than fifteen mana is asking about a handful of cards they can already name. */
    ceiling?: number;
    onChange: (next: { min: number | undefined; max: number | undefined }) => void;
  },
): React.JSX.Element {
  const id = useId();
  const numbers = Array.from({ length: ceiling + 1 }, (_, n) => n);
  // A BOUND OF ZERO IS REAL, so "" is the only thing that means "no bound" and the value is never
  // tested for truthiness: "power 0 to 0" asks for the Ornithopters.
  const read = (raw: string): number | undefined => (raw === "" ? undefined : Number(raw));
  const show = (v: number | undefined): string => (v === undefined ? "" : String(v));

  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow" id={`${id}-label`}>{label}</span>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby={`${id}-label`}>
        <label className="flex items-center gap-2">
          <span className="text-(--muted) text-sm">from</span>
          <select
            className="field w-24"
            aria-label={`${label}, from`}
            value={show(min)}
            onChange={(e) => onChange({ min: read(e.target.value), max })}
          >
            <option value="">any</option>
            {numbers.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-(--muted) text-sm">to</span>
          <select
            className="field w-24"
            aria-label={`${label}, to`}
            value={show(max)}
            onChange={(e) => onChange({ min, max: read(e.target.value) })}
          >
            <option value="">any</option>
            {numbers.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      {/* AN IMPOSSIBLE RANGE SAYS SO. Left alone it answers "No card matches", which is true and
        * useless -- the reader reads it as "there are none" rather than as "you asked backwards".
        * Not an error state: nothing is broken, and the list below is still a correct answer. */}
      {min !== undefined && max !== undefined && min > max && (
        <p className="text-(--muted) text-sm">
          From {min} to {max} is backwards, so nothing can match. Swap the two.
        </p>
      )}
    </div>
  );
}
