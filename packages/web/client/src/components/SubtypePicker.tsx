import { useId, useMemo, useRef, useState } from "react";
import { useListboxKeys } from "../lib/listbox-keys.js";

/** FOUR HUNDRED AND EIGHTY-EIGHT SUBTYPES, WHICH IS A FIELD AND NOT A ROW OF CHIPS.
 *
 *  Asked for by the owner twice (2026-09-21): Slivers, and before that the same question about a
 *  tribe the facet vocabulary could not express. The deck-build run is the measured case -- Inalla's
 *  whole deck is a creature type, and with nothing to ask for one the agent abused "provides a
 *  Wizard to sacrifice" as a proxy and accepted the non-Wizards it drags in.
 *
 *  EVERY SUBTYPE, NOT A TRIBE LIST. Equipment, Saga, Aura, Cave and the basic land types are
 *  subtypes too, and "the tribes people actually search for" is a judgement that would need
 *  defending every time a set shipped. The field costs nothing to make complete.
 *
 *  THE KEYBOARD MODEL IS THE ONE THE HEADER SEARCH ALREADY HAS. `useListboxKeys` carries the
 *  arrow/enter/escape behaviour and the `aria-activedescendant` bookkeeping that a combobox owes a
 *  screen reader; a second implementation of it is a second place for that to be wrong. */
export function SubtypePicker(
  { all, chosen, onChange }: { all: string[]; chosen: string[]; onChange: (next: string[]) => void },
): React.JSX.Element {
  const [query, setQuery] = useState("");
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  /** PREFIX FIRST, THEN ANYWHERE. Typing "sli" should put Sliver above Basilisk, and a plain
   *  `includes` does not: 28 subtypes contain "sli" and the one that starts with it is what was
   *  meant. Capped at eight because a listbox longer than the viewport is a scroll inside a scroll
   *  on the phone this page already folds for. */
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const free = all.filter((s) => !chosen.includes(s));
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
      <label className="eyebrow" htmlFor={`${listId}-field`}>Subtype</label>
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
          placeholder="Sliver, Equipment, Saga…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
          onKeyDown={onKey}
        />
        {options.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Subtypes" className="site-search-list absolute z-20 mt-1 list-none p-0">
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
