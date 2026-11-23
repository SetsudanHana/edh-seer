import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
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
type Mode = "and" | "any" | "not";
/** The word each mode wears on its chip. "never" for `not`, said in words so strike-through is never the only carrier. */
const MODE_WORD: Record<Mode, string> = { and: "must", any: "any of", not: "never" };

/** lucide chevron-down: the mark that says a part of the chip opens something. */
const Chevron = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const Cross = (): React.JSX.Element => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export function WordPicker(
  { label, description, placeholder, listLabel, all, chosen, onChange, negated = [], onMove, onRemoveNegated, anyOf, onRemoveAny, labelOf, optionText, browse = false, plain = false }: {
    label: string;
    /** One plain-language line under the label: what the field says. */
    description?: string;
    placeholder: string;
    /** The listbox's accessible name -- "Types and subtypes", "Keywords". */
    listLabel: string;
    all: string[];
    chosen: string[];
    onChange: (next: string[]) => void;
    /** WORDS THE CARD MUST NOT HAVE (#1782), drawn struck through. Only with `onMove`, which is what makes a chip
     *  a must/never control: moves a word between the two lists in one call, so one click is one URL write. */
    negated?: string[];
    /** ANY OF (#1782): words forming one OR group, drawn "any of X". Given together with `onMove`, every chip offers
     *  the two states it is not in (must, any of, never), so a word reaches any state in one click. */
    anyOf?: string[];
    onMove?: (name: string, to: "and" | "not" | "any") => void;
    onRemoveNegated?: (name: string) => void;
    onRemoveAny?: (name: string) => void;
    /** The words a reader sees for a value (a catalogue value label); the value itself is what `onChange` carries. */
    labelOf?: (value: string) => string;
    /** What a listbox row says, beside the label (a count). */
    optionText?: (value: string) => string;
    /** A short list: an empty, focused field offers every free value rather than waiting for a letter. */
    browse?: boolean;
    /** Values are not words to capitalise ("read by our rules", "gain-life"). */
    plain?: boolean;
  },
): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const say = (v: string): string => labelOf?.(v) ?? v;
  const caps = plain ? "" : " capitalize";
  const anyChosen = anyOf ?? [];
  const listId = useId();
  const fieldRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLUListElement>(null);
  // WHICH CHIP'S MODE MENU IS OPEN, and where focus goes once the new mode has re-drawn the chip (a chip moving between
  // modes is a different list entry, so the node the reader was on may be gone).
  const [modeOpen, setModeOpen] = useState<string | null>(null);
  const [refocus, setRefocus] = useState<{ name: string; sig: string } | null>(null);
  const sig = `${chosen.join("\u0000")}|${anyChosen.join("\u0000")}|${negated.join("\u0000")}`;
  const modeButton = (name: string): HTMLElement | undefined =>
    [...(chipsRef.current?.querySelectorAll<HTMLElement>("[data-mode-for]") ?? [])].find((b) => b.dataset["modeFor"] === name);
  useEffect(() => {
    if (refocus === null || refocus.sig === sig) return;
    modeButton(refocus.name)?.focus();
    setRefocus(null);
  }, [refocus, sig]);

  /** PREFIX FIRST, THEN ANYWHERE. Typing "sli" should put Sliver above Basilisk, and a plain
   *  `includes` does not: 28 subtypes contain "sli" and the one that starts with it is what was
   *  meant. Capped at eight because a listbox longer than the viewport is a scroll inside a scroll
   *  on the phone this panel is now one row of. */
  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const taken = new Set([...chosen, ...negated, ...anyChosen]);
    const free = all.filter((s) => !taken.has(s));
    if (q.length === 0) return browse && focused ? free : [];
    // A value is found by what it says, and by what it is called when the two differ.
    const starts = free.filter((s) => s.startsWith(q) || say(s).toLowerCase().startsWith(q));
    const contains = free.filter((s) => !starts.includes(s) && (s.includes(q) || say(s).toLowerCase().includes(q)));
    return [...starts, ...contains].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, chosen, negated, anyOf, query, browse, focused, labelOf]);

  // DECLARED BEFORE `take` USES IT, and `take` is referenced by the hook -- so the hook's callback
  // reads `options` through the closure rather than taking the name as an argument.
  const { active, setActive, onKey, reset } = useListboxKeys({
    count: options.length,
    onChoose: (i) => { const name = options[i]; if (name) take(name); },
    onClose: () => { setQuery(""); setFocused(false); },
  });

  const take = (name: string): void => {
    onChange([...chosen, name]);
    setQuery("");
    setFocused(false);
    reset();
    fieldRef.current?.focus();
  };

  const optId = (i: number): string => `${listId}-o${i}`;
  return (
    <div className="flex flex-col gap-1">
      <label className="eyebrow" htmlFor={`${listId}-field`}>{label}</label>
      {description && <p className="text-(--muted) text-sm max-w-[65ch]">{description}</p>}
      {/* THE CHOSEN ONES ARE CHIPS, so removing one is a click rather than a re-typed field, and so
        * the ANSWERED question stays visible while the next is being asked. */}
      {(chosen.length > 0 || negated.length > 0 || anyChosen.length > 0) && (
        <ul ref={chipsRef} className="flex flex-wrap gap-2 list-none p-0 m-0">
          {/* WITHOUT A MODE CONTROL a chosen word is the one-button chip it always was. */}
          {!onMove && chosen.map((name) => (
            <li key={name} className="flex items-center gap-1">
              <button
                type="button"
                className={`chip${caps}`}
                aria-label={`Remove ${say(name)}`}
                onClick={() => onChange(chosen.filter((s) => s !== name))}
              >
                {say(name)}
                <Cross />
              </button>
            </li>
          ))}
          {/* ONE CHIP, THREE PARTS (owner review of #1782): the mode leads and says itself, the word follows, the cross
            * removes. Separate sibling buttons read as loose chips and wrapped apart on a phone. */}
          {onMove && ([
            ...chosen.map((name) => [name, "and"] as const),
            ...anyChosen.map((name) => [name, "any"] as const),
            ...negated.map((name) => [name, "not"] as const),
          ]).map(([name, mode], at, items) => {
            const word = MODE_WORD[mode];
            const open = modeOpen === name;
            const close = (): void => { setModeOpen(null); modeButton(name)?.focus(); };
            const modes = (["and", ...(anyOf !== undefined ? ["any" as const] : []), "not"] as Mode[]);
            return (
              <Fragment key={name}>
              {/* THE OR BETWEEN ANY-OF CHIPS, plain text: "any of Elf or any of Human" is one group, not two questions. */}
              {mode === "any" && items[at - 1]?.[1] === "any" && <li className="self-center text-sm text-(--muted)">or</li>}
              <li className="relative" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}>
                <div role="group" aria-label={say(name)} className="inline-flex items-stretch overflow-hidden rounded-(--radius) border border-(--separator) divide-x divide-(--separator)">
                  <button
                    type="button"
                    className="chip border-0 rounded-none bg-(--surface-secondary) text-(--foreground)"
                    data-mode-for={name}
                    aria-label={`${say(name)}: ${word}. Change mode`}
                    aria-haspopup="true"
                    aria-expanded={open}
                    onClick={() => setModeOpen(open ? null : name)}
                  >
                    {word}
                    <Chevron />
                  </button>
                  {/* NEVER KEEPS ITS STRIKE-THROUGH AND ITS WORD, which sits on the mode button beside it. */}
                  <span className={`flex items-center px-2 text-sm text-(--foreground) [overflow-wrap:anywhere]${caps}${mode === "not" ? " line-through decoration-(--muted)" : ""}`}>
                    {say(name)}
                  </span>
                  <button
                    type="button"
                    className="chip border-0 rounded-none"
                    aria-label={mode === "and" ? `Remove ${say(name)}` : mode === "any" ? `Remove any of ${say(name)}` : `Remove never ${say(name)}`}
                    onClick={() => (mode === "and" ? onChange(chosen.filter((s) => s !== name)) : mode === "any" ? onRemoveAny?.(name) : onRemoveNegated?.(name))}
                  >
                    <Cross />
                  </button>
                </div>
                {open && (
                  <ul role="group" aria-label={`Mode for ${say(name)}`} className="site-search-list mt-1 list-none p-0 w-fit">
                    {modes.map((m) => (
                      <li key={m}>
                        <button
                          type="button"
                          className="site-search-row w-full text-left"
                          aria-pressed={m === mode}
                          aria-label={`Set ${say(name)} to ${MODE_WORD[m]}`}
                          onClick={() => {
                            if (m === mode) { close(); return; }
                            setModeOpen(null);
                            setRefocus({ name, sig });
                            onMove(name, m);
                          }}
                        >
                          {MODE_WORD[m]}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
              </Fragment>
            );
          })}
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
          onFocus={() => setFocused(true)}
          onClick={() => setFocused(true)}
          onBlur={() => setFocused(false)}
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
                className={`site-search-row${caps}`}
                // `mousedown` rather than `click`: the field loses focus first otherwise, and the
                // blur closes the list out from under the pointer.
                onMouseDown={(e) => { e.preventDefault(); take(name); }}
                onMouseEnter={() => setActive(i)}
              >
                {optionText?.(name) ?? name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
