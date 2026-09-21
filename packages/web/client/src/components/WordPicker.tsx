import { useId, useMemo, useRef, useState } from "react";
import { useListboxKeys } from "../lib/listbox-keys.js";

/** A TYPEAHEAD OVER ONE VOCABULARY OF WORDS, and the only listbox on this page.
 *
 *  EXTRACTED 2026-09-21 when keywords became a filter: 811 of them, which is the same shape as the
 *  474 subtypes and would have been the THIRD copy of this arrow/enter/escape and
 *  `aria-activedescendant` bookkeeping. The file it came from already said why that is wrong -- "a
 *  second implementation of it is a second place for that to be wrong" -- so it moved rather than
 *  being copied again. `TypeLinePicker` is now a wrapper that knows which table a word came from;
 *  this knows nothing about tables.
 *
 *  THE KEYBOARD MODEL IS THE ONE THE HEADER SEARCH ALREADY HAS, via `useListboxKeys`. */
export function WordPicker(
  { label, placeholder, listLabel, all, chosen, onChange }: {
    label: string;
    placeholder: string;
    /** The listbox's accessible name -- "Types and subtypes", "Keywords". */
    listLabel: string;
    all: string[];
    chosen: string[];
    onChange: (next: string[]) => void;
  },
): React.JSX.Element {
  const [query, setQuery] = useState("");
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  /** PREFIX FIRST, THEN ANYWHERE. Typing "sli" should put Sliver above Basilisk, and a plain
   *  `includes` does not: 28 subtypes contain "sli" and the one that starts with it is what was
   *  meant. Capped at eight because a listbox longer than the viewport is a scroll inside a scroll
   *  on the phone this panel is now one row of. */
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const taken = new Set(chosen);
    const free = all.filter((s) => !taken.has(s));
    const starts = free.filter((s) => s.startsWith(q));
    const contains = free.filter((s) => !s.startsWith(q) && s.includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [all, chosen, query]);

  // DECLARED BEFORE `take` USES IT, and `take` is referenced by the hook -- so the hook's callback
  // reads `options` through the closure rather than taking the name as an argument.
  const { active, setActive, onKey, reset } = useListboxKeys({
    count: options.length,
    onChoose: (i) => { const name = options[i]; if (name) take(name); },
    onClose: () => { setQuery(""); },
  });

  const take = (name: string): void => {
    onChange([...chosen, name]);
    setQuery("");
    reset();
    fieldRef.current?.focus();
  };

  const optId = (i: number): string => `${listId}-o${i}`;
  return (
    <div className="flex flex-col gap-1">
      <label className="eyebrow" htmlFor={`${listId}-field`}>{label}</label>
      {/* THE CHOSEN ONES ARE CHIPS, so removing one is a click rather than a re-typed field, and so
        * the ANSWERED question stays visible while the next is being asked. */}
      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
          {chosen.map((name) => (
            <li key={name}>
              <button
                type="button"
                className="chip capitalize"
                aria-label={`Remove ${name}`}
                onClick={() => onChange(chosen.filter((s) => s !== name))}
              >
                {name}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        <input
          id={`${listId}-field`}
          ref={fieldRef}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          {...(options.length > 0 && active >= 0 ? { "aria-activedescendant": optId(active) } : {})}
          className="field w-52"
          placeholder={placeholder}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
          onKeyDown={onKey}
        />
        {options.length > 0 && (
          <ul id={listId} role="listbox" aria-label={listLabel} className="site-search-list absolute z-20 mt-1 list-none p-0">
            {options.map((name, i) => (
              <li
                key={name}
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                className="site-search-row capitalize"
                // `mousedown` rather than `click`: the field loses focus first otherwise, and the
                // blur closes the list out from under the pointer.
                onMouseDown={(e) => { e.preventDefault(); take(name); }}
                onMouseEnter={() => setActive(i)}
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
