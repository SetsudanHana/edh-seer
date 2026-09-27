import { useMemo, useRef, useState } from "react";
import { eventKeyAction, eventKeyClause, eventMatches } from "../lib/demand-sentence.js";
import { eventGlyphs, eventGroup, nextOp, sameTerm, type EventTerm, type TermOp, type TermSide } from "../lib/event-terms.js";
import { ManaSymbols } from "./ManaSymbols.js";

/** THE SEARCH IS A SENTENCE (owner, 2026-09-27: mockup B, with the mana font).
 *
 *    [● Black] cards that ( [gain life] or [return an artifact from a graveyard] ) but never [make a player lose life] [+ add]
 *
 *  It replaces the two pickers, "Causes" and "Cares about", which asked one question in two boxes
 *  and could only AND. A term says which side it is on in its own words: a card that MAKES an event
 *  happen is named by the action ("gain life"), one that PAYS OFF when it happens by the clause,
 *  under the triggered-ability mark ("⚡ life is gained").
 *
 *  THE JOINING WORDS ARE THE CONTROL. Tapping one moves the term after it on: and → or → not. The
 *  term itself does the same, so the first term, which has no word before it, can move too. The
 *  `or` terms are drawn inside one outline, so what goes with what is visible with any number of
 *  terms -- the reviewer's worry about a long sentence.
 *
 *  THE ADD LIST CLOSES AFTER A PICK, so the results are on the first screen again as soon as a
 *  question is asked (UX review: the open list pushed them below the fold). */
const ROWS = 50;
const COLOUR_WORD: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colourless" };

const Glyphs = ({ keyName }: { keyName: string }) => (
  <>{eventGlyphs(keyName).map((g) => <i key={g} aria-hidden="true" className={`ms ms-${g} text-(--muted)`} />)}</>
);
const Trigger = () => <i aria-hidden="true" className="ms ms-ability-triggered text-(--muted) text-[0.8em]" />;

export const termWords = (t: Pick<EventTerm, "key" | "side">): string =>
  t.side === "makes" ? (eventKeyAction(t.key) ?? eventKeyClause(t.key)) : eventKeyClause(t.key);

