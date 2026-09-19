import { useMemo, useRef, useState } from "react";
import { eventKeySentence } from "../lib/demand-sentence.js";
import { useListboxKeys } from "../lib/listbox-keys.js";

/** ONE QUESTION, MANY EVENTS (spec 2026-09-19, roadmap AJ3).
 *
 *  A combobox whose chosen values sit in the field as removable chips, per the ARIA
 *  combobox-with-listbox pattern -- through the same hook `HeaderSearch` uses, so there is one
 *  keyboard contract on this site rather than two that agree today.
 *
 *  THE ROWS READ AS THE CARD PAGES READ. `eventKeySentence` is what a partner group prints, so a
 *  reader who arrived by clicking "389 other cards cause it too" meets that same sentence here
 *  instead of a second phrasing invented for this control.
 *
 *  ONLY `ROWS` ARE RENDERED. There are 1,187 keys; a listbox of all of them is a frame nobody gets
 *  back, and the search box is how a reader reaches the one they want. The line under the list
 *  says how many are not shown, so the cap withholds rows and not the answer -- the same rule the
 *  result list's own cap follows. */
const ROWS = 50;

export function EventPicker({ label, hint, options, chosen, counts, demand, onChange }: {
  label: string;
  /** What this question means, in one line under the label. */
  hint: string;
  options: string[];
  chosen: string[];
  /** The count a row prints -- scoped to the reader's colours by the caller, never a corpus
   *  figure over an identity-filtered list (the defect AJ5 was opened for). */
  counts: (key: string) => number;
  /** THE SIZE OF THE OTHER SIDE, which is what orders the list. See `rows` below. */
  demand: (key: string) => number;
  onChange: (next: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const id = `events-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  const listId = `${id}-listbox`;
  const optId = (i: number): string => `${id}-opt-${i}`;

  // THE ORDER IS THE OTHER SIDE'S SIZE, NOT THIS ONE'S (measured 2026-09-19).
  //
  // Ordering the causes by how many cards CAUSE them opened this control on nine near-identical
  // rows -- every one a static reaching 20,032 to 24,982 cards, which is the whole corpus -- while
  // "a creature dies" sat below the fold. An event nearly every card can cause is the worst filter
  // on the list, and the engine already says so in its own scoring: specificity is 1/log(count+1).
  //
  // What a reader wants first is an event the deck is WAITING for, so a cause ranks by how many
  // cards ask for it (418 ask for a creature dying, 539 for a creature to sacrifice), and an ask
  // ranks by how many cards can pay it. Both numbers ship in `event-frequency.json`; neither is a
  // threshold anyone had to invent.
  const all = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return options
      .map((key) => ({ key, sentence: eventKeySentence(key), count: counts(key), rank: demand(key) }))
      .filter((r) => needle.length === 0 || r.sentence.toLowerCase().includes(needle))
      .sort((a, b) => b.rank - a.rank || b.count - a.count || a.sentence.localeCompare(b.sentence, "en"));
  }, [options, counts, demand, query]);
  const rows = all.slice(0, ROWS);

  const toggle = (key: string) => {
    onChange(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);
    setQuery("");
    field.current?.focus();
  };
  const { active, setActive, onKey, reset } = useListboxKeys({
    count: rows.length,
    onChoose: (i) => { const row = rows[i]; if (row) toggle(row.key); },
    onClose: () => setOpen(false),
  });

  return (
    // THE CONTROL IS THE WIDTH OF A FIELD, not the width of the page. At 1920 the box spanned
    // 1,856px beside a `max-w-lg` search field above it and read as a broken input; a listbox that
    // wide also puts its count 1,800px from its sentence, which is two separate things to read.
    //
    // AND THE LIST CLOSES WHEN FOCUS LEAVES IT (owner-reported 2026-09-19, on the deployed site).
    // `open` was set on focus and cleared only by Escape, so both pickers stayed open at once and
    // pushed the results off the page. The check is containment, not a bare blur: focus moving
    // from the field to a chip's remove button is still inside this control.
    <div
      className="flex flex-col gap-2 w-full max-w-2xl"
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <p className="eyebrow text-(--muted)" id={`${id}-label`}>{label}</p>
      <p className="text-(--muted) text-sm">{hint}</p>
      {/* THE CHIPS LIVE IN THE FIELD, so what is chosen and where to choose more are one control
        * rather than a list of chips floating above an unrelated box. */}
      <div className="flex flex-wrap items-center gap-2 rounded-(--field-radius) border border-(--field-border) bg-(--field-background) p-2">
        {chosen.map((key) => (
          <span key={key} className="chip">
            {eventKeySentence(key)}
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-label={`Remove ${eventKeySentence(key)}`}
              className="min-h-11 min-w-11 inline-flex items-center justify-center"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </span>
        ))}
        <input
          ref={field}
          type="text"
          value={query}
          role="combobox"
          aria-labelledby={`${id}-label`}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          {...(open && active >= 0 ? { "aria-activedescendant": optId(active) } : {})}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); reset(); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder="find an event"
          className="min-h-11 flex-1 min-inline-size-0 bg-transparent px-2"
        />
      </div>
      {open && (
        <ul
          id={listId} role="listbox" aria-labelledby={`${id}-label`}
          // AN OPTION IS NOT FOCUSABLE, so pressing the mouse on one would blur the field and close
          // the list before the click could land -- the row would simply never be chosen. Holding
          // focus in the field is what lets the blur rule above be this simple.
          onMouseDown={(e) => e.preventDefault()}
          className="flex flex-col m-0 p-0 list-none max-h-96 overflow-y-auto"
        >
          {rows.map((row, i) => {
            const on = chosen.includes(row.key);
            return (
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events
              <li
                key={row.key}
                id={optId(i)}
                role="option"
                aria-selected={on}
                onMouseEnter={() => setActive(i)}
                onClick={() => toggle(row.key)}
                // THE ACTIVE ROW READS AS THE HEADER SEARCH'S DOES (`index.css:1045`,
                // `.site-search-row[aria-selected]`): same surface, same accent, so two comboboxes
                // on one site do not signal the same state two ways.
                className={`min-h-11 flex items-center justify-between gap-3 px-2 py-1 cursor-pointer ${i === active ? "bg-(--surface-secondary) text-(--accent)" : ""}`}
              >
                <span className="flex items-baseline gap-2">
                  {/* A TICK, NOT A CHARACTER. lucide `check`, `currentColor`, and it keeps its box
                    * when unselected so the rows do not shift as a reader picks one. */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={on ? "shrink-0" : "shrink-0 invisible"}>
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  <span>{row.sentence}</span>
                </span>
                <span className="font-mono tabular-nums text-(--muted) shrink-0">{row.count.toLocaleString("en-US")}</span>
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-2 py-2 text-(--muted) text-sm">No event matches that.</li>}
          {all.length > rows.length && (
            <li className="px-2 py-2 text-(--muted) text-sm">
              {(all.length - rows.length).toLocaleString("en-US")} more. Type to narrow them.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
