import { useId, useMemo, useRef, useState } from "react";
import { useListboxKeys } from "../lib/listbox-keys.js";

/** FOUR HUNDRED AND EIGHTY-SEVEN WORDS A CARD CAN BE, WHICH IS A FIELD AND NOT A ROW OF CHIPS.
 *
 *  ONE CONTROL OVER TYPES AND SUBTYPES BOTH (owner, 2026-09-21: "why type and subtype is not one
 *  like on scryfall"). They were already one question -- every term in this query ANDs, which is
 *  exactly what `t:` does on Scryfall, and asking a reader to know that Equipment is a subtype
 *  while Artifact is a type is asking them to know our storage layout. Measured over the shipped
 *  artifact: 13 types, 474 subtypes, and NO word in both, so each choice resolves to its own param
 *  with nothing to disambiguate. Only the control merged; `type=` and `subtype=` did not, so every
 *  link shared before today still opens the search it named.
 *
 *  It was thirteen chips and a field until then. The chips cost a whole wrapped row of the panel
 *  to say what this field says in the same breath as the subtype -- and the row was drawn whether
 *  or not anyone wanted to ask about a type.
 *
 *  EVERY SUBTYPE, NOT A TRIBE LIST. Equipment, Saga, Aura, Cave and the basic land types are
 *  subtypes too, and "the tribes people actually search for" is a judgement that would need
 *  defending every time a set shipped. The field costs nothing to make complete.
 *
 *  THE KEYBOARD MODEL IS THE ONE THE HEADER SEARCH ALREADY HAS. `useListboxKeys` carries the
 *  arrow/enter/escape behaviour and the `aria-activedescendant` bookkeeping that a combobox owes a
 *  screen reader; a second implementation of it is a second place for that to be wrong. */
export function TypeLinePicker(
  { types, subtypes, chosenTypes, chosenSubtypes, onChange }: {
    types: string[];
    subtypes: string[];
    chosenTypes: string[];
    chosenSubtypes: string[];
    onChange: (next: { types: string[]; subtypes: string[] }) => void;
  },
): React.JSX.Element {
  const [query, setQuery] = useState("");
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);

  /** THE TABLE A WORD CAME FROM, so choosing it can write the right param. Built from the
   *  vocabulary rather than from a list written down here: a set that introduces a type would
   *  otherwise be filed as a subtype by a reader who cannot see the difference anyway. */
  const isType = useMemo(() => new Set(types), [types]);
  /** TYPES FIRST, because they are the coarser question and the shorter list -- so "creature"
   *  outranks "Crewmate" for a reader who typed "cre" and meant the card type. */
  const all = useMemo(() => [...types, ...subtypes], [types, subtypes]);

  /** PREFIX FIRST, THEN ANYWHERE. Typing "sli" should put Sliver above Basilisk, and a plain
   *  `includes` does not: 28 subtypes contain "sli" and the one that starts with it is what was
   *  meant. Capped at eight because a listbox longer than the viewport is a scroll inside a scroll
   *  on the phone this panel is now one row of. */
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];
    const taken = new Set([...chosenTypes, ...chosenSubtypes]);
    const free = all.filter((s) => !taken.has(s));
    const starts = free.filter((s) => s.startsWith(q));
    const contains = free.filter((s) => !s.startsWith(q) && s.includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [all, chosenTypes, chosenSubtypes, query]);

  // DECLARED BEFORE `take` USES IT, and `take` is referenced by the hook -- so the hook's callback
  // reads `options` through the closure rather than taking the name as an argument.
  const { active, setActive, onKey, reset } = useListboxKeys({
    count: options.length,
    onChoose: (i) => { const name = options[i]; if (name) take(name); },
    onClose: () => { setQuery(""); },
  });

  const take = (name: string): void => {
    onChange(isType.has(name)
      ? { types: [...chosenTypes, name], subtypes: chosenSubtypes }
      : { types: chosenTypes, subtypes: [...chosenSubtypes, name] });
    setQuery("");
    reset();
    fieldRef.current?.focus();
  };

  const drop = (name: string): void => {
    onChange({
      types: chosenTypes.filter((s) => s !== name),
      subtypes: chosenSubtypes.filter((s) => s !== name),
    });
  };

  const optId = (i: number): string => `${listId}-o${i}`;
  return (
    <div className="flex flex-col gap-1">
      <label className="eyebrow" htmlFor={`${listId}-field`}>Type line</label>
      {/* THE CHOSEN ONES ARE CHIPS, so removing one is a click rather than a re-typed field, and so
        * the ANSWERED question stays visible while the next is being asked. Types before subtypes,
        * which is the order a card prints them in. */}
      {chosenTypes.length + chosenSubtypes.length > 0 && (
        <ul className="flex flex-wrap gap-2 list-none p-0 m-0">
          {[...chosenTypes, ...chosenSubtypes].map((name) => (
            <li key={name}>
              <button
                type="button"
                className="chip capitalize"
                aria-label={`Remove ${name}`}
                onClick={() => drop(name)}
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
          placeholder="Instant, Sliver, Equipment…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
          onKeyDown={onKey}
        />
        {options.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Types and subtypes" className="site-search-list absolute z-20 mt-1 list-none p-0">
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