export function EventSentence({ terms, colours, noun, makes, pays, makesCount, paysCount, demand, onChange, onRemoveColour, onOpen }: {
  terms: EventTerm[];
  /** Colour identity, drawn as the sentence's first words. */
  colours: string[];
  /** "cards" or "commanders". */
  noun: string;
  /** The keys a card can be asked to make, and to pay off. */
  makes: string[];
  pays: string[];
  makesCount: (key: string) => number;
  paysCount: (key: string) => number;
  /** How many cards ask for the event: the list's order, as it was in the pickers. */
  demand: (key: string) => number;
  onChange: (next: EventTerm[]) => void;
  onRemoveColour: (code: string) => void;
  /** The add list opened: the caller loads the counts then, and not before. */
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);

  const and = terms.filter((t) => t.op === "and");
  const or = terms.filter((t) => t.op === "or");
  const not = terms.filter((t) => t.op === "not");
  const cycle = (t: EventTerm) => onChange(terms.map((x) => (sameTerm(x, t) ? { ...x, op: nextOp(x.op) } : x)));
  const remove = (t: EventTerm) => onChange(terms.filter((x) => !sameTerm(x, t)));
  const add = (key: string, side: TermSide) => {
    if (!terms.some((x) => sameTerm(x, { key, side, op: "and" }))) onChange([...terms, { key, side, op: "and" }]);
    setOpen(false);
    setQuery("");
  };

  // THE LIST: every event either side can be asked about, matched the way a player types
  // (`eventMatches`), ordered by demand as the pickers were, then grouped by what happens.
  const rows = useMemo(() => {
    if (!open) return { groups: [], more: 0 };
    const needle = query.trim().toLowerCase();
    const makeSet = new Set(makes);
    const paySet = new Set(pays);
    const all = [...new Set([...makes, ...pays])]
      .filter((k) => needle.length === 0 || eventMatches(k, needle))
      .map((key) => ({ key, rank: demand(key), made: makeSet.has(key), paid: paySet.has(key) }))
      .sort((a, b) => b.rank - a.rank || makesCount(b.key) - makesCount(a.key) || a.key.localeCompare(b.key));
    const shown = all.slice(0, ROWS);
    const groups = new Map<string, { label: string; glyph?: string; rows: typeof shown }>();
    for (const r of shown) {
      const g = eventGroup(r.key);
      const at = groups.get(g.id) ?? { label: g.label, ...(g.glyph ? { glyph: g.glyph } : {}), rows: [] };
      at.rows.push(r);
      groups.set(g.id, at);
    }
    return { groups: [...groups.values()], more: all.length - shown.length };
  }, [open, query, makes, pays, demand, makesCount]);

  const joiner = (t: EventTerm, label: string) => (
    <button
      type="button"
      onClick={() => cycle(t)}
      aria-label={`${label}: change how "${termWords(t)}" joins the search`}
      className="text-(--accent) border-b border-dashed border-(--accent) whitespace-nowrap leading-tight cursor-pointer"
    >
      {label}
    </button>
  );
  const OP_NAME: Record<TermOp, string> = { and: "must", or: "either", not: "never" };
  const term = (t: EventTerm) => (
    <span className="term inline-flex items-center gap-1 min-h-11 max-w-full rounded-(--radius) border border-(--field-border) bg-(--surface-secondary) pl-3 pr-0.5">
      <button
        type="button"
        onClick={() => cycle(t)}
        aria-label={`${t.side === "makes" ? "makes" : "pays off"}: ${termWords(t)}, ${OP_NAME[t.op]}. Change`}
        className={`inline-flex items-center gap-2 text-left ${t.op === "not" ? "line-through decoration-(--muted)" : ""}`}
      >
        {t.side === "pays" && <Trigger />}
        <Glyphs keyName={t.key} />
        <span>{termWords(t)}</span>
      </button>
      <button type="button" onClick={() => remove(t)} aria-label={`Remove ${termWords(t)}`}
        className="min-h-10 min-w-10 inline-flex items-center justify-center text-(--muted) hover:text-(--foreground)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </span>
  );

  const lead = colours.length === 0 ? `${noun.charAt(0).toUpperCase()}${noun.slice(1)} that` : `${noun} that`;
  return (
    <div className="relative flex flex-col gap-2 w-full" data-testid="event-sentence"
      onKeyDown={(e) => { if (e.key === "Escape" && open) { setOpen(false); e.stopPropagation(); } }}>
      <div role="group" aria-label="Your search" className="flex flex-wrap items-center gap-x-2 gap-y-2 text-lg sm:text-2xl leading-snug">
        {colours.map((c) => (
          <span key={c} className="inline-flex items-center gap-2 min-h-11 rounded-(--radius) border border-(--field-border) bg-(--surface-secondary) pl-3 pr-0.5">
            <span aria-hidden="true" className="text-[0.8em] leading-none"><ManaSymbols cost={`{${c}}`} /></span>
            {COLOUR_WORD[c] ?? c}
            <button type="button" onClick={() => onRemoveColour(c)} aria-label={`Remove ${COLOUR_WORD[c] ?? c}`}
              className="min-h-10 min-w-10 inline-flex items-center justify-center text-(--muted) hover:text-(--foreground)">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          </span>
        ))}
        <span>{lead}</span>
        {and.map((t, i) => <span key={`${t.side}${t.key}`} className="contents">{i > 0 && joiner(t, "and")}{term(t)}</span>)}
        {or.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-2 max-w-full rounded-[calc(var(--radius)*1.5)] border border-(--field-border) p-1.5" data-testid="or-group">
            {or.map((t, i) => (
              <span key={`${t.side}${t.key}`} className="contents">
                {i === 0 ? joiner(t, and.length > 0 ? "and either" : "either") : joiner(t, "or")}
                {term(t)}
              </span>
            ))}
          </span>
        )}
        {not.map((t, i) => (
          <span key={`${t.side}${t.key}`} className="contents">
            {joiner(t, i > 0 ? "or" : and.length + or.length > 0 ? "but never" : "never")}
            {term(t)}
          </span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          onClick={() => { setOpen((o) => !o); onOpen(); setTimeout(() => field.current?.focus(), 0); }}
          className="inline-flex items-center min-h-11 rounded-(--radius) border border-dashed border-(--field-border) px-3 text-(--muted) text-base hover:text-(--foreground)"
        >
          + add
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 w-full max-w-4xl">
          <input
            ref={field}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find an event"
            placeholder="find an event: graveyard, gain life, artifact…"
            className="min-h-11 rounded-(--field-radius) border border-(--accent) bg-(--field-background) px-3"
          />
          <div role="group" aria-label="Events" className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-(--field-radius) border border-(--field-border) bg-(--field-background)">
            {rows.groups.map((g) => (
              <section key={g.label} className="px-3 pt-2 pb-1 border-t border-(--separator) first:border-t-0">
                <h3 className="eyebrow text-(--muted) flex items-center gap-2 m-0 py-1">
                  {g.glyph && <i aria-hidden="true" className={`ms ms-${g.glyph} tracking-normal`} />}{g.label}
                </h3>
                <ul className="list-none m-0 p-0">
                  {g.rows.map((r) => (
                    <li key={r.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 py-1.5 border-t border-(--separator) first:border-t-0">
                      <span className="col-span-2 sm:col-span-1 flex items-center gap-2"><Glyphs keyName={r.key} />{eventKeyClause(r.key)}</span>
                      <button type="button" disabled={!r.made} onClick={() => add(r.key, "makes")}
                        aria-label={`Cards that make it happen: ${eventKeyClause(r.key)}`}
                        className="inline-flex items-center justify-between gap-2 min-h-9 rounded-(--radius) border border-(--field-border) px-2.5 text-sm disabled:opacity-40 hover:border-(--accent)">
                        makes <span className="font-mono tabular-nums text-(--muted)">{r.made ? makesCount(r.key).toLocaleString("en-US") : 0}</span>
                      </button>
                      <button type="button" disabled={!r.paid} onClick={() => add(r.key, "pays")}
                        aria-label={`Cards that pay off: ${eventKeyClause(r.key)}`}
                        className="inline-flex items-center justify-between gap-2 min-h-9 rounded-(--radius) border border-(--field-border) px-2.5 text-sm disabled:opacity-40 hover:border-(--accent)">
                        <span className="inline-flex items-center gap-1.5"><Trigger />pays off</span>
                        <span className="font-mono tabular-nums text-(--muted)">{r.paid ? paysCount(r.key).toLocaleString("en-US") : 0}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            {/* SOME THEMES ARE NOT EVENTS YET (search sweep, 2026-09-27): ramp, extra turns, goad, energy
              * have no event the engine reads, and a bare "no match" read as a typo. */}
            {rows.groups.length === 0 && <p className="px-3 py-2 text-(--muted) text-sm m-0">No event matches that. Some themes, like ramp, extra turns or goad, aren&rsquo;t events the engine reads yet.</p>}
            {rows.more > 0 && <p className="px-3 py-2 text-(--muted) text-sm m-0">{rows.more.toLocaleString("en-US")} more. Type to narrow them.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
