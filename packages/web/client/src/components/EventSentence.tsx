import { useEffect, useMemo, useRef, useState } from "react";
import { unaskableNote } from "../lib/unaskable.js";
import { eventKeyAction, eventKeyClause, eventMatchRank, matchSpans } from "../lib/demand-sentence.js";
import { eventGlyphs, eventGroup, sameTerm, type EventTerm, type TermOp, type TermSide } from "../lib/event-terms.js";
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
 *  THE JOINING WORDS ARE THE CONTROL, AS A MENU (option A, 2026-09-27). Tapping one -- or a term,
 *  so the first term, which has no word before it, can change too -- opens and / or / but not, each
 *  said in a player's words, and remove. Nothing changes until a choice is made. The `or` terms are
 *  drawn inside one outline, so what goes with what is visible with any number of terms.
 *
 *  THE ADD LIST CLOSES AFTER A PICK, so the results are on the first screen again as soon as a
 *  question is asked (UX review: the open list pushed them below the fold). */
/** Rows a group shows before its own "N more": every group appears, however broad the word (owner,
 *  2026-09-27: "graveyard" matched 155 events and a flat cap of 50 hid "Out of the graveyard"). */
const GROUP_ROWS = 6;
/** The three modes, in a player's words. */
const MODES: [TermOp, string, string][] = [
  ["and", "and", "must also do this"],
  ["or", "or", "either this or the other \u201cor\u201d ones"],
  ["not", "but not", "leave out cards that do this"],
];
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
  // THE MODE IS PICKED FROM A MENU (owner, 2026-09-27: option A, after "the UX of switching between
  // the logical modes is atrocious"). Tapping a joining word used to cycle the NEXT term, which then
  // moved to its new place in the sentence, so the next tap landed on a different term. Now nothing
  // changes until a choice is made, and the choices say what they mean.
  const [menu, setMenu] = useState<{ id: string; at: "join" | "term" } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [menu]);
  const idOf = (t: EventTerm) => `${t.side}|${t.key}`;
  const setOp = (t: EventTerm, op: TermOp) => { onChange(terms.map((x) => (sameTerm(x, t) ? { ...x, op } : x))); setMenu(null); };
  const toggleMenu = (t: EventTerm, at: "join" | "term") =>
    setMenu((m) => (m && m.id === idOf(t) && m.at === at ? null : { id: idOf(t), at }));
  const modeMenu = (t: EventTerm) => (
    <div ref={menuRef} role="menu" aria-label={`How "${termWords(t)}" joins the search`}
      className="absolute left-0 top-full z-30 mt-1 w-72 max-w-[85vw] overflow-hidden rounded-(--field-radius) border border-(--field-border) bg-(--field-background) text-sm shadow-lg">
      {MODES.map(([op, word, meaning]) => (
        <button key={op} type="button" role="menuitemradio" aria-checked={t.op === op} onClick={() => setOp(t, op)}
          className={`flex w-full items-baseline gap-3 border-t border-(--separator) first:border-t-0 px-3 py-2.5 text-left hover:bg-(--surface-secondary) ${t.op === op ? "bg-(--surface-secondary)" : ""}`}>
          <b className={`w-16 shrink-0 font-semibold ${t.op === op ? "text-(--accent)" : ""}`}>{word}</b>
          <span className="text-(--muted)">{meaning}</span>
        </button>
      ))}
      <button type="button" role="menuitem" onClick={() => { remove(t); setMenu(null); }}
        className="w-full border-t border-(--separator) px-3 py-2.5 text-left text-(--muted) hover:bg-(--surface-secondary)">remove</button>
    </div>
  );
  const remove = (t: EventTerm) => onChange(terms.filter((x) => !sameTerm(x, t)));
  const add = (key: string, side: TermSide) => {
    if (!terms.some((x) => sameTerm(x, { key, side, op: "and" }))) onChange([...terms, { key, side, op: "and" }]);
    setOpen(false);
    setQuery("");
  };

  // THE LIST: every event either side can be asked about, matched the way a player types
  // (`eventMatches`), ordered by demand as the pickers were, then grouped by what happens.
  const [wideGroups, setWideGroups] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(() => {
    if (!open) return { groups: [], typos: false };
    const needle = query.trim().toLowerCase();
    const makeSet = new Set(makes);
    const paySet = new Set(pays);
    const keys = [...new Set([...makes, ...pays])];
    // SLIPS ONLY WHEN NOTHING ELSE MATCHES: "treasure" is not "creature" while Treasures exist.
    const score = (typos: boolean) => keys
      .map((key) => ({ key, match: needle.length === 0 ? 0 : eventMatchRank(key, needle, typos) }))
      .filter((r): r is { key: string; match: number } => r.match !== null);
    let hits = score(false);
    const typos = hits.length === 0 && needle.length > 0;
    if (typos) hits = score(true);
    const all = hits
      .map((h) => ({ ...h, rank: demand(h.key), made: makeSet.has(h.key), paid: paySet.has(h.key) }))
      // A HIT AT A WORD'S START FIRST, then what players ask for most, as before.
      .sort((a, b) => b.match - a.match || b.rank - a.rank || makesCount(b.key) - makesCount(a.key) || a.key.localeCompare(b.key));
    const groups = new Map<string, { id: string; label: string; glyph?: string; rows: typeof all }>();
    for (const r of all) {
      const g = eventGroup(r.key);
      const at = groups.get(g.id) ?? { id: g.id, label: g.label, ...(g.glyph ? { glyph: g.glyph } : {}), rows: [] };
      at.rows.push(r);
      groups.set(g.id, at);
    }
    return { groups: [...groups.values()], typos };
  }, [open, query, makes, pays, demand, makesCount]);
  const unaskable = open ? unaskableNote(query) : null;
  // THE MATCHED LETTERS IN BOLD (owner, 2026-09-27), so a looser hit shows why it is listed.
  const marked = (text: string) =>
    matchSpans(text, query).map((p, i) => (p.hit ? <b key={i} className="font-semibold text-(--foreground)">{p.text}</b> : <span key={i}>{p.text}</span>));

  const joiner = (t: EventTerm, label: string) => (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu?.id === idOf(t) && menu.at === "join"}
        onClick={() => toggleMenu(t, "join")}
        aria-label={`${label}: change how "${termWords(t)}" joins the search`}
        className="text-(--accent) border-b border-dashed border-(--accent) whitespace-nowrap leading-tight cursor-pointer"
      >
        {label} <span aria-hidden="true" className="text-[0.7em]">▾</span>
      </button>
      {menu?.id === idOf(t) && menu.at === "join" ? modeMenu(t) : null}
    </span>
  );
  const OP_NAME: Record<TermOp, string> = { and: "must", or: "either", not: "never" };
  const term = (t: EventTerm) => (
    <span className="term relative inline-flex items-center gap-1 min-h-11 max-w-full rounded-(--radius) border border-(--field-border) bg-(--surface-secondary) pl-3 pr-0.5">
      {menu?.id === idOf(t) && menu.at === "term" ? modeMenu(t) : null}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu?.id === idOf(t) && menu.at === "term"}
        onClick={() => toggleMenu(t, "term")}
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
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        if (menu) { setMenu(null); e.stopPropagation(); } else if (open) { setOpen(false); e.stopPropagation(); }
      }}>
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
            onChange={(e) => { setQuery(e.target.value); setWideGroups(new Set()); }}
            aria-label="Find an event"
            placeholder="find an event: graveyard, gain life, artifact…"
            className="min-h-11 rounded-(--field-radius) border border-(--accent) bg-(--field-background) px-3"
          />
          <div role="group" aria-label="Events" className="max-h-[28rem] overflow-y-auto overscroll-contain rounded-(--field-radius) border border-(--field-border) bg-(--field-background)">
            {/* SAID EVEN WHEN SOMETHING ELSE MATCHES (#730): "copy" lists copy triggers, and without this
              * a player asking for spell copiers read those as the answer. */}
            {unaskable ? <p className="px-3 py-2 text-sm m-0 border-b border-(--separator)" data-testid="unaskable-note">{unaskable}</p> : null}
            {rows.typos && rows.groups.length > 0 && <p className="px-3 pt-2 text-(--muted) text-xs m-0">Nothing matched exactly; these are close spellings.</p>}
            {rows.groups.map((g) => (
              <section key={g.label} className="px-3 pt-2 pb-1 border-t border-(--separator) first:border-t-0">
                <h3 className="eyebrow text-(--muted) flex items-center gap-2 m-0 py-1">
                  {g.glyph && <i aria-hidden="true" className={`ms ms-${g.glyph} tracking-normal`} />}{g.label}
                </h3>
                <ul className="list-none m-0 p-0">
                  {(wideGroups.has(g.id) ? g.rows : g.rows.slice(0, GROUP_ROWS)).map((r) => (
                    <li key={r.key} className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 gap-y-1 py-1.5 border-t border-(--separator) first:border-t-0">
                      <span className="col-span-2 sm:col-span-1 flex items-center gap-2 text-(--muted)"><Glyphs keyName={r.key} /><span>{marked(eventKeyClause(r.key))}</span></span>
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
                {g.rows.length > GROUP_ROWS && !wideGroups.has(g.id) ? (
                  <button type="button" onClick={() => setWideGroups(new Set([...wideGroups, g.id]))}
                    className="min-h-9 text-sm text-(--muted) hover:text-(--foreground)">
                    {(g.rows.length - GROUP_ROWS).toLocaleString("en-US")} more in {g.label.split(" · ")[0]!.toLowerCase()}
                  </button>
                ) : null}
              </section>
            ))}
            {/* SOME THEMES ARE NOT EVENTS YET (search sweep, 2026-09-27): ramp, extra turns, goad, energy
              * have no event the engine reads, and a bare "no match" read as a typo. */}
            {rows.groups.length === 0 && !unaskable && <p className="px-3 py-2 text-(--muted) text-sm m-0">No event matches that. Some themes, like ramp, extra turns or goad, aren&rsquo;t events the engine reads yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
