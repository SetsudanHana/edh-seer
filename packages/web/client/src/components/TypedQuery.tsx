import { useId } from "react";
import { QUERY_HELP, type QueryError } from "../lib/search/query.js";

/** THE TYPED QUERY (#1783): the same question the rows ask, in our own words, and the `x=` of the link.
 *  The problem is said under the box, with its character offset, and the page draws no list while one stands. */
export function TypedQuery({ value, onChange, error, names, noun, leftOut = false }: {
  value: string;
  onChange: (next: string) => void;
  error: QueryError | null;
  /** The field names the build accepts, for the legend. */
  names: readonly string[];
  noun: string;
  /** The rows set that the text has no words for. */
  leftOut?: boolean;
}): React.JSX.Element {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <label className="flex flex-col gap-1 min-w-0">
        <span className="eyebrow text-(--muted)">or type a query</span>
        <input
          type="text" value={value} onChange={(e) => onChange(e.target.value)}
          aria-invalid={error !== null} aria-describedby={error ? `${id}-error` : `${id}-help`}
          spellCheck={false} autoCapitalize="off" autoComplete="off" autoCorrect="off"
          placeholder={`e.g. t:creature -st:borg #stBest@creature>=3`}
          className="field min-h-11 font-mono text-sm [font-variant-ligatures:none] placeholder:italic"
        />
      </label>
      {leftOut && (
        <p className="text-(--muted) text-sm">This text leaves out the ability type, how often and amount rows: they have no typed form, and typing here replaces them.</p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-(--danger) text-sm [overflow-wrap:anywhere]">
          {error.cannot
            ? `${error.message.charAt(0).toUpperCase()}${error.message.slice(1)}. No ${noun} are listed.`
            : `Problem: ${error.message}. Fix it to see ${noun}.`}
        </p>
      )}
      <details className="text-sm">
        <summary className="chip cursor-pointer list-none w-fit">Query syntax</summary>
        <div id={`${id}-help`} className="mt-2 flex flex-col gap-2 min-w-0">
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,max-content)_minmax(0,1fr)] list-none p-0 m-0">
            {QUERY_HELP.map((h) => (
              <div key={h.form} className="contents">
                <dt className="font-mono [font-variant-ligatures:none] [overflow-wrap:anywhere]">{h.form}</dt>
                <dd className="m-0 text-(--muted) [overflow-wrap:anywhere]">{h.means}. e.g. <code className="font-mono [font-variant-ligatures:none] text-(--foreground)">{h.example}</code></dd>
              </div>
            ))}
          </dl>
          {names.length > 0 && (
            <p className="text-(--muted) [overflow-wrap:anywhere]">Fields in this build: <span className="font-mono [font-variant-ligatures:none]">{names.join(" ")}</span></p>
          )}
        </div>
      </details>
    </div>
  );
}
