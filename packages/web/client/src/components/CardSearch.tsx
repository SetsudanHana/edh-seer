import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useSearchParams } from "react-router";
import { identityKeyOf, identityMask, inIdentityOf } from "@edh-seer/matcher/partners-core";
import { matchNames, needleOf } from "../lib/name-match.js";
import { sharedEventFrequency, sharedEventMembers, sharedNameIndex, sharedNameIndexVocabulary, type EventFrequencyFile, type EventMembers, type NameIndexEntry } from "../lib/partners.js";
import { compileCharacteristics, coloursFit, eventsFromParams, eventsToParams, filterKindsOf, intersect, withoutFilterKind, FILTER_KINDS, type EventQuery, type FilterKind } from "../lib/facets.js";
import { eventKeyAction, eventKeyClause } from "../lib/demand-sentence.js";
import { EventPicker } from "./EventPicker.js";
import { CardTile } from "./CardTile.js";
import { TypeLinePicker } from "./TypeLinePicker.js";
import { LegacyDeckRedirect } from "./LegacyDeckRedirect.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { PageFoot } from "./PageFoot.js";
import { CardPeek } from "./CardPeek.js";
import { PeekContext, usePeekState } from "./peek.js";
import type { CardPageData } from "../lib/partners.js";

/** WHAT THIS PAGE CAN ANSWER, AS THREE QUESTIONS A READER CAN CLICK (owner, 2026-09-17: the landing
 *  was a wall of chips and a count). Asked in the engine's own events since AJ3, so the empty state
 *  shows the shape of a question rather than a vocabulary that no longer exists. The keys are real
 *  and were checked against the built artifact; an invented one would render an empty page. */
const EXAMPLES: Record<"cards" | "commanders", { label: string; q: EventQuery }[]> = {
  cards: [
    { label: "mills a card, in blue", q: { produce: ["mill|-|-|-"], consume: [], colours: ["U"], types: [], subtypes: [] } },
    { label: "makes a creature token", q: { produce: ["create-token|creature|-|t"], consume: [], colours: [], types: [], subtypes: [] } },
    { label: "wants a creature to die", q: { produce: [], consume: ["dies|creature|-|-"], colours: [], types: [], subtypes: [] } },
  ],
  commanders: [
    { label: "wants a creature to die", q: { produce: [], consume: ["dies|creature|-|-"], colours: [], types: [], subtypes: [] } },
    { label: "wants a counter added", q: { produce: [], consume: ["counter-added|creature|-|-"], colours: [], types: [], subtypes: [] } },
    { label: "wants a land to enter, in green", q: { produce: [], consume: ["enters|land|-|-"], colours: ["G"], types: [], subtypes: [] } },
  ],
};

/** HOW MANY ROWS ONE QUERY MAY DRAW. A readability choice and a jank one at once: "a" matches most
 *  of the corpus, and 15,350 links is a page nobody scrolls and a frame nobody gets back. The count
 *  above the list says what was found, so the cap withholds rows and not the answer. */
export const SEARCH_LIMIT = 50;

/** THE CARD SEARCH, and the landing point for a share link copied before the surfaces moved.
 *
 *  `/cards` used to BE the report's card list. A share link is `path + #deck=<payload>` and the
 *  hash never reaches the server, so no Cloudflare rule can tell such a link from someone who typed
 *  `/cards` -- `LegacyDeckRedirect` makes that call in the client, and is a no-op without `#deck=`.
 *
 *  THE INDEX IS ONE FILE, 1.39 MB and 320 KB over the wire (measured 2026-09-04, 15,350 cards). It
 *  is fetched once and read from the Cache API afterwards, under the version directory, so a second
 *  visit pays nothing.
 *  CEILING: at three times the corpus this stops being a reasonable download. Upgrade path: shard
 *  the index by first slug character, the way the card and partner artifacts already shard. */
/** THE FIVE COLOURS, IN WUBRG ORDER, which is the order every Magic interface prints them in and
 *  the order a player reads without thinking about it. */
const COLOURS: [code: string, label: string][] = [
  ["W", "White"], ["U", "Blue"], ["B", "Black"], ["R", "Red"], ["G", "Green"],
  // COLOURLESS IS A REAL IDENTITY AND WAS UNREACHABLE (owner-reported 2026-09-04). 13 of the 2,428
  // commanders have an empty identity -- Ulamog, Kozilek, Emrakul, Galactus -- and no combination of
  // the five colours could ask for them. `C` narrows to exactly them, and is EXCLUSIVE of the five:
  // every identity already contains the colourless cards, so "Red and colourless" is either a
  // redundant question or an empty one. Ticking a colour unticks it, and it unticks every colour.
  ["C", "Colourless"],
];

