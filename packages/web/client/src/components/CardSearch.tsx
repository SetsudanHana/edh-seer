import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { isPattern, narrowingOf, verbOfKey } from "@edh-seer/matcher/event-pattern";
import { useSearchParams } from "react-router";
import { identityMask, inIdentityOf } from "@edh-seer/matcher/partners-core";
import { matchNames, needleOf } from "../lib/name-match.js";
import { coreContext, evaluateEventQuery, fromEventQuery, rowCountsOf, typeCountSpec, withEveryCreatureType } from "../lib/search/from-event-query.js";
import { BESPOKE_FIELDS, abilityFieldsOf, createSearchLoader, fieldsOf, listsOf, needsCatalogue, usesAbilityScope, resolveCatalogue, type CatalogueResolution, type SearchLoader } from "../lib/search/load.js";
import type { Catalogue, CatalogueField } from "../lib/search/catalogue.js";
import { ACROSS_ABILITIES_NOTE, abilityTermsOf, abilityTermsOfFilters, needsAcrossNote } from "../lib/search/ability-scope.js";
import { evaluate, type EvalContext, type Node } from "../lib/search/evaluate.js";
import { builderQuery } from "../lib/search/builder-text.js";
import { eventsOf, fieldNames, keepChangelings as keepTyped, notSubtypesOf, parse, print, shapeNode, toNode, type Query, type QueryError } from "../lib/search/query.js";
import { buildSchema } from "../lib/search/schema.js";
import { TypedQuery } from "./TypedQuery.js";
import { TypeCountRow } from "./TypeCountRow.js";
import { FieldRow } from "./FieldRow.js";
import { sharedEventFrequency, sharedEventMembers, sharedNameIndex, sharedNameIndexVocabulary, type EventFrequencyFile, type EventMembers, type NameIndexEntry } from "../lib/partners.js";
import { eventsFromParams, eventsToParams, filterKindsOf, factFilterOf, orderOf, withoutFilterKind, EFFECT_KINDS, FILTER_KINDS, NATURAL_DIR, TYPE_COUNTS, type EventQuery, type FieldFilter, type FilterKind, type SortKey, type TypeCountSort } from "../lib/facets.js";
import { BY_WHAT_IT_IS, TIMING_UNKNOWN, effectCaption } from "../lib/effect-caption.js";
import { isEmptyFilter } from "@edh-seer/matcher/member-facts";
import { membersPassing, unjudgedLeftOut } from "../lib/effect-filter.js";
import { AbilityKindRow, AmountRow, RepeatsRow } from "./EffectRows.js";
import { EventSentence, termWords } from "./EventSentence.js";
import { answerTerms, termsOf, withTerms } from "../lib/event-terms.js";
import { CardTile } from "./CardTile.js";
import { TypeLinePicker } from "./TypeLinePicker.js";
import { WordPicker } from "./WordPicker.js";
import { RangeRow } from "./RangeRow.js";
import { LegacyDeckRedirect } from "./LegacyDeckRedirect.js";
import { ManaSymbols } from "./ManaSymbols.js";
import { PageFoot } from "./PageFoot.js";
import { CardPeek } from "./CardPeek.js";
import { PeekContext, usePeekState } from "./peek.js";
import type { CardPageData } from "../lib/partners.js";

/** How long the name box waits after the last key before it asks. Long enough to cover a word typed
 *  at speed, short enough that a pause reads as the list answering. A CEILING rather than a token:
 *  it is input latency, not motion, so `tokens/motion.json` has no say in it. */
export const QUERY_SETTLE_MS = 250;

/** Rows of tiles on the unasked page: two full rows at the grid's width, and never fewer than
 *  twelve tiles (four rows on a phone). A flat twelve filled 12 of 16 columns at 3840 and left a
 *  third of the row empty (#770). */
const BROWSE_ROWS = 2;
const BROWSE_MIN = 12;
export const browseCount = (cols: number): number => Math.max(BROWSE_MIN, cols * BROWSE_ROWS);

/** How many columns an auto-fill grid is drawing, following resizes. */
function useGridColumns(): [(el: HTMLElement | null) => void, number] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [cols, setCols] = useState(0);
  useEffect(() => {
    if (!el) return;
    const read = () => setCols(getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, cols];
}

/** WHAT THIS PAGE CAN ANSWER, AS THREE QUESTIONS A READER CAN CLICK (owner, 2026-09-17: the landing
 *  was a wall of chips and a count). Asked in the engine's own events since AJ3, so the empty state
 *  shows the shape of a question rather than a vocabulary that no longer exists. The keys are real
 *  and were checked against the built artifact; an invented one would render an empty page. */
/** How many keys the order rows offer (a link may carry more; they are all kept). */
const MAX_ORDER_KEYS = 3;
const ORDER_KEYS: readonly SortKey[] = ["effect", "partners", "mv", "pow", "tou", ...TYPE_COUNTS.map((c) => c.sort), "name"];
const ORDER_LABEL: Partial<Record<SortKey, string>> = { effect: "How much it does", partners: "Connections", mv: "Mana value", pow: "Power", tou: "Toughness", name: "Name" };

const EXAMPLES: Record<"cards" | "commanders", { label: string; q: EventQuery }[]> = {
  cards: [
    { label: "mills a card, in blue", q: { produce: ["mill|-|-|-"], consume: [], colours: ["U"], types: [], subtypes: [], keywords: [], cardColours: [] } },
    { label: "makes a creature token", q: { produce: ["create-token|creature|-|t"], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] } },
    { label: "wants a creature to die", q: { produce: [], consume: ["dies|creature|-|-"], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] } },
  ],
  commanders: [
    { label: "wants a creature to die", q: { produce: [], consume: ["dies|creature|-|-"], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] } },
    { label: "wants a counter added", q: { produce: [], consume: ["counter-added|creature|-|-"], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] } },
    { label: "wants a land to enter, in green", q: { produce: [], consume: ["enters|land|-|-"], colours: ["G"], types: [], subtypes: [], keywords: [], cardColours: [] } },
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
  ["C", "Colorless"],
];

/** WHAT EACH ROW CALLS ITSELF IN THE MENU. British spelling, and the two event rows keep the words
 *  the card pages print -- a reader who clicked through from a partner group meets the same two. */
const FILTER_LABEL: Record<FilterKind, string> = {
  colours: "Color identity",
  // "Colour", NOT "Card colour": beside "Colour identity" the shorter word is already the
  // contrast, and the two sit next to each other in the menu where the pair reads as a pair.
  cardColours: "Color",
  typeline: "Type line",
  typeCounts: "Number of types",
  keywords: "Keywords",
  mv: "Mana value",
  power: "Power",
  toughness: "Toughness",
  produce: "Causes",
  consume: "Cares about",
  abilityKind: "Ability type",
  repeats: "How often",
  amount: "Amount",
};

/** "Borg", "Borg and Elf", "Borg, Elf and Human": the NOT-ed creature types, capitalised the way the tiles say them. */
const typeNames = (names: readonly string[]): string => {
  const all = names.map((n) => n.replace(/\b\w/g, (c) => c.toUpperCase()));
  return all.length <= 1 ? (all[0] ?? "") : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
};

/** ONE EMPTY LIST, so a query with no catalogue rows keeps the identity of what depends on it. */
const NO_FILTERS: readonly FieldFilter[] = [];

/** The panel's rows: every kind but the two events, which the sentence asks. */
const ROW_KINDS = FILTER_KINDS.filter((k) => k !== "produce" && k !== "consume");

/** EVENTS WITH NO TARGET TO NARROW TO. Life is gained or lost by a player; the type slot these keys
 *  sometimes carry names what CAUSED it (Firesong and Sunspeaker's instant or sorcery), not what
 *  the event happens to, so "narrow to an instant" would say something the card does not. */
const NO_TARGET: ReadonlySet<string> = new Set(["gain-life", "lose-life"]);

export function CardSearch({
  load = sharedNameIndex, frequency = sharedEventFrequency, members = sharedEventMembers,
  vocabulary: loadVocabulary = sharedNameIndexVocabulary,
  searchLoader,
  peekLoad, hash, replace, mode = "cards",
}: {
  load?: (baseUrl: string) => Promise<NameIndexEntry[]>;
  /** The type, subtype and keyword tables the rows' codes index into. */
  vocabulary?: (baseUrl: string) => Promise<{ types: string[]; subtypes: string[]; keywords: string[] }>;
  /** The search catalogue's loader: named lists and the faces group, read only when a question needs them (type counts,
   *  the changeling note). Tests pass their own; the page reads `/static`. */
  searchLoader?: SearchLoader;
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
  const [vocabulary, setVocabulary] = useState<{ types: string[]; subtypes: string[]; keywords: string[] }>(
    { types: [], subtypes: [], keywords: [] });
  // THE QUERY LIVES IN THE URL, so a search is a link. `/cards/krenko-mob` is a slug nobody minted;
  // its page cannot guess what was meant, but it CAN hand the reader here with what they typed
  // already in the box -- which is the whole recovery from a truncated or misremembered name.
  // Shareable for free, and `replace` keeps a keystroke out of the back button.
  const [params, setParams] = useSearchParams();
  const query = params.get("q") ?? "";
  // THE NAME FILTER USED TO ERASE EVERY OTHER PARAM. `setParams({ q: next })` replaced the whole
  // query string, so typing a name after picking an event silently dropped the event -- harmless
  // while the only other params were chips a reader could see, a real loss now. Merge instead.
  //
  // THE BOX TYPES LOCALLY AND THE URL CATCHES UP WHEN THE READER PAUSES (owner, 2026-09-22). The
  // input used to be bound straight to `q`, so each keystroke was a navigation and the list
  // re-filtered 25k rows under the reader's fingers; typing faster than the router could commit
  // lost characters ("Snapcaster" arrived as `q=ar`). Text is local and never lags; the question
  // is asked once, `QUERY_SETTLE_MS` after the last key. The updater form reads the params as they
  // are when the timer fires, so a chip clicked mid-word is not undone by a stale copy.
  const [text, setText] = useState(query);
  const written = useRef(query);
  useEffect(() => {
    // THE URL MOVED WITHOUT US (Back, a link, a cleared filter): the box follows it.
    if (query !== written.current) { written.current = query; setText(query); }
  }, [query]);
  useEffect(() => {
    if (text === written.current) return;
    const timer = setTimeout(() => {
      written.current = text;
      setParams((prev) => {
        const out = new URLSearchParams(prev);
        if (text) out.set("q", text); else out.delete("q");
        return out;
      }, { replace: true });
    }, QUERY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, setParams]);
  // THE QUESTION LIVES IN THE URL (spec 2026-09-19), so a result set is a link and the back button
  // is honest -- the same rule the colour chips have followed since they moved out of local state.
  const builderEvents = useMemo(() => eventsFromParams(params), [params]);
  // `x=` (#1783) IS THE WHOLE QUESTION WHEN PRESENT: the builder's own params stay in the link, paused, and come back when
  // `x` goes. The order and its direction are not part of a question, so they keep working beside it.
  const xText = (params.get("x") ?? "").trim();
  const typedActive = xText.length > 0;
  const eventQuery = useMemo((): EventQuery => (typedActive
    ? { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [],
      ...(builderEvents.sort ? { sort: builderEvents.sort } : {}), ...(builderEvents.dir ? { dir: builderEvents.dir } : {}),
      ...(builderEvents.thenBy ? { thenBy: builderEvents.thenBy } : {}), ...(builderEvents.sortIssues ? { sortIssues: builderEvents.sortIssues } : {}),
      // THE CHANGELING TOGGLE IS A WAY TO READ THE ANSWER, not part of the question, so it rides beside `x` as it does beside the rows.
      ...(builderEvents.keepChangelings ? { keepChangelings: true } : {}) }
    : builderEvents), [typedActive, builderEvents]);
  // TYPED MODE TAKES THE ORDER AND ITS DIRECTION AS GIVEN: changing the order deliberately drops the direction, and the
  // paused rows' own must not bring the old one back.
  const withOrder = (kept: EventQuery, next: EventQuery): EventQuery => {
    const { sort: _s, dir: _d, ...rest } = kept;
    const { thenBy: _t, sortIssues: _i, ...restKept } = rest;
    return { ...restKept, ...(next.sort ? { sort: next.sort } : {}), ...(next.dir ? { dir: next.dir } : {}), ...(next.thenBy ? { thenBy: next.thenBy } : {}), keepChangelings: next.keepChangelings };
  };
  const setEvents = (next: EventQuery) => setParams(
    eventsToParams(typedActive ? withOrder(builderEvents, next) : next, params),
    { replace: true });
  // THE SKIPPED VIEW BELONGS TO ONE SET OF TERMS AND EFFECT ROWS: change either and it is dropped, or
  // it would stay armed and reopen on the skipped list when the filters next leave something out.
  const setEffects = (next: EventQuery) => { const { skipped: _s, ...rest } = next; setEvents(rest); };
  // THE ORDER AS ROWS (#1787): the first key, each further key, and ONE empty row to add another while there is room. A key may be used once.
  const effectiveKey = (k: SortKey): SortKey => (k === "effect" && eventQuery.produce.length === 0 ? "partners" : k);
  const orderChain = useMemo(() => [{ sort: orderOf(eventQuery), dir: eventQuery.dir }, ...(eventQuery.thenBy ?? [])].map((k) => ({ sort: effectiveKey(k.sort), dir: k.dir })), [eventQuery]);
  const usedKeys = orderChain.map((k) => k.sort);
  const orderRows: { sort: SortKey | null; dir: "asc" | "desc" }[] = [
    ...orderChain.map((k) => ({ sort: k.sort as SortKey | null, dir: k.dir ?? NATURAL_DIR[k.sort] })),
    ...(orderChain.length < MAX_ORDER_KEYS ? [{ sort: null, dir: "desc" as const }] : []),
  ];
  const withChain = (chain: { sort: SortKey; dir?: "asc" | "desc" }[]): EventQuery => {
    const { sort: _s, dir: _d, thenBy: _t, sortIssues: _i, ...rest } = eventQuery;
    const [first, ...more] = chain;
    return { ...rest, ...(first ? { sort: first.sort, ...(first.dir ? { dir: first.dir } : {}) } : {}), ...(more.length > 0 ? { thenBy: more } : {}) };
  };
  // CHANGING A KEY RESETS ITS OWN DIRECTION to that key's natural end (the first key's rule since #1783), and leaves the others alone.
  const setOrderKey = (i: number, value: string): void => {
    const chain = orderChain.map((k) => ({ ...k }));
    if (value === "") chain.splice(i, 1);
    else if (i >= chain.length) chain.push({ sort: value as SortKey, dir: undefined });
    else chain[i] = { sort: value as SortKey, dir: undefined };
    setEvents(withChain(chain.filter((k, j) => chain.findIndex((x) => x.sort === k.sort) === j).map((k) => ({ sort: k.sort, ...(k.dir ? { dir: k.dir } : {}) }))));
  };
  const setOrderDir = (i: number, dir: "asc" | "desc"): void => {
    setEvents(withChain(orderChain.map((k, j) => ({ sort: k.sort, ...(j === i ? { dir } : k.dir ? { dir: k.dir } : {}) }))));
  };
  const colours = eventQuery.colours;
  const setColours = (f: (cs: string[]) => string[]) => setEvents({ ...eventQuery, colours: f(colours) });
  const terms = useMemo(() => termsOf(eventQuery), [eventQuery]);
  const builderKeys = useMemo(() => [...new Set(terms.map((t) => t.key))], [terms]);
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
  // THE EVENTS ARE NOT ROWS ANY MORE: the sentence above the panel asks them (owner, 2026-09-27).
  const shownKinds = ROW_KINDS.filter((k) => askedKinds.includes(k) || pending.includes(k));
  // HOW THE EVENTS HAPPEN IS OFFERED ONCE AN EVENT IS ASKED (owner, 2026-10-24): before that the
  // three rows would narrow nothing, and a control that changes nothing reads as a broken one.
  const eventAsked = terms.some((t) => t.op !== "not");
  const available = ROW_KINDS.filter((k) => !shownKinds.includes(k) && (eventAsked || !EFFECT_KINDS.includes(k)));
  const [menuOpen, setMenuOpen] = useState(false);
  // THE CATALOGUE'S OWN ROWS (#1782): fields no bespoke row covers, each a row drawn from the catalogue entry. The ids in
  // the URL, then the ones added and not yet filled (as `pending` does for the kinds). The catalogue is read when the
  // menu opens or the link names one of these fields, never otherwise; their group files only once a row holds a value.
  const fieldFilters = eventQuery.fieldFilters ?? NO_FILTERS;
  const genericAsked = fieldFilters.length > 0;
  const [fieldRows, setFieldRows] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState(false);
  const resolveLoader = useMemo(() => searchLoader ?? createSearchLoader("/static"), [searchLoader]);
  const [catalogueInfo, setCatalogueInfo] = useState<{ state: "idle" | "loading" | "ready" | "none" | "failed"; cat: Catalogue | null }>({ state: "idle", cat: null });
  const [catAttempt, setCatAttempt] = useState(0);
  // A MENU WITH NO KIND LEFT HAS ONLY THE CATALOGUE TO OFFER, so it is read without waiting for the menu to open.
  const wantCatalogue = menuOpen || genericAsked || typedActive || available.length === 0;
  useEffect(() => {
    if (!wantCatalogue) return;
    let live = true;
    setCatalogueInfo((prev) => (prev.state === "ready" || prev.state === "none" ? prev : { state: "loading", cat: null }));
    resolveLoader.catalogue().then(
      (cat) => { if (live) setCatalogueInfo(cat ? { state: "ready", cat } : { state: "none", cat: null }); },
      () => { if (live) setCatalogueInfo({ state: "failed", cat: null }); },
    );
    return () => { live = false; };
  }, [wantCatalogue, resolveLoader, catAttempt]);
  const idsInQuery = useMemo(() => [...new Set(fieldFilters.map((f) => f.field))], [fieldFilters]);
  useEffect(() => {
    setFieldRows((rs) => (idsInQuery.every((id) => rs.includes(id)) ? rs : [...new Set([...rs, ...idsInQuery])]));
  }, [idsInQuery]);
  const catalogueFields = useMemo(
    () => new Map((catalogueInfo.cat ? Object.values(catalogueInfo.cat.groups).flatMap((g) => g.fields) : []).map((f) => [f.id, f] as const)),
    [catalogueInfo.cat]);
  // THE CATALOGUE'S ABILITY FIELDS: what `ability( … )` may hold, and what the builder's "same ability" switch groups.
  const abilityFields = useMemo((): ReadonlySet<string> => new Set([...catalogueFields.values()].filter((f) => f.ability === true).map((f) => f.id)), [catalogueFields]);
  const abilityMustRows = useMemo(() => abilityTermsOfFilters(fieldFilters.filter((f) => f.op !== "not"), (id) => abilityFields.has(id)), [fieldFilters, abilityFields]);
  const dropField = (id: string): void => {
    const rest = fieldFilters.filter((f) => f.field !== id);
    const { fieldFilters: _f, ...without } = eventQuery;
    setEffects(rest.length > 0 ? { ...without, fieldFilters: rest } : without);
    setFieldRows((rs) => rs.filter((r) => r !== id));
  };
  const setFieldFilters = (id: string, next: FieldFilter[]): void => {
    const all = [...fieldFilters.filter((f) => f.field !== id), ...next];
    const { fieldFilters: _f, ...without } = eventQuery;
    setEffects(all.length > 0 ? { ...without, fieldFilters: all } : without);
  };
  // REMOVING A ROW CLEARS ITS QUESTION AND FORGETS THE ROW. Doing only the first would leave an
  // empty control standing where a reader had just said they were finished with it.
  const dropKind = (kind: FilterKind): void => {
    setEffects(withoutFilterKind(eventQuery, kind));
    setPending((ks) => ks.filter((k) => k !== kind));
  };
  const offeredFields = useMemo((): CatalogueField[] => [...catalogueFields.values()]
    .filter((f) => !BESPOKE_FIELDS.has(f.id) && !fieldRows.includes(f.id)), [catalogueFields, fieldRows]);
  const isLabelled = (f: CatalogueField): boolean => f.label !== undefined && f.label !== f.id;
  // A LABELLED FIELD IS A QUESTION A PLAYER ASKS, unless the catalogue says it is a path of the grammar (`advanced`, #1784): those wait behind the
  // switch labelled or not, labelled ones first, by their words, then the bare paths by id.
  const menuLabelled = useMemo(() => offeredFields.filter((f) => isLabelled(f) && !f.advanced).sort((a, b) => a.label!.localeCompare(b.label!, "en")), [offeredFields]);
  const menuUnlabelled = useMemo(() => [
    ...offeredFields.filter((f) => isLabelled(f) && f.advanced).sort((a, b) => a.label!.localeCompare(b.label!, "en")),
    ...offeredFields.filter((f) => !isLabelled(f)).sort((a, b) => a.id.localeCompare(b.id, "en")),
  ], [offeredFields]);
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
  const [sentenceOpened, setSentenceOpened] = useState(false);
  const needsFreq = sentenceOpened || builderKeys.length > 0 || typedActive;
  useEffect(() => {
    if (!needsFreq || freq !== null) return;
    let live = true;
    void frequency("/static").then((f) => { if (live) setFreq(f); });
    return () => { live = false; };
  }, [needsFreq, freq, frequency]);

  // THE TYPED QUERY, READ AGAINST WHAT THIS BUILD HOLDS (#1783). Nothing is judged until the tables, the catalogue and (for an
  // event word) the event keys are in: an early "unknown field" would be a wrong answer, so the page waits instead.
  const hasCardColours = useMemo(() => (index ?? []).some((r) => r.c !== undefined), [index]);
  const schema = useMemo(() => buildSchema({ vocabulary, catalogue: catalogueInfo.cat, hasCardColours, events: freq }),
    [vocabulary, catalogueInfo.cat, hasCardColours, freq]);
  const typed = useMemo((): { status: "pending" | "failed" } | { status: "error"; error: QueryError } | { status: "ok"; ast: Query } | null => {
    if (!typedActive) return null;
    if (index === null || catalogueInfo.state === "idle" || catalogueInfo.state === "loading") return { status: "pending" };
    if (catalogueInfo.state === "failed") return { status: "failed" };
    const r = parse(xText, schema);
    if (!r.ok) return { status: "error", error: r.error };
    if (r.ast === null) return { status: "pending" };
    if (r.usesEvents && freq === null) return { status: "pending" };
    return { status: "ok", ast: r.ast };
  }, [typedActive, index, catalogueInfo.state, xText, schema, freq]);
  const typedAst = typed?.status === "ok" ? typed.ast : null;
  // THE ABILITY-SCOPE NOTE (#1784): two terms on the grammar's own fields are matched by card, not by ability, until #1786.
  const abilityTerms = useMemo(() => {
    const isAbility = (id: string): boolean => catalogueFields.get(id)?.ability === true;
    return typedActive ? (typedAst ? abilityTermsOf(typedAst, isAbility) : 0) : abilityTermsOfFilters(eventQuery.sameAbility === true ? fieldFilters.filter((f) => f.op === "not") : fieldFilters, isAbility) + (eventQuery.sameAbility === true && fieldFilters.some((f) => f.op !== "not" && isAbility(f.field)) ? 1 : 0);
  }, [typedActive, typedAst, fieldFilters, catalogueFields, eventQuery.sameAbility]);
  const typedShape = useMemo(() => (typedAst ? shapeNode(typedAst) : null), [typedAst]);
  const typedNeedsCatalogue = typedShape !== null && needsCatalogue(typedShape);
  const chosenKeys = useMemo(
    () => (typedAst ? [...new Set(eventsOf(typedAst).map((e) => e.key))] : typedActive ? [] : builderKeys),
    [typedAst, typedActive, builderKeys]);

  // THE TEXT BOX SHOWS WHAT THE ROWS ASK, until the reader types: then `x=` is the question and the rows pause. ONE WAY, AND SAID
  // SO: the rows write their own params (so every old link and every row edit is as it was) and are shown as text here; typed text
  // becomes `x=` and does not rewrite the rows, because a typed `or` / `not` group has no row to sit in. Clearing `x` brings the
  // rows back as they were. Same settle rule as the name box, so a keystroke is not a navigation.
  const builderText = useMemo(() => {
    const q = typedActive ? null : builderQuery(builderEvents, mode, abilityFields);
    return q === null ? "" : print(q, schema);
  }, [typedActive, builderEvents, mode, schema, abilityFields]);
  // THE ROWS THE TEXT HAS NO WORDS FOR (ability type, how often, amount): said, so the box is never taken for all of the question.
  const builderLeavesOut = !typedActive && ((builderEvents.abilityKinds?.length ?? 0) > 0 || builderEvents.repeatsMin !== undefined
    || builderEvents.amountMin !== undefined || builderEvents.amountMax !== undefined || builderEvents.amountVariable === true || builderEvents.amountChange !== undefined);
  const baseText = typedActive ? xText : builderText;
  const [typedText, setTypedText] = useState(baseText);
  const seenText = useRef(baseText);
  useEffect(() => {
    if (baseText !== seenText.current) { seenText.current = baseText; setTypedText(baseText); }
  }, [baseText]);
  useEffect(() => {
    const t = typedText.trim();
    if (t === seenText.current) return;
    const timer = setTimeout(() => {
      seenText.current = t;
      setParams((prev) => {
        const out = new URLSearchParams(prev);
        if (t === "" || t === builderText) out.delete("x"); else out.set("x", t);
        return out;
      }, { replace: true });
    }, QUERY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typedText, builderText, setParams]);
  const typedNames = useMemo(() => fieldNames(schema).map((f) => f.name), [schema]);

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
  // EVERY DIMENSION BELONGS IN IT, and the one time that was forgotten `?subtype=sliver` rendered
  // an EMPTY page with no count -- the filter applied and the list was never drawn, which reads as
  // "no Slivers" rather than as "nothing asked". `filterKindsOf` is the same reading of the same
  // query, so asking it here means a dimension can never again be added to one and not the other.
  // THE EFFECT ROWS ARE NOT A QUESTION ON THEIR OWN: they narrow the events, and with none asked an
  // "Amount 1 to 1" link would otherwise draw the whole index as its answer.
  const asked = typedActive || needle.length > 0 || chosenKeys.length > 0
    || filterKindsOf(eventQuery).some((k) => !EFFECT_KINDS.includes(k)) || genericAsked;
  // A ROW'S POSITION IN THE INDEX, which is what the event lists hold. Once per artifact.
  const positionOf = useMemo(() => new Map((index ?? []).map((e, i) => [e, i] as const)), [index]);

  // THE SET THE EVENTS DESCRIBE. `null` means no event was asked (the whole index is the base);
  // `undefined` means the answer is not knowable yet -- still reading, or a shard that did not
  // carry the key. A MISSING LIST IS NOT AN EMPTY ONE: rendering an empty set would claim that no
  // card causes the event, which is a claim, and this engine says nothing rather than guessing.
  // AND THE OPERATORS (owner, 2026-09-27): every `and` term, at least one `or` term, no `not` term.
  // `keep` null is the whole index; `drop` is taken away from whatever is kept.
  // A SHARD BUILT BEFORE THE FACTS SHIPPED CANNOT ANSWER HOW AN EVENT HAPPENS (`membersPassing`).
  const effectUnanswerable = useMemo(() => terms.some((t) => {
    const m = lists.get(t.key);
    return t.op !== "not" && m != null && membersPassing(m, t.side, factFilterOf(eventQuery, t.side)) === null;
  }), [terms, lists, eventQuery]);
  const keptIds = useMemo((): { keep: Set<number> | null; drop: Set<number> } | null | undefined => {
    if (chosenKeys.length === 0) return null;
    if (chosenKeys.some((k) => !lists.has(k))) return undefined;
    if (chosenKeys.some((k) => lists.get(k) === null)) return undefined;
    // HOW THE EVENT HAPPENS NARROWS THE `and` AND `or` TERMS, never a `not` one: "never makes a
    // player lose life" means never, not "never by a triggered ability" (owner, 2026-10-24).
    if (effectUnanswerable) return undefined;
    return answerTerms(terms, (t) => (t.op === "not"
      ? (t.side === "makes" ? lists.get(t.key)!.p : lists.get(t.key)!.c)
      : membersPassing(lists.get(t.key)!, t.side, factFilterOf(eventQuery, t.side))!));
  }, [chosenKeys, lists, terms, eventQuery, effectUnanswerable]);
  // THE CARD-LEVEL PREDICATES, ONE RULE FOR THE LIST AND FOR THE "left out" COUNT: the name, the
  // commander toggle, the colours and what the card is. The characteristics are evaluated ONCE per
  // question as an AST over views of the index rows (`lib/search`), the same evaluator every search
  // surface uses; this pass only looks each row up. The commander toggle joins as a `rows` leaf.
  //
  // WHAT THE ARTIFACT CAN ANSWER IS READ OFF THE ROWS rather than assumed: a missing `c` is colourless
  // on a fresh artifact and meaningless on an old one, and the deploy ships `static-out/` without
  // rebuilding it. The views leave `c` out of an artifact whose rows never carry it, so a colour
  // question there is cannot-answer -- and a cannot-answer shows no cards, as it always did.
  // A THIN ROW (no `t`) HAS NO MANA VALUE and is out of every mana-value range (#1789); it used to
  // read as 0 and showed up under "MV <= 2".
  // A NAME THE VOCABULARY DOES NOT KNOW MATCHES NOTHING, and the tables load asynchronously, so a
  // filter chosen before they arrive keeps the list empty rather than showing cards that do not answer it.
  const searchContext = useMemo(() => (index === null ? null : coreContext(index, vocabulary)), [index, vocabulary]);
  // WHAT NEEDS THE CATALOGUE (#1782). The five type counts read named lists (and the faces group for the front face),
  // so they, an order by one of them, and keeping changelings cannot answer from the rows alone: the page waits and
  // shows its loading line, never an empty or an unfiltered list. A NOT creature type answers from the rows (the
  // changeling is simply a card with every type); the catalogue is read only to say how many changelings that hid.
  const orderKey = orderOf(eventQuery);
  // EVERY KEY OF THE ORDER THAT IS A TYPE COUNT needs the catalogue's lists, not just the first (#1787).
  const countSorts = useMemo((): TypeCountSort[] => {
    const keys: string[] = [orderKey, ...(eventQuery.thenBy ?? []).map((t) => t.sort)];
    return [...new Set(keys.filter((k): k is TypeCountSort => TYPE_COUNTS.some((c) => c.sort === k)))];
  }, [orderKey, eventQuery.thenBy]);
  const countSort = countSorts[0] ?? null;
  const countsAsked = TYPE_COUNTS.some((c) => eventQuery[c.min] !== undefined || eventQuery[c.max] !== undefined);
  // THE NOT CREATURE TYPES: the rows' own, or the ones the typed text negates directly (`-st:borg`).
  const notSubtypes = useMemo((): readonly string[] => (typedAst ? notSubtypesOf(typedAst) : eventQuery.notSubtypes ?? []), [typedAst, eventQuery.notSubtypes]);
  const notSubtypesAsked = notSubtypes.length > 0;
  // A MUST OR ANY-OF SUBTYPE reads the creature list too, only to say on a changeling's tile why it matched (it is every
  // creature type). That is decoration: it never blocks the list, which answers from the rows.
  const subtypeAsked = eventQuery.subtypes.length > 0 || (eventQuery.orSubtypes?.length ?? 0) > 0;
  // THE KEY IS WHAT IS NEEDED, not the whole question: moving a mana-value bound must not look like a new
  // catalogue request and flash the loading line. `fields|lists`; the every-creature-type flag is built here, not fetched.
  const needKey = useMemo((): string | null => {
    if (!countsAsked && countSort === null && !notSubtypesAsked && !genericAsked && !subtypeAsked && !typedNeedsCatalogue) return null;
    const node = fromEventQuery(eventQuery, mode, { abilityFields });
    const abilityNeed = new Set(abilityFieldsOf(node));
    const fields = new Set(fieldsOf(node).filter((f) => f !== "everyCreatureType"));
    const lists = new Set([...(countsAsked || countSort !== null || notSubtypesAsked || subtypeAsked ? ["creature"] : []), ...(JSON.stringify(node).match(/"list":"(\w+)"/g) ?? []).map((m) => m.slice(8, -1))]);
    for (const cs of countSorts) {
      fields.add(typeCountSpec[cs].field);
      const l = typeCountSpec[cs].list;
      if (l) lists.add(l);
    }
    if (typedShape) {
      for (const f of fieldsOf(typedShape)) if (f !== "everyCreatureType") fields.add(f);
      for (const l of listsOf(typedShape)) lists.add(l);
      for (const f of abilityFieldsOf(typedShape)) abilityNeed.add(f);
    }
    return `${[...fields].sort().join(",")}|${[...lists].sort().join(",")}|${[...abilityNeed].sort().join(",")}`;
  }, [countsAsked, countSort, countSorts, notSubtypesAsked, subtypeAsked, genericAsked, typedNeedsCatalogue, typedShape, eventQuery, mode, abilityFields]);
  const [resolved, setResolved] = useState<{ core: EvalContext; key: string; ctx: EvalContext; state: CatalogueResolution["state"] } | null>(null);
  // THE RETRY CHIP: bumping it runs the read again. A failed read is shown, and the loader keeps nothing of it.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (searchContext === null || index === null || needKey === null) return;
    let live = true;
    // A LATE ANSWER FOR A QUESTION THE READER HAS SINCE CHANGED IS DROPPED: `live` ends with this effect, and the
    // answer is also keyed by the question and the rows it was built from.
    const [fieldPart = "", listPart = "", abilityPart = ""] = needKey.split("|");
    const need: Node = { and: [
      ...listPart.split(",").filter(Boolean).map((list): Node => ({ field: "t", op: "countIn", list })),
      ...fieldPart.split(",").filter(Boolean).map((field): Node => ({ field, op: "has", value: "-" })),
      // the fields inside `ability( … )` come from the ability rows, not from the group files
      ...(abilityPart ? [{ ability: { and: abilityPart.split(",").filter(Boolean).map((field): Node => ({ field, op: "has", value: "-" })) } } as Node] : []),
    ] };
    void resolveCatalogue(searchContext, resolveLoader, need).then((r) => {
      if (!live) return;
      setResolved({ core: searchContext, key: needKey, state: r.state, ctx: r.state === "ready" ? withEveryCreatureType(r.ctx, index, vocabulary) : r.ctx });
    });
    return () => { live = false; };
  }, [searchContext, index, vocabulary, needKey, resolveLoader, attempt]);
  const resolvedNow = resolved !== null && resolved.core === searchContext && resolved.key === needKey ? resolved : null;
  const catalogueCtx = resolvedNow?.state === "ready" ? resolvedNow.ctx : null;
  // KEEPING CHANGELINGS ONLY MATTERS FOR A NOT THAT IS A CREATURE TYPE, which the catalogue's list says. Until it has
  // loaded that is unknown, and unknown is not blocking: the list answers from the rows meanwhile.
  const hiddenTypeNames = useMemo((): string[] => {
    const list = catalogueCtx?.namedLists["creature"]?.values;
    return list === undefined ? [] : notSubtypes.filter((n) => list.includes(n));
  }, [catalogueCtx, notSubtypes]);
  const catalogueState: "none" | "pending" | "ready" | "no-pointer" | "failed" | "incomplete" =
    needKey === null ? "none" : resolvedNow === null ? "pending" : resolvedNow.state;
  // KEEPING CHANGELINGS WITH A NOT SUBTYPE CANNOT BE ANSWERED WITHOUT THE CREATURE LIST, so until it is known the page
  // waits (loading line) or says the read failed (retry): a list that quietly lost the changeling the link asked to keep
  // is a wrong answer. Once the list is known it blocks only for a NOT that is a creature type. With no pointer the list
  // can never be known: it is shown without them, and says so (`changelingsUnmatched`).
  const keepAsked = eventQuery.keepChangelings === true && notSubtypesAsked;
  const keepUnresolved = keepAsked && (catalogueState === "pending" || catalogueState === "failed");
  const blocking = countsAsked || countSort !== null || keepUnresolved || (keepAsked && hiddenTypeNames.length > 0) || genericAsked || typedNeedsCatalogue;
  // WHICH QUESTION THE WORDS ARE ABOUT: type counts and the changeling note have their own, a catalogue row the general one.
  const typeQuestion = countsAsked || countSort !== null || keepAsked;
  // A QUESTION WITH `ability( … )` (typed, or the builder's switch) reads the ability rows, a file of its own.
  const abilityScoped = (typedShape !== null && usesAbilityScope(typedShape)) || (eventQuery.sameAbility === true && !typedActive && fieldFilters.some((f) => abilityFields.has(f.field)));
  // A LINK'S FIELD IS JUDGED AGAINST THE CATALOGUE ITSELF, so the page waits for it too: an incomplete read must not say
  // "can't answer" for a moment and "doesn't know" the next.
  const catalogueSettled = !(genericAsked || typedActive) || catalogueInfo.state === "ready" || catalogueInfo.state === "none" || catalogueInfo.state === "failed";
  // WHAT A LINK ASKS THAT THE CATALOGUE DOES NOT HOLD: a field, a value of a set field, or the wrong kind of question for
  // the field. One line each, said where the answer would be; the list is not drawn (an unknown is not an empty answer).
  const unknownLines = useMemo((): string[] => {
    const out = new Set<string>();
    // AN ANY-OF OR NOT WORD THE VOCABULARY LACKS is said, not ignored: the group would otherwise answer with the words it knows
    // and look complete. A table that has not loaded yet knows nothing, so it is not judged.
    for (const [kind, words, table] of [
      ["type", [...eventQuery.types, ...(eventQuery.orTypes ?? []), ...(eventQuery.notTypes ?? [])], vocabulary.types],
      ["subtype", [...eventQuery.subtypes, ...(eventQuery.orSubtypes ?? []), ...(eventQuery.notSubtypes ?? [])], vocabulary.subtypes],
      ["keyword", [...eventQuery.keywords, ...(eventQuery.orKeywords ?? []), ...(eventQuery.notKeywords ?? [])], vocabulary.keywords],
    ] as const) {
      if (table.length === 0) continue;
      for (const w of words) if (!table.includes(w)) out.add(`This build doesn't know the ${kind} "${w}".`);
    }
    if (catalogueInfo.cat !== null) {
      for (const f of fieldFilters) {
        const def = catalogueFields.get(f.field);
        const name = def ? (def.label ?? f.field) : f.field;
        if (!def) out.add(`This build doesn't know ${f.field}.`);
        else if (f.op === "range") { if (def.kind !== "number") out.add(`This build reads ${name} as a list of values, so a range does not apply.`); }
        else if (def.kind !== "set") out.add(`This build reads ${name} as a number, so the value "${f.value}" does not apply.`);
        // A VALUE THE REGISTRY HAS A LABEL FOR IS KNOWN even when no card holds it in this build (the build drops empty values).
        else if (!(def.values ?? []).some((v) => v.v === f.value) && !(f.value in (def.valueLabels ?? {}))) out.add(`This build doesn't know the value "${f.value}" for ${name}.`);
      }
    }
    return [...out];
  }, [catalogueInfo.cat, catalogueFields, fieldFilters, eventQuery.types, eventQuery.subtypes, eventQuery.keywords, eventQuery.orTypes, eventQuery.orSubtypes, eventQuery.orKeywords, vocabulary]);
  const changelingsUnmatched = keepAsked && (catalogueState === "no-pointer" || catalogueState === "incomplete");
  const typeCountsBlocked = blocking && (catalogueState === "pending" || !catalogueSettled);
  // NO POINTER AND AN INCOMPLETE CATALOGUE both say the build cannot answer; a failed read says so differently, with a retry.
  const typeCountsMissing = blocking && (catalogueState === "no-pointer" || catalogueState === "incomplete");
  const typeCountsFailed = blocking && catalogueState === "failed";
  const evalCtx = blocking ? catalogueCtx : searchContext;
  // A CANNOT-ANSWER IS NOT A ZERO MASK: it is said, and the list is not drawn.
  const characteristic = useMemo((): { mask: Uint8Array | null; cannotAnswer: boolean } => {
    if (index === null || evalCtx === null) return { mask: null, cannotAnswer: false };
    if (typedActive) {
      // THE TYPED QUESTION: its events are the member lists already read, joined as `rows` leaves.
      const creature = evalCtx.namedLists["creature"]?.values;
      const asked = typedAst !== null && eventQuery.keepChangelings === true && creature ? keepTyped(typedAst, new Set(creature)) : typedAst;
      const node = asked === null ? null : toNode(asked, (side, key) => {
        const m = lists.get(key);
        return m ? (side === "makes" ? m.p : m.c) : undefined;
      });
      if (node === null) return { mask: null, cannotAnswer: false };
      const res = evaluate(commanderMode ? { and: [{ op: "rows", rows: index.flatMap((r, i) => (r.commander ? [i] : [])) }, node] } : node, evalCtx);
      if (!res.ok) return { mask: null, cannotAnswer: true };
      const mask = new Uint8Array(index.length);
      for (const r of res.rows) mask[r] = 1;
      return { mask, cannotAnswer: false };
    }
    const res = evaluateEventQuery(index, vocabulary, eventQuery, mode, { commandersOnly: commanderMode, context: evalCtx, abilityFields });
    if (!res.ok) return { mask: null, cannotAnswer: true };
    const mask = new Uint8Array(index.length);
    for (const r of res.rows) mask[r] = 1;
    return { mask, cannotAnswer: false };
  }, [index, evalCtx, vocabulary, eventQuery, mode, commanderMode, typedActive, typedAst, lists, abilityFields]);
  const characteristicMask = characteristic.mask;
  const filtersUnanswerable = characteristic.cannotAnswer;
  // THE SAME QUESTION WITH CHANGELINGS KEPT, to count what the NOT creature type hid.
  const keepMask = useMemo((): Uint8Array | null => {
    if (index === null || catalogueCtx === null || hiddenTypeNames.length === 0) return null;
    let res: ReturnType<typeof evaluate>;
    if (typedActive) {
      // THE TYPED QUESTION WITH CHANGELINGS KEPT, to count what its NOT creature types hid.
      const creature = catalogueCtx.namedLists["creature"]?.values;
      const node = typedAst === null || !creature ? null : toNode(keepTyped(typedAst, new Set(creature)), (side, key) => {
        const m = lists.get(key);
        return m ? (side === "makes" ? m.p : m.c) : undefined;
      });
      if (node === null) return null;
      res = evaluate(commanderMode ? { and: [{ op: "rows", rows: index.flatMap((r, i) => (r.commander ? [i] : [])) }, node] } : node, catalogueCtx);
    } else {
      res = evaluateEventQuery(index, vocabulary, { ...eventQuery, keepChangelings: true }, mode, { commandersOnly: commanderMode, context: catalogueCtx, abilityFields });
    }
    if (!res.ok) return null;
    const mask = new Uint8Array(index.length);
    for (const r of res.rows) mask[r] = 1;
    return mask;
  }, [index, catalogueCtx, hiddenTypeNames, vocabulary, eventQuery, mode, commanderMode, typedActive, typedAst, lists, abilityFields]);
  const fitCard = useCallback((entries: NameIndexEntry[], using: Uint8Array | null = characteristicMask): NameIndexEntry[] => {
    if (using === null) return [];
    const named = needle.length === 0 ? entries : matchNames(entries, { query });
    return named.filter((e) => using[positionOf.get(e) ?? -1] === 1);
  }, [needle, query, characteristicMask, positionOf]);
  // HOW MANY CARDS THE FILTERS COULD NOT JUDGE (review of 160d353): on an asked event by what they
  // are -- cast, entering, lifelink -- rather than by an ability. Left out, and said so.
  // THE CARDS THE FILTERS LEFT OUT, as index rows (before the card predicates). The count, and the
  // list when `skipped` is set, both start from these, so the two cannot disagree.
  const leftOut = useMemo((): NameIndexEntry[] => {
    if (index === null || !asked || keptIds === undefined) return [];
    return unjudgedLeftOut(terms, lists, eventQuery)
      .map((id) => index[id]).filter((e): e is NameIndexEntry => e !== undefined);
  }, [terms, lists, eventQuery, index, asked, keptIds]);
  const unjudgedCount = useMemo(() => fitCard(leftOut).length, [leftOut, fitCard]);
  // THE SKIPPED VIEW STAYS ON through a name or colour change (an empty one says so); it applies only
  // while something is left out at all, and `setEffects` drops it when the terms or effect rows change.
  const showSkipped = eventQuery.skipped === true && leftOut.length > 0;
  const unanswerable = effectUnanswerable || (chosenKeys.length > 0 && chosenKeys.every((k) => lists.has(k))
    && chosenKeys.some((k) => lists.get(k) === null));

  // ONE RULE WITH THE HEADER FIELD. `matchNames` is the rule; this page adds the commander and
  // colour predicates the header does not offer, and the events narrow that answer by position.
  // THE ROWS THE EVENTS (AND A SKIPPED VIEW) LEAVE, before the card-level predicates.
  const baseEntries = useMemo((): NameIndexEntry[] | null => {
    if (index === null || !asked || keptIds === undefined) return null;
    return showSkipped ? leftOut : keptIds === null ? index
      : (keptIds.keep === null ? index : [...keptIds.keep].map((id) => index[id]))
        .filter((e): e is NameIndexEntry => e !== undefined)
        .filter((e) => keptIds.drop.size === 0 || !keptIds.drop.has(positionOf.get(e) ?? -1));
  }, [index, asked, keptIds, showSkipped, leftOut, positionOf]);
  // HOW MANY CHANGELINGS A NOT-CREATURE-TYPE HID: those the same question answers once they are kept, minus those it answers now.
  const hiddenChangelings = useMemo((): number => {
    if (baseEntries === null || keepMask === null || eventQuery.keepChangelings === true) return 0;
    return fitCard(baseEntries, keepMask).length - fitCard(baseEntries).length;
  }, [baseEntries, keepMask, fitCard, eventQuery.keepChangelings]);
  // WHAT EACH COUNT SAYS OF EACH ROW, for the order and for the tile's own line.
  const countsBy = useMemo((): Partial<Record<TypeCountSort, Uint32Array>> => {
    if (catalogueCtx === null) return {};
    const out: Partial<Record<TypeCountSort, Uint32Array>> = {};
    for (const c of TYPE_COUNTS) {
      const wanted = countSorts.includes(c.sort) || (c.sort === "creaturetypes" && (eventQuery.creatureTypesMin !== undefined || eventQuery.creatureTypesMax !== undefined));
      const v = wanted ? rowCountsOf(catalogueCtx, c.sort) : null;
      if (v) out[c.sort] = v;
    }
    return out;
  }, [catalogueCtx, countSorts, eventQuery.creatureTypesMin, eventQuery.creatureTypesMax]);
  const everyCreatureType = useMemo(
    () => new Set(catalogueCtx?.columns.get("everyCreatureType") ? (catalogueCtx.columns.get("everyCreatureType") as { values: Map<string, number[]> }).values.get("true") ?? [] : []),
    [catalogueCtx]);
  const matches = useMemo((): NameIndexEntry[] | null => {
    if (index === null || !asked) return [];
    if (typed?.status === "pending") return null;
    if (typed !== null && typed.status !== "ok") return [];
    if (typeCountsBlocked) return null;
    if (typeCountsMissing || typeCountsFailed || filtersUnanswerable || unknownLines.length > 0) return [];
    if (keptIds === undefined) return null;
    const base = baseEntries;
    if (base === null) return null;
    const kept = fitCard(base);
    // AMONG CARDS THAT ALL ANSWER THE QUESTION, THE BETTER-CONNECTED ONE FIRST (owner 2026-09-17),
    // and that stays the default. The other two orders exist so a reader can ESCAPE that ranking:
    // the deck-build run found rare events outranking good cards and could only reach staples "by
    // already knowing their names and typing them in". A sort does not fix the ranking; it stops
    // the ranking being the only way through the list.
    const byName = (a: NameIndexEntry, b: NameIndexEntry): number => a.name.localeCompare(b.name, "en");
    // A CAUSE-LESS `effect` MEASURES NOTHING and reads as connections, in any place of the order (`orderOf` says it for the first key).
    const effective = (k: SortKey): SortKey => (k === "effect" && eventQuery.produce.length === 0 ? "partners" : k);
    // THE KEYS, FIRST TO LAST (#1787). Rows a key leaves tied go to the next; rows every key leaves tied go to the name, A to Z,
    // which is also all a single key ever fell back to, so a link with one key orders as it always did.
    const chain = [{ sort: orderOf(eventQuery), dir: eventQuery.dir }, ...(eventQuery.thenBy ?? [])].map((k) => ({ sort: effective(k.sort), dir: k.dir }));
    // HOW MUCH IT DOES (owner 2026-09-23, AN3): each cause's list ships best doer first
    // (`effectOrder` in the build), so a card's place in it IS the measurement. Asked two causes,
    // the WEAKER place governs -- a card has to do both, and doing one superbly does not make up
    // for doing the other badly. CEILING: a fraction of each list's length, so a long list and a
    // short one weigh alike; the upgrade path is shipping the order's own keys.
    const place = !chain.some((k) => k.sort === "effect") ? null : (() => {
      const at = eventQuery.produce.map((k) => {
        const p = lists.get(k)?.p ?? [];
        return new Map(p.map((id, i) => [id, i / p.length] as const));
      });
      return (e: NameIndexEntry): number => Math.max(...at.map((m) => m.get(positionOf.get(e) ?? -1) ?? 1));
    })();
    // A MISSING NUMBER SORTS LAST IN EITHER DIRECTION: a card that prints no power (the index omits
    // `*` and `X` the same way) is not a zero, and turning the order round must not bring the
    // unprinted to the top. Two missing numbers are a tie, which the next key settles.
    const byNumber = (sign: number, v: (e: NameIndexEntry) => number | undefined) =>
      (a: NameIndexEntry, b: NameIndexEntry): number => {
        const av = v(a); const bv = v(b);
        if (av === undefined) return bv === undefined ? 0 : 1;
        if (bv === undefined) return -1;
        return sign * (av - bv);
      };
    const cmpOf = (k: { sort: SortKey; dir?: "asc" | "desc" }): ((a: NameIndexEntry, b: NameIndexEntry) => number) => {
      const sign = (k.dir ?? NATURAL_DIR[k.sort]) === "asc" ? 1 : -1;
      if (k.sort === "effect" && place) return (a, b) => -sign * (place(a) - place(b)) || (b.partners ?? 0) - (a.partners ?? 0);
      if (k.sort === "name") return (a, b) => sign * byName(a, b);
      if (k.sort === "mv") return byNumber(sign, (e) => e.mv ?? 0);
      if (k.sort === "pow") return byNumber(sign, (e) => e.pow);
      if (k.sort === "tou") return byNumber(sign, (e) => e.tou);
      const count = TYPE_COUNTS.some((c) => c.sort === k.sort) ? countsBy[k.sort as TypeCountSort] : undefined;
      if (TYPE_COUNTS.some((c) => c.sort === k.sort)) return byNumber(sign, (e) => count?.[positionOf.get(e) ?? -1]);
      return byNumber(sign, (e) => e.partners ?? 0);
    };
    const cmps = chain.map(cmpOf);
    return [...kept].sort((a, b) => {
      for (const c of cmps) { const r = c(a, b); if (r !== 0) return r; }
      return byName(a, b);
    });
  }, [index, typed, keptIds, asked, eventQuery, lists, positionOf, fitCard, baseEntries, countsBy, typeCountsBlocked, typeCountsMissing, typeCountsFailed, filtersUnanswerable, unknownLines]);
  // WHAT "Back to the N matches" RETURNS TO: the normal list's size, without sorting it.
  const normalCount = useMemo((): number => {
    if (!showSkipped || index === null || keptIds === undefined || keptIds === null) return 0;
    const base = (keptIds.keep === null ? index : [...keptIds.keep].map((id) => index[id]))
      .filter((e): e is NameIndexEntry => e !== undefined)
      .filter((e) => keptIds.drop.size === 0 || !keptIds.drop.has(positionOf.get(e) ?? -1));
    return fitCard(base).length;
  }, [showSkipped, index, keptIds, positionOf, fitCard]);

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

  // ONE ROW PER EVENT, NARROWED ONLY WHEN ASKED (owner, 2026-09-29: "appending the card type or
  // subtype to the event in search is redundant"). An index built with patterns (`event-pattern.ts`)
  // offers each event once -- `dies|*|*|*` -- and the targets it can be narrowed to beside the term;
  // one built before them keeps offering its keys as it always did, so an old artifact still searches.
  const patterned = useMemo(() => freq !== null && Object.keys(freq.consume).some(isPattern), [freq]);
  const offered = (k: string): boolean => !patterned || (isPattern(k) && narrowingOf(k) === null);
  const produceOptions = useMemo(
    () => (freq === null ? [] : Object.keys(freq.supply).filter((k) => (freq.supply[k] ?? 0) > 0 && k in freq.byIdentity && offered(k))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [freq, patterned]);
  const consumeOptions = useMemo(
    () => (freq === null ? [] : Object.keys(freq.consume).filter((k) => (freq.consume[k] ?? 0) > 0 && offered(k))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [freq, patterned]);
  // THE TARGETS A TERM CAN BE NARROWED TO: every one-slot pattern the index ships.
  const narrowOptions = useMemo(
    () => (freq === null || !patterned ? [] : [...new Set([...Object.keys(freq.supply), ...Object.keys(freq.consume)])]
      .filter((k) => isPattern(k) && narrowingOf(k) !== null && !NO_TARGET.has(verbOfKey(k)))),
    [freq, patterned]);

  // THE CAP IS A PAGE (UX review, 2026-09-17). "467 match, showing the first 50" with no way to the
  // rest was a dead end; each press shows another fifty, and a new question starts over.
  const [browseGrid, browseCols] = useGridColumns();
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
            <legend className="eyebrow">Color identity</legend>
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
            notTypes={eventQuery.notTypes ?? []}
            notSubtypes={eventQuery.notSubtypes ?? []}
            anyTypes={eventQuery.orTypes ?? []}
            anySubtypes={eventQuery.orSubtypes ?? []}
            onChange={(next) => {
              // A NOT OR ANY-OF LIST IS ABSENT WHEN EMPTY, as the URL leaves it.
              const { notTypes: _a, notSubtypes: _b, orTypes: _c, orSubtypes: _d, ...rest } = eventQuery;
              setEvents({ ...rest, types: next.types, subtypes: next.subtypes,
                ...((next.notTypes?.length ?? 0) > 0 ? { notTypes: next.notTypes! } : {}),
                ...((next.notSubtypes?.length ?? 0) > 0 ? { notSubtypes: next.notSubtypes! } : {}),
                ...((next.anyTypes?.length ?? 0) > 0 ? { orTypes: next.anyTypes! } : {}),
                ...((next.anySubtypes?.length ?? 0) > 0 ? { orSubtypes: next.anySubtypes! } : {}) });
            }}
          />
        );
      /* KEYWORDS ARE A TYPEAHEAD, NOT CHIPS, for the same reason the subtypes are: 811 of them.
       * Same control, a different vocabulary. */
      case "keywords":
        return (
          <WordPicker
            label="Keywords"
            listLabel="Keywords"
            placeholder="Flying, trample, deathtouch…"
            all={vocabulary.keywords}
            chosen={eventQuery.keywords}
            negated={eventQuery.notKeywords ?? []}
            anyOf={eventQuery.orKeywords ?? []}
            onChange={(next) => setEvents({ ...eventQuery, keywords: next })}
            onMove={(name, to) => {
              const { notKeywords: _n, orKeywords: _o, ...rest } = eventQuery;
              const without = (xs: string[] | undefined) => (xs ?? []).filter((w) => w !== name);
              const must = to === "and" ? [...without(eventQuery.keywords), name] : without(eventQuery.keywords);
              const nots = to === "not" ? [...without(eventQuery.notKeywords), name] : without(eventQuery.notKeywords);
              const any = to === "any" ? [...without(eventQuery.orKeywords), name] : without(eventQuery.orKeywords);
              setEvents({ ...rest, keywords: must, ...(nots.length > 0 ? { notKeywords: nots } : {}), ...(any.length > 0 ? { orKeywords: any } : {}) });
            }}
            onRemoveNegated={(name) => {
              const { notKeywords: _n, ...rest } = eventQuery;
              const nots = (eventQuery.notKeywords ?? []).filter((w) => w !== name);
              setEvents({ ...rest, ...(nots.length > 0 ? { notKeywords: nots } : {}) });
            }}
            onRemoveAny={(name) => {
              const { orKeywords: _o, ...rest } = eventQuery;
              const any = (eventQuery.orKeywords ?? []).filter((w) => w !== name);
              setEvents({ ...rest, ...(any.length > 0 ? { orKeywords: any } : {}) });
            }}
          />
        );
      /* WHAT THE CARD IS, which is NOT the identity row above it. 1,751 of 32,334 cards answer the
       * two differently -- the gap Scryfall splits `c:` from `id:` for. */
      case "cardColours":
        return (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="eyebrow">Color</legend>
            {COLOURS.map(([code, label]) => {
              const on = eventQuery.cardColours.includes(code);
              return (
                <button
                  key={code} type="button" aria-pressed={on}
                  onClick={() => setEvents({ ...eventQuery, cardColours: on
                    ? eventQuery.cardColours.filter((c) => c !== code)
                    : code === "C" ? ["C"] : [...eventQuery.cardColours.filter((c) => c !== "C"), code] })}
                  className="chip"
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    <ManaSymbols cost={`{${code}}`} />
                  </span>
                  {label}
                </button>
              );
            })}
          </fieldset>
        );
      case "typeCounts":
        return <TypeCountRow query={eventQuery} onChange={setEvents} />;
      case "mv":
        return (
          <RangeRow
            label="Mana value"
            min={eventQuery.mvMin} max={eventQuery.mvMax}
            onChange={(r) => setEvents({ ...eventQuery, mvMin: r.min, mvMax: r.max })}
          />
        );
      case "power":
        return (
          <RangeRow
            label="Power"
            min={eventQuery.powMin} max={eventQuery.powMax}
            onChange={(r) => setEvents({ ...eventQuery, powMin: r.min, powMax: r.max })}
          />
        );
      case "toughness":
        return (
          <RangeRow
            label="Toughness"
            min={eventQuery.touMin} max={eventQuery.touMax}
            onChange={(r) => setEvents({ ...eventQuery, touMin: r.min, touMax: r.max })}
          />
        );
      case "abilityKind":
        return (
          <AbilityKindRow
            chosen={eventQuery.abilityKinds ?? []}
            onChange={(next) => { const { abilityKinds: _a, ...rest } = eventQuery; setEffects(next.length > 0 ? { ...rest, abilityKinds: next } : rest); }}
          />
        );
      case "repeats":
        return (
          <RepeatsRow
            min={eventQuery.repeatsMin}
            onChange={(next) => { const { repeatsMin: _a, ...rest } = eventQuery; setEffects(next !== undefined ? { ...rest, repeatsMin: next } : rest); }}
          />
        );
      case "amount":
        return (
          <AmountRow
            min={eventQuery.amountMin} max={eventQuery.amountMax} variable={eventQuery.amountVariable === true}
            change={eventQuery.amountChange}
            caresAbout={terms.some((t) => t.side === "pays" && t.op !== "not")}
            onChange={(r) => {
              const { amountMin: _a, amountMax: _b, amountVariable: _c, amountChange: _d, ...rest } = eventQuery;
              setEffects({ ...rest, ...(r.min !== undefined ? { amountMin: r.min } : {}),
                ...(r.max !== undefined ? { amountMax: r.max } : {}), ...(r.variable ? { amountVariable: true } : {}),
                ...(r.change !== undefined ? { amountChange: r.change } : {}) });
            }}
          />
        );
      /* THE EVENTS ARE ASKED BY THE SENTENCE, not by a row (owner, 2026-09-27); these two kinds
       * stay kinds so a link's question is still "asked", and are never drawn as rows. */
      case "produce":
      case "consume":
        return <></>;
    }
  };

  const browsing = browseCount(browseCols);
  return (
    <PeekContext.Provider value={peek}>
    {/* THE LIST IS A GRID OF TILES NOW, so the reading measure that bounded a column of names would
      * bound a grid to three tiles; the header and the prose keep their own 65ch. */}
    {/* THE RAIL EXISTS ONLY WHILE A CARD IS PEEKED. Reserving its 20rem always left the landing
      * page a 650px column with the right two thirds of a 1920 screen empty (UX review, 2026-09-17). */}
    <div className={peek.stack.length > 0 ? "lg:pr-(--rail-w)" : undefined}>
    <section className="flex flex-col gap-6">
      {/* ONLY `/cards` EVER CARRIED A SHARE LINK. `/commanders` is a new path, so there is no
        * stale link to catch and nothing to redirect. */}
      {!commanderMode && (
        <LegacyDeckRedirect to="/analysis/cards" {...(hash !== undefined ? { hash } : {})}
          {...(replace !== undefined ? { replace } : {})} />
      )}
      {/* THE CONTROLS AS TWO COLUMNS FROM 1600px (designer review 2026-09-30, #770): stacked, the
        * title, the name box, "Cards that + add" and "Add a filter" were a narrow left column with
        * 75-85% of a 2560 screen blank beside it, and pushed the grid to one visible row at 1920.
        * The name on the left, the question on the right. */}
      <div className="flex flex-col gap-6 min-[100rem]:grid min-[100rem]:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] min-[100rem]:gap-x-16 min-[100rem]:items-start">
      <div className="flex flex-col gap-6 min-w-0">
      <header className="flex flex-col gap-3">
        {/* THE LABEL IS NOT THE PAGE. "Cards" at 48px was the largest thing on a screen whose real
          * lead is the box you type in -- a generic noun out-ranking the only control that does
          * anything. */}
        <h1 className="t-title">
          {commanderMode ? "Commanders" : "Cards"}
        </h1>
        <p className="text-(--muted) max-w-[65ch]">
          {commanderMode
            ? "Look up any commander to see what it does and the cards in its colors it works best with."
            : "Look up any card to see what it does, what it's looking for, and the cards it's most tightly linked to."}
        </p>
      </header>

      {/* NO KICKER: the label pairs INLINE with the field rather than stacking above it. */}
      <label className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="eyebrow text-(--muted)">{commanderMode ? "find a commander" : "find a card"}</span>
        <input
          type="search" autoFocus value={text} onChange={(e) => setText(e.target.value)}
          // A PLACEHOLDER THAT READS AS AN EXAMPLE, NOT AN ENTRY (#760): a bare real card name at
          // 5.9:1 on the field ground was taken for something already typed, and two persona seats
          // concluded the search was broken without typing. "e.g." and italic say it is a sample.
          placeholder={commanderMode ? "e.g. Kess, Dissident Mage" : "e.g. Krenko, Mob Boss"}
          // A CONTROL'S BOUNDARY IS `--field-border`, which is the 3:1 one (WCAG 1.4.11).
          // `--border` does not exist: it was absorbed into `--separator`, the decorative hairline,
          // and `css-tokens.test.ts` caught this line naming it.
          className="w-full max-w-lg min-h-11 rounded-(--field-radius) border border-(--field-border) bg-(--field-background)
            text-(--field-foreground) placeholder:text-(--field-placeholder) placeholder:italic px-3"
        />
      </label>
      </div>
      <div className="flex flex-col gap-6 min-w-0">

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
      {/* THE QUESTION, AS A SENTENCE (owner, 2026-09-27: mockup B). Always drawn, so "+ add" is where
        * a reader starts asking what a card does; the rows below are what it IS and what it costs. */}
      <TypedQuery
        value={typedText} onChange={setTypedText} names={typedNames} noun={commanderMode ? "commanders" : "cards"}
        error={typed?.status === "error" ? typed.error : null}
        leftOut={builderLeavesOut}
      />
      {/* A SORT THE LINK ASKED FOR AND NO ORDER ANSWERS IS SAID, not dropped (#1787). The keys that are known still apply. */}
      {(eventQuery.sortIssues?.length ?? 0) > 0 && (
        <ul role="status" aria-label="Problems with the order in this link" className="list-none p-0 m-0 flex flex-col gap-1 text-(--muted) text-sm">
          {eventQuery.sortIssues!.map((m) => <li key={m}>{m}</li>)}
        </ul>
      )}
      {typedActive ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-(--muted) text-sm">The typed query is the question, so the filter rows are paused.</p>
          <button type="button" className="chip" onClick={() => setTypedText("")}>Back to the filters</button>
        </div>
      ) : (<>
      <EventSentence
        terms={terms}
        colours={colours}
        noun={commanderMode ? "commanders" : "cards"}
        makes={produceOptions}
        pays={consumeOptions}
        narrowings={narrowOptions}
        makesCount={countOf}
        paysCount={consumeCountOf}
        demand={consumeCountOf}
        onChange={(next) => setEffects(withTerms(eventQuery, next))}
        onRemoveColour={(c) => setColours((cs) => cs.filter((x) => x !== c))}
        onOpen={() => setSentenceOpened(true)}
      />
      <div className="facets flex flex-col gap-4">
        {(shownKinds.length > 0 || fieldRows.length > 0) && (
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
            {fieldRows.map((id) => {
              const def = catalogueFields.get(id);
              const name = def?.label ?? id;
              return (
                <li key={`field:${id}`} className="flex flex-wrap items-end gap-x-3 gap-y-2">
                  <div className="min-w-0">
                    <FieldRow id={id} field={def} filters={fieldFilters.filter((f) => f.field === id)} onChange={(next) => setFieldFilters(id, next)} />
                  </div>
                  <button type="button" className="chip" aria-label={`Remove the ${name} filter`} onClick={() => dropField(id)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                      <path d="M18 6 6 18M6 6l12 12" />
                    </svg>
                    Remove
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {/* SAME ABILITY (#1786): the builder's way to `ability( … )`. Offered once two of the ability rows could be asking about different abilities. */}
        {(eventQuery.sameAbility === true || abilityMustRows >= 2) && (
          <label className="flex items-start gap-2 text-sm min-w-0">
            <input
              type="checkbox" className="mt-1"
              checked={eventQuery.sameAbility === true}
              onChange={(e) => {
                const { sameAbility: _s, ...without } = eventQuery;
                setEffects(e.target.checked ? { ...without, sameAbility: true } : without);
              }}
            />
            <span className="min-w-0">Hold the ability-field rows above to one ability</span>
          </label>
        )}
        {/* A NATIVE `<details>`, so the keyboard and screen-reader model is the platform's -- the
          * same reason the panel it replaces was one. It closes itself once a row is added,
          * because a menu still standing over the control it just created is in the way. */}
        {(available.length > 0 || offeredFields.length > 0 || catalogueInfo.state === "loading" || catalogueInfo.state === "failed") && (
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
              {/* THE CATALOGUE'S FIELDS (#1782): whatever the build holds that no row above covers, listed from its data.
                * Labelled fields show normally; the rest are paths, so they wait behind a switch. */}
              {catalogueInfo.state === "loading" && <li className="site-search-note">Loading more filters…</li>}
              {catalogueInfo.state === "failed" && (
                <li className="site-search-note">
                  Couldn&apos;t load more filters.
                  <button type="button" className="chip" onClick={() => setCatAttempt((n) => n + 1)}>Try again</button>
                </li>
              )}
              {(menuUnlabelled.length > 0 || advanced) && (
                <li>
                  <label className="site-search-row cursor-pointer">
                    <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                    Advanced fields
                  </label>
                </li>
              )}
              {[...menuLabelled, ...(advanced ? menuUnlabelled : [])].map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="site-search-row w-full text-left"
                    onClick={() => { setFieldRows((rs) => [...rs, f.id]); setMenuOpen(false); }}
                  >
                    {f.label ?? f.id}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      </>)}
      </div>
      </div>

      {index === null
        ? <p className="text-(--muted)">Loading cards…</p>
        : !asked
        // AN EMPTY QUERY IS NOT AN EMPTY PAGE and not the whole corpus either: it says what is here
        // and waits. A bare box with nothing under it reads as a page that failed to load.
        // AN EMPTY QUERY OWNS THE SPACE IT IS IN rather than leaving a bare box above a screen of
        // nothing. It says what is here, in the figure that makes the claim concrete.
        ? <div className="flex flex-col gap-2 pt-6">
            {/* THE COUNT AND THE EXAMPLES SHARE A ROW FROM 1600px (#770), so the grid starts higher. */}
            <div className="flex flex-col gap-2 min-[100rem]:flex-row min-[100rem]:items-end min-[100rem]:gap-16">
            {/* ONE WIDTH ON BOTH PAGES (designer crawl 2026-10-03, #994 item 6): sized by its own
              * sentence, the block put "or ask" at x 438 on /cards and 651 on /commanders. */}
            <div className="flex flex-col gap-2 min-[100rem]:w-[55ch] min-[100rem]:shrink-0">
            {/* ON A PHONE THE COUNT JOINS ITS SENTENCE (designer review 2026-09-30, #770): as a 30px
              * figure on its own line it pushed the first tiles below a 390px screen on /commanders. */}
            <p className="hidden sm:block text-3xl font-bold tracking-[-0.01em] tabular-nums">
              {(commanderMode ? index.filter((e) => e.commander).length : index.length).toLocaleString("en-US")}
            </p>
            <p className="text-(--muted) max-w-[55ch]">
              <b className="sm:hidden text-(--foreground) tabular-nums">{(commanderMode ? index.filter((e) => e.commander).length : index.length).toLocaleString("en-US")}{" "}</b>
              {commanderMode
                // The colour picker is one "Add a filter" away, not on screen, so the sentence
                // names the control that is (UI review 2026-09-25).
                // "WITH A PAGE HERE" (review round 4, #14): the home page says 28,416 cards read of
                // 34,433, this page counted 25,837, the sitemap another -- each right for its own
                // definition, and a reader saw the tool disagree with itself. This one is the index.
                ? "commanders with a page here. Type a name, or add a filter to pick colours."
                : "cards with a page here. Type a name to start."}
            </p>
            </div>
            <div className="flex flex-col gap-2">
            <p className="eyebrow text-(--muted) mt-4 min-[100rem]:mt-0">or ask, for example</p>
            <ul className="flex flex-wrap gap-2 list-none p-0 m-0 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:-mx-(--gutter) max-sm:px-(--gutter) max-sm:[scrollbar-width:none] [&>li]:shrink-0" aria-label="Example questions">
              {EXAMPLES[mode].map((ex) => (
                <li key={ex.label}>
                  <button type="button" className="chip" onClick={() => setEvents(ex.q)}>{ex.label}</button>
                </li>
              ))}
            </ul>
            </div>
            </div>
            {/* SOMETHING TO BROWSE BEFORE ANYTHING IS ASKED (UI review 2026-09-25). The prompt above
              * filled the left 500px of a 1920px screen and left the rest black, and a reader with no
              * name in mind had nowhere to start. The index ships ordered by partner count (#368),
              * so its head IS the most connected cards; no ranking is invented here. */}
            <h2 className="eyebrow text-(--muted) mt-6 sm:mt-8">
              {commanderMode ? "Commanders that work with the most cards" : "Cards that work with the most others"}
            </h2>
            <ul ref={browseGrid} aria-label={commanderMode ? "Commanders that work with the most cards" : "Cards that work with the most others"} className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-3 gap-y-6 sm:gap-x-4 list-none p-0 m-0">
              {(commanderMode ? index.filter((e) => e.commander) : index).slice(0, browsing).map((e) => (
                <li key={e.slug} className="min-w-0">
                  <CardTile
                    slug={e.slug} name={e.name} art={e.art} identity={e.identity}
                    to={`${commanderMode ? "/commanders" : "/cards"}/${e.slug}`}
                    note={!commanderMode && e.commander ? "commander" : undefined}
                  />
                </li>
              ))}
            </ul>
          </div>
        : typed?.status === "error"
        // A PROBLEM IN THE TEXT IS SAID UNDER THE BOX; no list stands in for it. A CANNOT-ANSWER has said so already, and
        // "fix the query" would be the wrong advice for it.
        ? (typed.error.cannot ? null : <p role="status" className="text-(--muted)">Fix the typed query above to see {commanderMode ? "commanders" : "cards"}.</p>)
        : typed?.status === "failed"
        ? <div className="flex flex-wrap items-center gap-3">
            <p role="status" className="text-(--muted)">Couldn&apos;t load filter data. Try again.</p>
            <button type="button" className="chip" onClick={() => setCatAttempt((n) => n + 1)}>Try again</button>
          </div>
        : unanswerable
        ? <p role="status" className="text-(--muted)">{effectUnanswerable
          ? "This site's card data predates the ability filters. Remove the ability type, how often and amount filters to search again."
          : "This site's card data can't answer one of those events. Remove it to search again."}</p>
        : unknownLines.length > 0
        // AN UNKNOWN IS NOT AN EMPTY ANSWER (#1782): the link names a field or value this build lacks, said once each.
        ? <div className="flex flex-col gap-1">
            {unknownLines.map((line) => <p key={line} role="status" className="text-(--muted)">{line}</p>)}
          </div>
        : typeCountsMissing
        // NO ANSWER IS NOT AN EMPTY ANSWER: an artifact built without the search catalogue cannot count types.
        ? <p role="status" className="text-(--muted)">{typeQuestion ? "This build can't answer type counts yet." : abilityScoped ? "This build can't match terms on one ability yet." : "This build can't answer one of those filters yet."}</p>
        : typeCountsFailed
        // A FAILED READ IS NOT "THIS BUILD CANNOT": it may work next time, so it offers the retry.
        ? <div className="flex flex-wrap items-center gap-3">
            <p role="status" className="text-(--muted)">{typeQuestion ? "Couldn't load type data. Try again." : abilityScoped ? "Couldn't load the ability data. Try again." : "Couldn't load filter data. Try again."}</p>
            <button type="button" className="chip" onClick={() => { setResolved(null); setAttempt((n) => n + 1); setCatAttempt((n) => n + 1); }}>Try again</button>
          </div>
        : filtersUnanswerable
        ? <p role="status" className="text-(--muted)">This build can&apos;t answer one of those filters yet.</p>
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
                {matches.length === 0 && showSkipped
                  ? <>None of the skipped cards fit these filters.</>
                  : matches.length === 0
                  ? <>No {commanderMode ? "commander" : "card"} matches. We know{" "}
                      {index.length.toLocaleString("en-US")} cards, and one we don&apos;t know yet has no page.</>
                  : <>{matches.length.toLocaleString("en-US")}{" "}
                      {matches.length === 1
                        ? (commanderMode ? "commander matches" : "card matches")
                        : (commanderMode ? "commanders match" : "cards match")}
                      {matches.length > shown ? `, showing the first ${shown}` : ""}.</>}
                {(unjudgedCount > 0 || showSkipped) && (showSkipped
                  ? (matches.length === 0 ? null : <>{" "}These are the ones the ability filters skipped.</>)
                  : <>{" "}{unjudgedCount.toLocaleString("en-US")} more {unjudgedCount === 1 ? "card matches" : "cards match"} but
                    these filters can&apos;t judge {unjudgedCount === 1 ? "it" : "them"}: {unjudgedCount === 1 ? "it matches" : "they match"} because
                    of what {unjudgedCount === 1 ? "it is" : "they are"} (a keyword like lifelink, or simply entering or being
                    cast), or by an ability whose timing we can&apos;t tell.</>)}
              </p>
              {(unjudgedCount > 0 || showSkipped) && (
                <button
                  type="button" className="chip"
                  onClick={() => {
                    const { skipped: _s, ...rest } = eventQuery;
                    setEvents(showSkipped ? rest : { ...rest, skipped: true });
                  }}
                >
                  {showSkipped
                    ? (normalCount === 0 ? "Back to the results" : `Back to the ${normalCount.toLocaleString("en-US")} ${normalCount === 1 ? "match" : "matches"}`)
                    : unjudgedCount === 1 ? "Show this card" : `Show these ${unjudgedCount.toLocaleString("en-US")}`}
                </button>
              )}
              {/* THE ORDER NAMES ITS AXIS AND THE DIRECTION IS ITS OWN CONTROL (owner 2026-09-22):
                * "biggest first" did not say whether it meant power or toughness, and there was no
                * way to turn any order round. Changing the axis resets the direction to its
                * natural end rather than carrying "lowest first" from mana value into power. */}
              <div className="flex flex-col gap-2">
                {orderRows.map((row, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2">
                      <span className="eyebrow">{i === 0 ? "Order" : "Then by"}</span>
                      <select
                        className="field w-48 max-w-full"
                        aria-label={i === 0 ? undefined : `Then by, key ${i + 1}`}
                        value={row.sort ?? ""}
                        onChange={(e) => setOrderKey(i, e.target.value)}
                      >
                        {row.sort === null && <option value="">None</option>}
                        {i > 0 && row.sort !== null && <option value="">None (drop this one)</option>}
                        {ORDER_KEYS.filter((k) => (k !== "effect" || eventQuery.produce.length > 0) && (k === row.sort || !usedKeys.includes(k))).map((k) => (
                          <option key={k} value={k}>{ORDER_LABEL[k] ?? TYPE_COUNTS.find((c) => c.sort === k)?.label ?? k}</option>
                        ))}
                      </select>
                    </label>
                    {/* NO VISIBLE LABEL: the options read "Highest first" / "A to Z", which says it. */}
                    {row.sort !== null && (
                      <select
                        aria-label={i === 0 ? "Direction" : `Direction of key ${i + 1}`}
                        className="field w-36 max-w-full"
                        value={row.dir}
                        onChange={(e) => setOrderDir(i, e.target.value as "asc" | "desc")}
                      >
                        <option value="desc">{{ name: "Z to A", effect: "Most first" }[row.sort as string] ?? "Highest first"}</option>
                        <option value="asc">{{ name: "A to Z", effect: "Least first" }[row.sort as string] ?? "Lowest first"}</option>
                      </select>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {/* A CHANGELING IS EVERY CREATURE TYPE (CR 702.73a), so "not a Borg" hides it, and that is said, with the way
              * back. The count is of the cards the rest of the question would have kept. */}
            {hiddenChangelings > 0 && hiddenTypeNames.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-(--muted) text-sm">
                  {`${hiddenChangelings.toLocaleString("en-US")} ${hiddenChangelings === 1 ? "changeling" : "changelings"} hidden: a changeling has every creature type, ${typeNames(hiddenTypeNames)} included.`}
                </p>
                <button type="button" className="chip" onClick={() => setEvents({ ...eventQuery, keepChangelings: true })}>Show them</button>
              </div>
            )}
            {needsAcrossNote(abilityTerms) && (
              <p className="text-(--muted) text-sm">{ACROSS_ABILITIES_NOTE}</p>
            )}
            {changelingsUnmatched && !blocking && (
              <p className="text-(--muted) text-sm">Changelings can&apos;t be matched on this build.</p>
            )}
            {eventQuery.keepChangelings === true && hiddenTypeNames.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <p className="text-(--muted) text-sm">{`Changelings shown, though each has every creature type, ${typeNames(hiddenTypeNames)} included.`}</p>
                <button
                  type="button" className="chip"
                  onClick={() => { const { keepChangelings: _k, ...rest } = eventQuery; setEvents(rest); }}
                >Hide them</button>
              </div>
            )}
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
            <ul aria-label="Results" className="grid grid-cols-3 sm:grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-3 gap-y-6 sm:gap-x-4 list-none p-0 m-0">
              {matches.slice(0, shown).map((e) => {
                // WHY IT IS ON THE LIST, in the sentences that were asked. Every kept row answers
                // every term (the query ANDs), so the caption is the question rather than a
                // per-row computation over data this page no longer fetches.
                // THE `or` TERMS THAT HOLD FOR THIS CARD, not all of them: at least one does, and the
                // caption names which. `not` terms are absences and are not a reason.
                const pos = positionOf.get(e) ?? -1;
                // WITH AN EFFECT ROW SET, each term also says how this card does it: the facts of the
                // ability that passed, or that it is there by what it is (#1405 C).
                const effectSet = askedKinds.some((k) => EFFECT_KINDS.includes(k));
                const whyOf = (t: (typeof terms)[number]): { filter: boolean; why: string } => {
                  const filter = factFilterOf(eventQuery, t.side);
                  return { filter: effectSet && !isEmptyFilter(filter), why: effectSet ? effectCaption(lists.get(t.key), t.side, pos, filter) : "" };
                };
                const andTerms = terms.filter((t) => t.op === "and");
                // AN `or` TERM IS A REASON ONLY IF ITS ABILITY PASSED: with an effect row set, a card in
                // both terms by one failing ability must not name the failing one.
                const orTerms = terms.filter((t) => t.op === "or"
                  && (t.side === "makes" ? lists.get(t.key)?.p : lists.get(t.key)?.c)?.includes(pos)
                  && (!whyOf(t).filter || (whyOf(t).why !== "" && (showSkipped || (whyOf(t).why !== BY_WHAT_IT_IS && whyOf(t).why !== TIMING_UNKNOWN)))));
                const shownTerms = [...andTerms, ...orTerms];
                // BARE FACTS ONLY WHEN THE QUERY ITSELF HAS ONE TERM (the sentence above names it); with
                // several, a surviving term keeps its name so the reader can tell which one the card met.
                const oneTermQuery = terms.filter((t) => t.op !== "not").length === 1;
                // FACTS FIRST, because a three-across phone tile clips the end (#1405 C review). One term
                // is already in the sentence above, so the facts stand alone; several are named, in
                // parentheses, and joined by semicolons so two terms never read as one run.
                const caption = shownTerms.map((t) => {
                  const { why } = whyOf(t);
                  if (why === "") return termWords(t);
                  return oneTermQuery ? why : `${termWords(t)} (${why.replaceAll(" · ", ", ")})`;
                });
                // A COUNT THE LIST IS ORDERED OR FILTERED BY IS SAID ON THE TILE. A changeling holds every creature type, so
                // its number (all 377) would read as a fact about the card; it says what it is instead.
                // A CHANGELING MATCHED BY A SUBTYPE WORD says why: it is every creature type, so it is an Elf and a Human and
                // whatever else was asked (the Shapeshifter in an "Elf or Human" list had nothing to explain it).
                if (subtypeAsked && everyCreatureType.has(pos) && !caption.includes("every creature type")) caption.push("every creature type");
                for (const c of TYPE_COUNTS) {
                  const n = countsBy[c.sort]?.[pos];
                  if (n === undefined) continue;
                  // A CHANGELING HOLDS EVERY CREATURE TYPE, so both its creature-type and its subtype count are that list's
                  // length; neither is printed as a number.
                  const every = (c.sort === "creaturetypes" || c.sort === "subtypes") && everyCreatureType.has(pos);
                  const piece = every ? "every creature type" : `${n} ${c.unit}${n === 1 ? "" : "s"}`;
                  if (!caption.includes(piece)) caption.push(piece);
                }
                return (
                  <li key={e.slug} className="min-w-0">
                    <CardTile
                      slug={e.slug} name={e.name} art={e.art} identity={e.identity}
                      to={`${commanderMode ? "/commanders" : "/cards"}/${e.slug}`}
                      caption={caption.length > 0 ? caption.join("; ") : undefined}
                      captionLines={effectSet ? 3 : 2}
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
    {/* The peek is the fixed card panel (#1003): on the right under the header from `lg`, where the
      * padding above keeps the list clear of it while a card is open; a bottom sheet below. */}
    <CardPeek load={peekLoad} surface={commanderMode ? "commander" : "card"} />
    </div>
    </PeekContext.Provider>
  );
}