/** WHAT EACH ROW CALLS ITSELF IN THE MENU. British spelling, and the two event rows keep the words
 *  the card pages print -- a reader who clicked through from a partner group meets the same two. */
const FILTER_LABEL: Record<FilterKind, string> = {
  colours: "Colour identity",
  typeline: "Type line",
  mv: "Mana value",
  produce: "Causes",
  consume: "Asks for",
};

export function CardSearch({
  load = sharedNameIndex, frequency = sharedEventFrequency, members = sharedEventMembers,
  vocabulary: loadVocabulary = sharedNameIndexVocabulary,
  peekLoad, hash, replace, mode = "cards",
}: {
  load?: (baseUrl: string) => Promise<NameIndexEntry[]>;
  /** The type and subtype tables the rows' codes index into. */
  vocabulary?: (baseUrl: string) => Promise<{ types: string[]; subtypes: string[] }>;
  /** The counts every picker row prints, asked for on the first search interaction only. */
  frequency?: (baseUrl: string) => Promise<EventFrequencyFile>;
  /** One event's cards, one fetch per event the reader actually picked. */
  members?: (baseUrl: string, key: string) => Promise<EventMembers | null>;
  /** The peek's own loader; tests pass one, the page reads the shard. */
  peekLoad?: (slug: string) => Promise<CardPageData | null>;
  hash?: string;
  replace?: (url: string) => void;
  /** ONE COMPONENT, TWO ROUTES. The commander list is the same index, the same box and the same cap
   *  with three differences -- it keeps only the 2,423 cards that can lead a deck, it links to
   *  `/commanders/:slug`, and it offers colour-identity facets. A second component would have been
   *  forty lines of copy that drift apart the first time one of them is fixed. */
  mode?: "cards" | "commanders";
}) {
  const commanderMode = mode === "commanders";
  // THE RESULT LIST PEEKS (owner 2026-09-08): a click on a result used to leave the filtered list
  // and Back rebuilt it. Same stack, same panel, same click rule as the card pages.
  const peek = usePeekState();
  const [index, setIndex] = useState<NameIndexEntry[] | null>(null);
  // EMPTY UNTIL IT LOADS, AND EMPTY IS SAFE: `characteristicsFit` fails a chosen type it has no
  // code for, so a filter chosen before the tables arrive keeps the list empty rather than showing
  // cards that do not answer it. The chips cannot be chosen before they are drawn from the tables.
  const [vocabulary, setVocabulary] = useState<{ types: string[]; subtypes: string[] }>({ types: [], subtypes: [] });
  // THE QUERY LIVES IN THE URL, so a search is a link. `/cards/krenko-mob` is a slug nobody minted;
  // its page cannot guess what was meant, but it CAN hand the reader here with what they typed
  // already in the box -- which is the whole recovery from a truncated or misremembered name.
  // Shareable for free, and `replace` keeps a keystroke out of the back button.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  // THE NAME FILTER USED TO ERASE EVERY OTHER PARAM. `setParams({ q: next })` replaced the whole
  // query string, so typing a name after picking an event silently dropped the event -- harmless
  // while the only other params were chips a reader could see, a real loss now. Merge instead.
  const setQuery = (next: string) => {
    const out = new URLSearchParams(params);
    if (next) out.set("q", next); else out.delete("q");
    setParams(out, { replace: true });
  };
  // THE QUESTION LIVES IN THE URL (spec 2026-09-19), so a result set is a link and the back button
  // is honest -- the same rule the colour chips have followed since they moved out of local state.
  const eventQuery = useMemo(() => eventsFromParams(params), [params]);
  const setEvents = (next: EventQuery) => setParams(eventsToParams(next, params), { replace: true });
  const colours = eventQuery.colours;
  const setColours = (f: (cs: string[]) => string[]) => setEvents({ ...eventQuery, colours: f(colours) });
  const chosenKeys = useMemo(() => [...eventQuery.produce, ...eventQuery.consume], [eventQuery]);
  // THE ROWS THE URL IS ASKING FOR, plus the ones added and not yet filled. `pending` is the only
  // part that is local state, and it has to be: a row a reader just created has nothing in the URL
  // to be read back out of, and writing an empty param to hold its place would put a question in
  // the link that nobody asked.
  const [pending, setPending] = useState<FilterKind[]>([]);
  const askedKinds = useMemo(() => filterKindsOf(eventQuery), [eventQuery]);
  // A ROW OUTLIVES ITS OWN VALUE. Emptying one must not unmount it: untick the only colour to swap
  // Red for Blue and the control the reader is operating would disappear under them (WCAG 3.2.2),
  // and the same for a select put back to "any" or the last event deselected on a shared link.
  // Once a kind has been shown it stays until the remove button takes it, which is the only thing
  // that should. Recording the URL's kinds here rather than filtering them in below is what makes
  // that true for a row that arrived from a link and was never added from the menu.
  useEffect(() => {
    setPending((ks) => (askedKinds.every((k) => ks.includes(k)) ? ks : [...new Set([...ks, ...askedKinds])]));
  }, [askedKinds]);
  const shownKinds = FILTER_KINDS.filter((k) => askedKinds.includes(k) || pending.includes(k));
  const available = FILTER_KINDS.filter((k) => !shownKinds.includes(k));
  const [menuOpen, setMenuOpen] = useState(false);
  // REMOVING A ROW CLEARS ITS QUESTION AND FORGETS THE ROW. Doing only the first would leave an
  // empty control standing where a reader had just said they were finished with it.
  const dropKind = (kind: FilterKind): void => {
    setEvents(withoutFilterKind(eventQuery, kind));
    setPending((ks) => ks.filter((k) => k !== kind));
  };
  useEffect(() => {
    let live = true;
    void load("/static").then((i) => { if (live) setIndex(i); });
    void loadVocabulary("/static").then((v) => { if (live) setVocabulary(v); });
    return () => { live = false; };
  }, [load]);

  // THE COUNTS ARE READ ON THE FIRST SEARCH INTERACTION, never on page load: a reader who lands on
  // `/cards` and types a name pays for the name index and nothing else.
  const [freq, setFreq] = useState<EventFrequencyFile | null>(null);
  // ADDING THE ROW IS THE INTERACTION, which is a tighter rule than the focus handler this
  // replaces: nothing is fetched for a reader who never asks about an event, and the fetch starts
  // the moment one is asked for rather than when the control happens to take focus.
  const needsFreq = shownKinds.includes("produce") || shownKinds.includes("consume") || chosenKeys.length > 0;
  useEffect(() => {
    if (!needsFreq || freq !== null) return;
    let live = true;
    void frequency("/static").then((f) => { if (live) setFreq(f); });
    return () => { live = false; };
  }, [needsFreq, freq, frequency]);

  // ONE FETCH PER CHOSEN EVENT. Nothing is read for an event nobody picked, and the shared loader
  // means the two pickers and the list ask for a key once between them.
  const [lists, setLists] = useState<ReadonlyMap<string, EventMembers | null>>(new Map());
  const keySignature = chosenKeys.join("\u0000");
  useEffect(() => {
    if (chosenKeys.length === 0) { setLists(new Map()); return; }
    let live = true;
    void Promise.all(chosenKeys.map(async (k) => [k, await members("/static", k)] as const))
      .then((pairs) => { if (live) setLists(new Map(pairs)); });
    return () => { live = false; };
    // `keySignature` is the dependency, not the array: a new array of the same keys must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keySignature, members]);

  // MATCHED THE WAY THE URL IS BUILT. `slugOf` folds diacritics and drops apostrophes, so "jotun"
  // finds `Jötun Grunt` and "ajanis" finds `Ajani's Chosen` -- and finds them under the spelling the
  // link will use. Reusing the build's own function is also what keeps the two from drifting.
  const needle = needleOf(query);
  // A FACET IS A COMPLETE QUESTION ON ITS OWN. "Show me red commanders" needs no text, so the
  // empty-query gate lifts as soon as one is chosen -- browsing by colour is what this page is for.
  // WHETHER THE READER HAS ASKED ANYTHING AT ALL, and the three new dimensions belong in it.
  // `?subtype=sliver` on its own rendered an EMPTY page with no count until they did -- the filter
  // applied and the list was never drawn, which reads as "no Slivers" rather than as "nothing
  // asked". Found by opening the URL rather than by a test, because every test set a colour too.
  //
  // `sort` IS DELIBERATELY NOT HERE: an order is not a question, and sorting an unasked list would
  // draw the whole corpus because someone chose "A to Z".
  const asked = needle.length > 0 || colours.length > 0 || chosenKeys.length > 0
    || eventQuery.types.length > 0 || eventQuery.subtypes.length > 0 || eventQuery.maxMv !== undefined;

  // THE SET THE EVENTS DESCRIBE. `null` means no event was asked (the whole index is the base);
  // `undefined` means the answer is not knowable yet -- still reading, or a shard that did not
  // carry the key. A MISSING LIST IS NOT AN EMPTY ONE: rendering an empty set would claim that no
  // card causes the event, which is a claim, and this engine says nothing rather than guessing.
  const keptIds = useMemo((): Set<number> | null | undefined => {
    if (chosenKeys.length === 0) return null;
    if (chosenKeys.some((k) => !lists.has(k))) return undefined;
    if (chosenKeys.some((k) => lists.get(k) === null)) return undefined;
    return intersect([
      ...eventQuery.produce.map((k) => lists.get(k)!.p),
      ...eventQuery.consume.map((k) => lists.get(k)!.c),
    ]);
  }, [chosenKeys, lists, eventQuery]);
  const unanswerable = chosenKeys.length > 0 && chosenKeys.every((k) => lists.has(k))
    && chosenKeys.some((k) => lists.get(k) === null);

  // ONE RULE WITH THE HEADER FIELD. `matchNames` is the rule; this page adds the commander and
  // colour predicates the header does not offer, and the events narrow that answer by position.
  const matches = useMemo((): NameIndexEntry[] | null => {
    if (index === null || !asked) return [];
    if (keptIds === undefined) return null;
    const base = keptIds === null
      ? index
      : [...keptIds].map((id) => index[id]).filter((e): e is NameIndexEntry => e !== undefined);
    const named = needle.length === 0 ? base : matchNames(base, { query });
    // `identityKeyOf` spells colourless "C" and `coloursFit` spells it "", the same normalisation
    // the facet rows carried. Getting it wrong would make every colourless card answer only the
    // `C` chip, which is the opposite of the fits-in ruling.
    const identityOf = (e: NameIndexEntry): string => {
      const key = identityKeyOf(e.identity);
      return key === "C" ? "" : key;
    };
    // WHAT THE CARD IS, answered off the row rather than from the membership index (2026-09-21).
    // Compiled ONCE per pass: the names become codes here, not inside the filter, or a chosen
    // subtype costs a 488-entry scan per card on every keystroke.
    const fitsCharacteristics = compileCharacteristics(eventQuery, vocabulary);
    const kept = named.filter((e) => (!commanderMode || e.commander)
      && coloursFit(identityOf(e), colours, mode)
      && fitsCharacteristics(e));
    // AMONG CARDS THAT ALL ANSWER THE QUESTION, THE BETTER-CONNECTED ONE FIRST (owner 2026-09-17),
    // and that stays the default. The other two orders exist so a reader can ESCAPE that ranking:
    // the deck-build run found rare events outranking good cards and could only reach staples "by
    // already knowing their names and typing them in". A sort does not fix the ranking; it stops
    // the ranking being the only way through the list.
    const byName = (a: NameIndexEntry, b: NameIndexEntry): number => a.name.localeCompare(b.name, "en");
    const order = eventQuery.sort ?? "partners";
    return [...kept].sort(
      order === "name" ? byName
        : order === "mv" ? ((a, b) => (a.mv ?? 0) - (b.mv ?? 0) || byName(a, b))
        : ((a, b) => (b.partners ?? 0) - (a.partners ?? 0) || byName(a, b)),
    );
  }, [index, keptIds, needle, query, colours, commanderMode, mode, asked, eventQuery, vocabulary]);

  // WHAT THE PICKERS OFFER, AND WHAT EACH ROW COSTS TO SAY.
  //
  // A KEY WITH NO CAUSES IS NOT OFFERED AS A CAUSE. `meld|-|-|-` is the case that matters: its
  // count is a PRICE set by hand (a meld card's partner is the one card it names), not a census,
  // so it ships no cause list and must never be offered as one.
  //
  // THE ROW'S COUNT NARROWS WITH THE COLOUR CHIPS, from the 32 identity slots AJ5 already
  // computes. Printing the corpus figure beside an identity-filtered list is the defect AJ5 was
  // opened for, and this is the same page one surface along.
  // CEILING: it narrows by COLOURS only, not by the other events already chosen. Doing that would
  // mean fetching every candidate event's member list to intersect against the selection -- the
  // whole index, to label a dropdown. The count above the results is the exact one.
  const mask = useMemo(() => identityMask(colours.filter((c) => c !== "C")), [colours]);
  const countOf = useMemo(() => (key: string): number => {
    if (freq === null) return 0;
    const slots = freq.byIdentity[key];
    return colours.length > 0 && slots ? inIdentityOf(slots, mask) : (freq.supply[key] ?? 0);
  }, [freq, colours, mask]);
  const consumeCountOf = useMemo(() => (key: string): number => freq?.consume[key] ?? 0, [freq]);

  const produceOptions = useMemo(
    () => (freq === null ? [] : Object.keys(freq.supply).filter((k) => (freq.supply[k] ?? 0) > 0 && k in freq.byIdentity)),
    [freq]);
  const consumeOptions = useMemo(
    () => (freq === null ? [] : Object.keys(freq.consume).filter((k) => (freq.consume[k] ?? 0) > 0)),
    [freq]);

  // HOW EACH SIDE SAYS AN EVENT (roadmap AK4). A card that CAUSES one is doing something, so it
  // takes the action a player would name ("sacrifice a creature"); a card WAITING for one takes
  // the clause ("a creature dies"). Not every event has an action -- nobody makes a creature
  // attack the way they make one die -- so the clause is the fallback rather than an invented verb.
  const causeWording = (key: string): string => eventKeyAction(key) ?? eventKeyClause(key);

  // THE CAP IS A PAGE (UX review, 2026-09-17). "467 match, showing the first 50" with no way to the
  // rest was a dead end; each press shows another fifty, and a new question starts over.
  const [shown, setShown] = useState(SEARCH_LIMIT);
  useEffect(() => { setShown(SEARCH_LIMIT); }, [matches]);

  /** AND THE PAGE TURNS ITSELF (owner, 2026-09-21: "infinity scroll is pretty standard"). The
   *  deck-build agent read "798 cards match, showing the first 50", never found the button under
   *  the grid, and spent the rest of its run typing in names it already knew -- so it never saw
   *  748 of the cards the question matched.
   *
   *  THE BUTTON STAYS, AND THE OBSERVER PRESSES IT. This is infinite scroll for anyone scrolling:
   *  the sentinel sits where the button is, the next fifty arrive before it is reached, and a
   *  mouse never meets a control. What the button buys is the half infinite scroll is known for
   *  breaking -- a keyboard user can still reach more results, and `IntersectionObserver` missing
   *  (jsdom, and the same guard `ChapterRail` keeps) degrades to the press that has worked since
   *  September.
   *
   *  AND IT STOPS. Loading only continues while `matches.length > shown`, so the list ends and
   *  `PageFoot` below it stays reachable -- the footer that retreats forever is the one thing this
   *  pattern is genuinely bad at, and it is a layout problem rather than a taste one. */
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const el = moreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((e) => e.isIntersecting)) setShown((n) => n + SEARCH_LIMIT); },
      // A SCREEN EARLY, so the fifty land before the reader arrives rather than after a stall. Any
      // more and a flick of the wheel loads pages nobody asked for.
      { rootMargin: "0px 0px 600px 0px" },
    );
    observer.observe(el);
    return () => { observer.disconnect(); };
    // `shown` is in the deps because the button unmounts when the list is exhausted and remounts
    // on the next question: the observer must attach to whatever button is there now.
  }, [shown, matches]);

  /** ONE ROW'S CONTROL. Each keeps its own label -- the colours have a legend, the picker and the
   *  select have their own -- so the row wrapper adds a remove button and nothing else. Wrapping
   *  them in a second heading would give a screen reader every filter's name twice. */
  const filterRow = (kind: FilterKind): React.JSX.Element => {
    switch (kind) {
      /* ON BOTH PAGES (spec part 4), and EXACT on both (owner 2026-09-08): Green and White list
       * green-white cards. A "fits in" subset was built first for the Cards page and rejected. */
      case "colours":
        return (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="eyebrow">Colour identity</legend>
            {COLOURS.map(([code, label]) => {
              const on = colours.includes(code);
              return (
                // FILTER CHIP, the system's own: `--separator` border at rest, `--accent` border
                // and text when selected -- the same grammar the tabs use, so a selected filter
                // and an active tab read as the same kind of state.
                <button
                  key={code} type="button" aria-pressed={on}
                  // COLOURLESS UNTICKS THE COLOURS AND THEY UNTICK IT. Every identity already
                  // contains the colourless cards, so the two questions cannot be asked at once --
                  // holding both would only ever draw an empty list.
                  onClick={() => setColours((cs) => on
                    ? cs.filter((c) => c !== code)
                    : code === "C" ? ["C"] : [...cs.filter((c) => c !== "C"), code])}
                  className="chip"
                >
                  {/* DECORATIVE HERE, and marked so: the chip's own word is its accessible name,
                    * and letting the symbol contribute one turns "Red" into "one red mana Red". */}
                  <span aria-hidden="true" className="text-base leading-none">
                    <ManaSymbols cost={`{${code}}`} />
                  </span>
                  {label}
                </button>
              );
            })}
          </fieldset>
        );
      /* A CHANGELING IS EVERY CREATURE TYPE (CR 702.73), and the derive already expands it -- so
       * `subtype=sliver` answers with 137 cards where the corpus prints about a hundred Slivers,
       * and Bloodline Pretender is in the answer. That is correct and it is what a Sliver deck
       * wants to know; it will be reported as a bug at some point, so it is written down here. */
      case "typeline":
        return (
          <TypeLinePicker
            types={vocabulary.types}
            subtypes={vocabulary.subtypes}
            chosenTypes={eventQuery.types}
            chosenSubtypes={eventQuery.subtypes}
            onChange={(next) => setEvents({ ...eventQuery, types: next.types, subtypes: next.subtypes })}
          />
        );
      case "mv":
        return (
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Mana value</span>
            <select
              className="field w-40"
              value={eventQuery.maxMv === undefined ? "" : String(eventQuery.maxMv)}
              onChange={(e) => setEvents({ ...eventQuery,
                ...(e.target.value === "" ? { maxMv: undefined } : { maxMv: Number(e.target.value) }) })}
            >
              <option value="">any</option>
              {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n} or less</option>)}
            </select>
          </label>
        );
      /* THE TWO QUESTIONS THIS ENGINE CAN ACTUALLY ANSWER (spec 2026-09-19, owner: "events are
       * does and theme basically"). What a card CAUSES and what it ASKS FOR, in the same
       * vocabulary the card pages print -- so a reader who clicked through from a partner group
       * meets the sentence they clicked.
       *
       * EVERY TERM ANDS, including between the two. The `does` chips ORed within their group;
       * keeping both vocabularies on one page under one heading, with two different meanings for
       * choosing two things, is the reason only one of them survived. */
      case "produce":
        return (
          <EventPicker
            label="Causes"
            hint={commanderMode ? "events this commander can cause for the rest of the deck" : "events the card can cause"}
            options={produceOptions}
            chosen={eventQuery.produce}
            counts={countOf}
            demand={consumeCountOf}
            say={causeWording}
            onChange={(next) => setEvents({ ...eventQuery, produce: next })}
          />
        );
      case "consume":
        return (
          <EventPicker
            label="Asks for"
            hint={commanderMode ? "events this commander is built to be paid" : "events the card is waiting for"}
            options={consumeOptions}
            chosen={eventQuery.consume}
            counts={consumeCountOf}
            demand={consumeCountOf}
            say={eventKeyClause}
            onChange={(next) => setEvents({ ...eventQuery, consume: next })}
          />
        );
    }
  };

  return (
    <PeekContext.Provider value={peek}>
    {/* THE LIST IS A GRID OF TILES NOW, so the reading measure that bounded a column of names would
      * bound a grid to three tiles; the header and the prose keep their own 65ch. */}
    {/* THE RAIL EXISTS ONLY WHILE A CARD IS PEEKED. Reserving its 20rem always left the landing
      * page a 650px column with the right two thirds of a 1920 screen empty (UX review, 2026-09-17). */}
    <div className={peek.stack.length > 0 ? "lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-10 lg:items-start" : undefined}>
    <section className="flex flex-col gap-6">
      {/* ONLY `/cards` EVER CARRIED A SHARE LINK. `/commanders` is a new path, so there is no
        * stale link to catch and nothing to redirect. */}
      {!commanderMode && (
        <LegacyDeckRedirect to="/analysis/cards" {...(hash !== undefined ? { hash } : {})}
          {...(replace !== undefined ? { replace } : {})} />
      )}
      <header className="flex flex-col gap-3">
        {/* THE LABEL IS NOT THE PAGE. "Cards" at 48px was the largest thing on a screen whose real
          * lead is the box you type in -- a generic noun out-ranking the only control that does
          * anything. */}
        <h1 className="text-2xl font-bold tracking-[-0.01em]">
          {commanderMode ? "Commanders" : "Cards"}
        </h1>
        <p className="text-(--muted) max-w-[65ch]">
          {commanderMode
            ? "Every legendary creature the engine has read that can lead a deck, with the cards inside its colour identity it is most specifically connected to."
            : "Every card the engine has read, with what it produces, what it cares about, and the cards it is most specifically connected to."}
        </p>
      </header>

      {/* NO KICKER: the label pairs INLINE with the field rather than stacking above it. */}
      <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow text-(--muted)">{commanderMode ? "find a commander" : "find a card"}</span>
        <input
          type="search" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={commanderMode ? "Kess, Dissident Mage" : "Krenko, Mob Boss"}
          // A CONTROL'S BOUNDARY IS `--field-border`, which is the 3:1 one (WCAG 1.4.11).
          // `--border` does not exist: it was absorbed into `--separator`, the decorative hairline,
          // and `css-tokens.test.ts` caught this line naming it.
          className="w-full max-w-lg min-h-11 rounded-(--field-radius) border border-(--field-border) bg-(--field-background)
            text-(--field-foreground) placeholder:text-(--field-placeholder) px-3"
        />
      </label>

      {/* THE PANEL IS A LIST OF ROWS YOU ADD (owner, 2026-09-21: "cards are like 20 % of the
        *  screen, which is not very userfriendly"). Measured on the deployed page at 1920x1080
        *  before this: the first card sat at 772px of a 930px viewport -- 83% chrome -- behind
        *  eight labelled groups every reader scrolled past whether or not they wanted any of them.
        *
        *  NOTHING IS DRAWN UNTIL IT IS ASKED FOR, colour identity included. A uniform rule was the
        *  owner's call over keeping the colours permanently visible: no control is privileged, so
        *  there is one thing to learn here rather than one row plus a menu of exceptions.
        *
        *  AND THE ROWS COME FROM THE URL, not from what was clicked. `filterKindsOf` reads the
        *  question, so a shared `?subtype=sliver&mv=3` arrives with both rows open and filled --
        *  otherwise a link would land on a page that does not show what it is asking. A row added
        *  and not yet filled has no param to be found in, which is what `pending` remembers.
        *
        *  ONE MODEL AT EVERY WIDTH. This replaces the `<details>` that folded the panel below
        *  `sm`, and with it the `matchMedia` read that decided which width it was -- a branch the
        *  test harness could never take, because a max-width media query is false under jsdom. */}
      <div className="facets flex flex-col gap-4">
        {shownKinds.length > 0 && (
          <ul className="flex flex-col gap-4 list-none p-0 m-0">
            {shownKinds.map((kind) => (
              <li key={kind} className="flex flex-wrap items-end gap-x-3 gap-y-2">
                <div className="min-w-0">{filterRow(kind)}</div>
                {/* THE ONLY WAY BACK TO "NOT ASKED" for a row, so it is a real control and not a
                  * hover affordance: this page is used on a phone, where hover does not exist. */}
                <button
                  type="button"
                  className="chip"
                  aria-label={`Remove the ${FILTER_LABEL[kind]} filter`}
                  onClick={() => dropKind(kind)}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* A NATIVE `<details>`, so the keyboard and screen-reader model is the platform's -- the
          * same reason the panel it replaces was one. It closes itself once a row is added,
          * because a menu still standing over the control it just created is in the way. */}
        {available.length > 0 && (
          <details
            // `relative`, AND IT IS LOAD-BEARING: `.site-search-list` below is `position:absolute`,
            // so without a positioned ancestor it resolves against the INITIAL containing block.
            // Measured in a browser when this was missing: the open menu painted at left:0,
            // top:1084, width:1920 -- full-bleed and entirely below a 1080px viewport. No test saw
            // it, because jsdom does no layout. `TypeLinePicker` wraps its own list for this reason.
            className="relative w-fit"
            open={menuOpen}
            onToggle={(e) => setMenuOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="chip cursor-pointer list-none w-fit group/add">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add a filter
            </summary>
            <ul className="site-search-list mt-1 list-none p-0 w-fit">
              {available.map((kind) => (
                <li key={kind}>
                  <button
                    type="button"
                    className="site-search-row w-full text-left"
                    onClick={() => { setPending((ks) => [...ks, kind]); setMenuOpen(false); }}
                  >
                    {FILTER_LABEL[kind]}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {index === null
        ? <p className="text-(--muted)">Reading the index…</p>
        : !asked
        // AN EMPTY QUERY IS NOT AN EMPTY PAGE and not the whole corpus either: it says what is here
        // and waits. A bare box with nothing under it reads as a page that failed to load.
        // AN EMPTY QUERY OWNS THE SPACE IT IS IN rather than leaving a bare box above a screen of
        // nothing. It says what is here, in the figure that makes the claim concrete.
        ? <div className="min-h-[30svh] flex flex-col justify-center gap-2">
            <p className="text-3xl font-bold tracking-[-0.01em] tabular-nums">
              {(commanderMode ? index.filter((e) => e.commander).length : index.length).toLocaleString("en-US")}
            </p>
            <p className="text-(--muted) max-w-[55ch]">
              {commanderMode
                ? "commanders the engine has read. Pick a colour, or type a name."
                : "cards the engine has read. Type a name to find one."}
            </p>
            <p className="eyebrow text-(--muted) mt-4">or ask, for example</p>
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0" aria-label="Example questions">
              {EXAMPLES[mode].map((ex) => (
                <li key={ex.label}>
                  <button type="button" className="chip" onClick={() => setEvents(ex.q)}>{ex.label}</button>
                </li>
              ))}
            </ul>
          </div>
        : matches === null
        ? <p className="eyebrow text-(--muted)">reading what cards do</p>
        : (
          <div className="flex flex-col gap-2">
            {/* THE ORDER SITS WITH THE COUNT, NOT IN THE FILTER MENU (2026-09-21). An order is not
              * a question: it applies with nothing asked, so there is no "add" that turns it on
              * and nothing to remove -- and a reader looking for it looks at the list it reorders.
              *
              * THE DEFAULT IS THE ARTIFACT'S OWN ORDER and stays first. The other two exist so a
              * reader can ESCAPE the ranking, which the deck-build run needed: rare events
              * outranked good cards, and it reached staples only by typing names it already knew.
              * This does not fix the ranking. It stops the ranking being the only way through. */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {/* A STATUS MESSAGE (WCAG 4.1.3): a chip changes the set and the number moves; a
                * screen reader hears it only if the paragraph says it is one. */}
              <p role="status" className="text-(--muted) text-sm">
                {/* THE REFUSAL SITS WHERE THE COUNT SITS, so the order control is reachable on a
                  * zero-result answer too -- a shared `?sort=name` link that matches nothing had
                  * no way to undo the order it arrived carrying. */}
                {matches.length === 0
                  ? <>No {commanderMode ? "commander" : "card"} matches. The engine has read{" "}
                      {index.length.toLocaleString("en-US")} cards; one it has never read has no page.</>
                  : <>{matches.length.toLocaleString("en-US")}{" "}
                      {matches.length === 1
                        ? (commanderMode ? "commander matches" : "card matches")
                        : (commanderMode ? "commanders match" : "cards match")}
                      {matches.length > shown ? `, showing the first ${shown}` : ""}.</>}
              </p>
              <label className="flex items-center gap-2">
                <span className="eyebrow">Order</span>
                <select
                  className="field w-44"
                  value={eventQuery.sort ?? "partners"}
                  onChange={(e) => setEvents({ ...eventQuery, sort: e.target.value as EventQuery["sort"] })}
                >
                  <option value="partners">most connected</option>
                  <option value="mv">cheapest first</option>
                  <option value="name">A to Z</option>
                </select>
              </label>
            </div>
            {/* IDENTITY IS THE ROW'S DIFFERENTIATOR. Fifty near-identical lines of blue text is a
              * list nobody scans; the mana symbols give the eye something that varies, and they are
              * the one thing a player reads before the name when choosing a card. Present colours
              * only -- five fixed slots is the rule for a TABLE, and this list has no column to
              * align to. */}
            {/* WIDTH BUYS COLUMNS HERE TOO: a single 685px column of names left the right half of a
              * 1920px screen black and showed twelve results where two columns show twenty-four. */}
            {/* TILES (owner, 2026-09-17): the whole card small, the name, its pips, and under it why
              * it is on the list -- the chip labels that hit. A list with no reason is what this
              * product refuses everywhere else. */}
            <ul aria-label="Results" className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-x-3 gap-y-6 sm:gap-x-4 list-none p-0 m-0">
              {matches.slice(0, shown).map((e) => {
                // WHY IT IS ON THE LIST, in the sentences that were asked. Every kept row answers
                // every term (the query ANDs), so the caption is the question rather than a
                // per-row computation over data this page no longer fetches.
                const terms = [
                  ...eventQuery.produce.map(causeWording),
                  ...eventQuery.consume.map((k) => eventKeyClause(k)),
                ];
                return (
                  <li key={e.slug} className="min-w-0">
                    <CardTile
                      slug={e.slug} name={e.name} art={e.art} identity={e.identity}
                      to={`${commanderMode ? "/commanders" : "/cards"}/${e.slug}`}
                      caption={terms.length > 0 ? terms.join(" · ") : undefined}
                      note={!commanderMode && e.commander ? "commander" : undefined}
                    />
                  </li>
                );
              })}
            </ul>
            {matches.length > shown && (
              <button
                ref={moreRef}
                type="button"
                className="btn-secondary self-start"
                onClick={() => setShown((n) => n + SEARCH_LIMIT)}
              >
                Show {Math.min(SEARCH_LIMIT, matches.length - shown)} more
              </button>
            )}
          </div>
        )}
      <PageFoot />
    </section>
    {/* The peek beside the list on a wide viewport; below `lg` `.peek` is a fixed bottom sheet, so
      * the aside's position does not matter there. Rendered only while a card is being looked at,
      * so the list keeps its measure the rest of the time. */}
    {peek.stack.length > 0 && (
      <aside className="lg:sticky lg:top-[calc(var(--site-header-h,0px)+1.5rem)]">
        <CardPeek load={peekLoad} surface={commanderMode ? "commander" : "card"} />
      </aside>
    )}
    </div>
    </PeekContext.Provider>
  );
}
