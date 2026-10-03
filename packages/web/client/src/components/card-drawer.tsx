import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardGraph } from "../types.js";
import { reasonSegments } from "../lib/reason-text.js";
import { CardInspector } from "./CardInspector.js";
import type { EngineModel } from "../lib/engine-model.js";
import { buildOrbit, countText } from "../lib/orbit-model.js";
import type { SuggestedCard } from "@edh-seer/matcher/suggest-static";
import { SuggestionPanel } from "./SuggestionPanel.js";

/** WHAT A REPORT ADDS TO THE DRAWER: the deck's links, to know which cards are on the commander's
 *  map, and a way to walk that map from the card. The report registers them; the drawer sits above it. */
export interface DrawerExtras {
  model: EngineModel;
  /** Walk the commander's map from the card. Absent where there is no map on the page (the Cards
   *  and Combos tabs), which still get the summary: the drawer is the same everywhere (#1003). */
  walk?: (id: string) => void;
  /** Where the report already names this card ("on the cut list"), by the card's physical name. */
  where?: (name: string) => string[];
  /** A link group's name as the report says it (the main theme by its name on Glance). */
  groupName?: (key: string, name: string) => string;
  /** Open two cards as a pair on the commander's map: the first in the middle, the second lit
   *  (pair-view mockups F1/F2, owner 2026-09-30: "why won't we just reuse constellation for it"). */
  pair?: (centre: string, partner: string) => void;
}

/** THE INSPECTOR, REACHABLE FROM ANY CARD NAME IN THE REPORT.
 *
 *  `CardInspector` shows what a card IS and every synergy edge naming it, split FEEDS / FED BY with
 *  each edge's reason sentence — the "why is this card here" drill-down the whole product is for.
 *  It shipped inside the graph, so the only way to open it was to hit a 14px disc in a hairball:
 *  no card name in the Cards table, the high-synergy list, the trim rows or a combo opened it.
 *
 *  This is wiring, not a second inspector. The graph keeps its own in-canvas instance (it needs the
 *  flow truncation counts, which only the board can know); everything else opens the same component
 *  through this provider.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F8
 */

interface CardDrawerApi {
  /** Open the drawer on a card. A name the graph does not carry is a no-op — see `<CardName>`,
   *  which is what callers should use so an unopenable name never renders as a button. */
  open: (name: string) => void;
  /** Close it, as a walk on the map does: the card it showed is now the map's middle. */
  close: () => void;
  /** Open a SUGGESTED card, one not in the deck (`SuggestionPanel`); `replaces` names the cut whose
   *  slot it can take. */
  openSuggestion: (card: SuggestedCard, replaces?: string) => void;
  /** False outside a provider, where a card link keeps navigating as it always did. */
  live: boolean;
  /** Names the graph carries, so a caller can ask BEFORE rendering an affordance. */
  known: ReadonlySet<string>;
  /** Token names this deck's cards make, each mapped to the card that makes it (the first such
   *  card, when several do). A token is NOT in `known` -- the drawer indexes card nodes only, and
   *  deliberately so -- but a reason sentence naming one has to be able to say what it is. */
  tokens: ReadonlyMap<string, string | undefined>;
  /** THE CARDS THIS RUN ADDED (roadmap S9), by physical name: marked "new" wherever the report
   *  shows them. Set by the analysis, never by the reader (owner, 2026-09-27: the hand-made pin
   *  went; "pin across the report" lit too little to be worth a control). */
  added: ReadonlySet<string>;
  /** Accepts a face OR a physical name and answers about the PHYSICAL card, so no panel needs to
   *  know which kind it holds -- the matrix's rows are faces, the waffle's squares are physical. */
  isAdded: (name: string) => boolean;
  /** The report registers what it adds to the drawer; null when it unmounts. */
  setExtras: (extras: DrawerExtras | null) => void;
  /** THE RAIL (owner, 2026-09-29, option B of the drawer mockups): a surface that has chapter
   *  summaries switches it on, and from 1600px the page keeps 20rem for it at all times, so opening
   *  a card changes what the rail shows and never where anything else sits. */
  setRailOn: (on: boolean) => void;
  /** Where a chapter summary portals to: the rail's own element, null below 1600px or with no rail. */
  railHost: HTMLElement | null;
  /** What the card's close control says while it covers the rail ("Back to Game plan"). */
  setRailBack: (label: string | null) => void;
  /** THE PAIR, ON THE MAP: what opens two cards together on the commander's map, by name or id,
   *  or null where there is no map or the two do not work together -- so a caller renders no
   *  button that would do nothing. */
  pairOf: (a: string, b: string) => (() => void) | null;
}

const CardDrawerContext = createContext<CardDrawerApi>({
  open: () => {}, close: () => {}, openSuggestion: () => {}, live: false, known: new Set(), tokens: new Map(),
  added: new Set(), isAdded: () => false, setExtras: () => {},
  setRailOn: () => {}, railHost: null, setRailBack: () => {}, pairOf: () => null,
});

/** From 1600px (`100rem`), where the page has the width to keep a rail beside it; the same
 *  breakpoint `index.css` reserves the rail's space at. */
/** THE RAIL'S BOX, and the card's while it covers the rail: ONE SHAPE FOR BOTH (designer review,
 *  2026-09-29). The card used to open as an inset bordered panel over a flush summary, so the text's
 *  left edge jumped 20px on every open. Both start under the site header, which runs over them. */
const RAIL_BOX = "fixed top-(--site-header-h) bottom-0 right-0 w-(--rail-w) overflow-y-auto border-l border-(--separator) bg-(--background)";
const RAIL_QUERY = "(min-width: 100rem)";
/** THE CARD PANEL'S BOX WHERE THERE IS NO RAIL (#1003): a bottom sheet on a phone, a right-hand panel
 *  under the site header from `lg` -- the box `.peek` takes on the site's pages, so a card opens in
 *  the same place whichever page it is clicked on. It used to start at the top of the viewport and
 *  cover the header's own navigation on the Cards tab and the precon page. */
const PANEL_BOX = "fixed inset-x-0 bottom-0 z-30 h-[60svh] lg:inset-x-auto lg:right-0 lg:top-(--site-header-h) lg:h-auto lg:w-(--rail-w)";
function useRailWidth(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(RAIL_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(RAIL_QUERY);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

export function useCardDrawer(): CardDrawerApi {
  return useContext(CardDrawerContext);
}

export function CardDrawerProvider({ graph, added: addedNames, children }: {
  graph?: CardGraph;
  /** THE CARDS THIS RUN ADDED (roadmap S9), marked "new" in every chapter without the reader
   *  hunting for them. Resolved through `physicalName`, so a two-faced addition marks the physical
   *  card. The CALLER caps the list -- see `ReportShell`. */
  added?: readonly string[];
  children: ReactNode;
}) {
  const [openId, setOpenIdRaw] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<{ card: SuggestedCard; replaces?: string } | null>(null);
  // ONE THING IN THE DRAWER AT A TIME: a deck card or a suggestion, and closing clears both.
  const setOpenId = useCallback((id: string | null) => { setOpenIdRaw(id); setSuggestion(null); }, []);
  const shown = openId ?? (suggestion ? `suggestion:${suggestion.card.name}` : null);
  const [extras, setExtras] = useState<DrawerExtras | null>(null);
  const [railOn, setRailOn] = useState(false);
  const [railEl, setRailEl] = useState<HTMLElement | null>(null);
  const [railBack, setRailBack] = useState<string | null>(null);
  const wide = useRailWidth();
  /** The rail is SHOWING: switched on by the surface, and the screen is wide enough to keep it. */
  const railShown = railOn && wide;
  // A TOKEN NEVER WINS A NAME COLLISION HERE. `nodeId` gives a token its own id precisely because
  // 92 of 661 distinct token names collide with a real card's, and every caller of this drawer is
  // naming a card from the DECK — so index the card nodes and let a token be reached by clicking
  // it on the board, which is the only place a token appears as itself.
  const byName = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of graph?.nodes ?? []) if (!n.isToken && !m.has(n.label)) m.set(n.label, n.id);
    // THE PHYSICAL CARD OPENS ITS FRONT FACE. A node's label is one printed FACE's name
    // (faces-as-nodes), so a caller naming the whole card — the cut list and the trim order, which
    // merge a card's faces back together because you cannot cut half a card — asked for a name no
    // node carried and `CardName` correctly rendered plain text. Review fix, 2026-08-28. The FRONT
    // face is the target (`face === undefined`), because it is the side the card is played from and
    // the side the board draws. Added second and guarded on `has`, so a real card whose name happens
    // to equal some other card's face name keeps its own node.
    for (const n of graph?.nodes ?? []) {
      if (!n.isToken && n.cardName !== undefined && n.face === undefined && !m.has(n.cardName)) {
        m.set(n.cardName, n.id);
      }
    }
    return m;
  }, [graph]);
  // Set by `open`, read by the outside-click rule below: a click that opened (or switched to) a card
  // is not a click away from the drawer.
  const opened = useRef(false);
  // THE WAY BACK NAMES WHERE THE CARD WAS OPENED FROM (persona round 2026-09-29). It read the
  // surface's label live, so scrolling the page under an open card renamed the button: a card
  // opened from Game plan offered "Back to manabase", a chapter the reader never left. Taken at
  // each open, not once (#1003 review): a second card opened from Manabase while the first was
  // still showing kept "Back to game plan".
  const railBackNow = useRef(railBack);
  railBackNow.current = railBack;
  const shownNow = useRef(shown);
  shownNow.current = shown;
  const [backTo, setBackTo] = useState<string | null>(null);
  // FOCUS GOES BACK TO THE CARD THAT OPENED IT on Close or Escape (#1003 review), as the peek's
  // does (`usePeekState`); it fell to <body> and a keyboard reader started the page over.
  const opener = useRef<Element | null>(null);
  const closeBack = useCallback(() => {
    setOpenId(null);
    const el = opener.current;
    opener.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus({ preventScroll: true });
  }, [setOpenId]);
  const open = useCallback(
    (name: string) => {
      const id = byName.get(name);
      if (id) {
        if (!shownNow.current) opener.current = document.activeElement;
        setBackTo(railBackNow.current);
        setOpenId(id); opened.current = true;
      }
    },
    [byName, setOpenId],
  );
  const openSuggestion = useCallback((card: SuggestedCard, replaces?: string) => {
    if (!shownNow.current) opener.current = document.activeElement;
    setOpenIdRaw(null); setSuggestion({ card, replaces }); opened.current = true;
  }, []);
  /** WHICH CARD MAKES EACH TOKEN, read off the graph's own create edges (`The Rani creates Mark of
   *  the Rani`). A token name in a reason sentence was dead text saying nothing -- see
   *  `reason-text.ts` -- and "the token your commander makes" is the whole answer a reader needed
   *  before they could judge the claim around it. */
  const tokens = useMemo(() => {
    const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
    const m = new Map<string, string | undefined>();
    for (const n of graph?.nodes ?? []) if (n.isToken) m.set(n.label, undefined);
    // A CREATE EDGE FIRST: any edge into a token was taken as its maker, so a landfall link
    // credited Summon: Fat Chocobo's Bird to Flooded Strand (overview round 9). Other edges only
    // name a maker when no card is known to create the token.
    const creates = (e: { tags?: readonly string[] }) => (e.tags ?? []).some((t) => t.startsWith("creates:"));
    const edges = [...(graph?.edges ?? [])].sort((x, y) => Number(creates(y)) - Number(creates(x)));
    for (const e of edges) {
      const to = byId.get(e.to);
      if (!to?.isToken || m.get(to.label) !== undefined) continue;
      const from = byId.get(e.from);
      if (from && !from.isToken) m.set(to.label, from.label);
    }
    return m;
  }, [graph]);
  /** ID -> LABEL FOR THE INSPECTOR'S PARTNER ROWS. Without it a back face printed its raw id,
   *  `face:1:Mirror Room // Fractured Realm`, on the owner's phone (2026-09-06) -- the same map
   *  `GraphView` hands its own in-canvas inspector. */
  const nameOf = useMemo(() => {
    const m = new Map<string, { label: string; isToken: boolean; isEmblem: boolean }>();
    for (const n of graph?.nodes ?? []) m.set(n.id, { label: n.label, isToken: n.isToken === true, isEmblem: n.isEmblem === true });
    return (id: string) => m.get(id);
  }, [graph]);
  /** A PIN IS THE PHYSICAL CARD, NEVER A FACE (roadmap S8). `byName` already maps both spellings
   *  onto one node id and the front face's node carries `cardName`, so resolving through it REUSES
   *  the join instead of writing a thirteenth copy of it -- eleven were fixed on 2026-08-27 and S17
   *  found the twelfth. A name the graph does not carry resolves to itself, so a token or an
   *  off-deck name is still a stable key rather than a crash. */
  const physicalName = useCallback((name: string): string => {
    const id = byName.get(name);
    const node = id === undefined ? undefined : (graph?.nodes ?? []).find((n) => n.id === id);
    return node?.cardName ?? node?.label ?? name;
  }, [byName, graph]);

  /** THE SET IS BORN WITH THE ANALYSIS. `graph` is a new object per analyze, so this is rebuilt
   *  exactly when the deck under the report changes; keyed on `graph` alone because `added` comes
   *  from the same analysis. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const added = useMemo<ReadonlySet<string>>(() => new Set((addedNames ?? []).map(physicalName)), [graph]);
  const isAdded = useCallback((name: string) => added.has(physicalName(name)), [added, physicalName]);

  const pairOf = useCallback((a: string, b: string) => {
    const show = extras?.pair;
    if (!show) return null;
    const x = byName.get(a) ?? a;
    const links = extras.model.partners.get(x);
    // A CARD THAT WORKS WITH ANOTHER THROUGH ITS TOKEN pairs with the token (measured on the Rani
    // deck: five of the six rows in "Cards that carry it" name The Rani, and every one of their
    // sentences is "When Mark of the Rani enters…"); the map draws the token, not its maker.
    const direct = byName.get(b) ?? b;
    const y = links?.has(direct) ? direct
      : [...(links?.keys() ?? [])].find((id) => extras.model.cards.get(id)?.madeBy?.includes(b));
    if (!y || x === y) return null;
    // The drawer closes: the pair opens where the map is, and on a phone the drawer covers it.
    return () => { setOpenId(null); show(x, y); };
  }, [extras, byName, setOpenId]);

  const api = useMemo<CardDrawerApi>(
    () => ({
      open, close: () => setOpenId(null), openSuggestion, live: true, known: new Set(byName.keys()), tokens, added, isAdded, setExtras,
      setRailOn, railHost: railShown ? railEl : null, setRailBack, pairOf,
    }),
    [open, openSuggestion, setOpenId, byName, tokens, added, isAdded, railShown, railEl, pairOf],
  );

  // Escape closes it. The panel has a close button of its own, but this drawer floats over a
  // ~3,000px report and the button can be off screen after the reader scrolls.
  useEffect(() => {
    if (shown === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) closeBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, closeBack]);

  /** A CLICK AWAY FROM THE DRAWER CLOSES IT (owner, 2026-09-27: "with overlay … if we click outside
   *  the overlay closes"). Below 1600px it lies over the page, and at every width it closes the same
   *  way. A click that opens another card switches to it instead: the card's own handler calls
   *  `open` before this document listener runs. A drag (the map pans) is not a click away, and
   *  neither is a scroll, which never makes a click. */
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown === null) return;
    let from = { x: 0, y: 0 };
    const down = (e: PointerEvent) => { from = { x: e.clientX, y: e.clientY }; opened.current = false; };
    const click = (e: MouseEvent) => {
      if (opened.current) { opened.current = false; return; }
      // ON THE RAIL A CARD STAYS UNTIL THE READER GOES BACK: a click elsewhere on the page is
      // reading the page, and the card beside it is what they are reading it against.
      if (railShown) return;
      if (panel.current?.contains(e.target as Node)) return;
      if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > 5) return;
      setOpenId(null);
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("click", click);
    return () => { document.removeEventListener("pointerdown", down, true); document.removeEventListener("click", click); };
  }, [shown, setOpenId, railShown]);

  /** THE DRAWER IS DOCKED FROM 1600px, NOT LAID OVER THE PAGE (owner's call, 2026-09-03; from `xl`
   *  until 2026-09-27, when the owner moved it up -- see `index.css`).
   *
   *  IT IS THE ANSWER TO A GAP, NOT A NEW IDEA. At 1920 the Cards panel capped at 88rem and
   *  left-aligned, so 448px of the page sat empty on the right -- measured -- while the drawer
   *  covered the rows on the left. The width had no job, and the drawer needed one.
   *  (THE CAP ITSELF THEN WENT TOO, same day, owner's call: with the drawer docking, a reader
   *  watched the nav and the toolbar make room while the table underneath them did not. The table
   *  now takes the full width and reflows with everything else -- see `CardList`, which records
   *  what that costs. This reserve is what makes the reflow land somewhere sensible.)
   *
   *  ON `body`, AND THE FIRST ATTEMPT PROVED WHY. Reserving the width on the provider's own
   *  children padded the report and nothing else -- so the static site nav (which lives in
   *  `index.html`, outside the React root entirely) and `App`'s own "COPY DECKLIST" toolbar were
   *  still underneath the panel. Seen in a 1920 screenshot, not reasoned about. The drawer is
   *  `fixed` to the VIEWPORT, so what has to get out of its way is the page, not one subtree.
   *
   *  A CLASS AND A STYLESHEET RULE, because the breakpoint has to be CSS. `matchMedia` in a JS
   *  branch reads false in this repo's own harness (`playwright-max-width-matchmedia-false`), which
   *  would render the docked tree in every screenshot that is supposed to show the overlay.
   *  `index.css` carries the `@media (min-width: 100rem)` and the transition; this only says WHEN. */
  // THE RESERVE FOLLOWS THE RAIL, NEVER THE CARD (owner, 2026-09-29: "on some views it is causing
  // a very big shift in layout"). Toggled on each open, it re-flowed the whole report: measured at
  // 1920 on Rani, the row just clicked moved 240px down the screen. A surface with a rail holds the
  // space for as long as it is mounted; one without (a precon page) has the card float over it.
  useEffect(() => {
    if (!railOn) return;
    document.body.classList.add("drawer-rail");
    return () => document.body.classList.remove("drawer-rail");
  }, [railOn]);

  const node = openId ? graph?.nodes.find((n) => n.id === openId) ?? null : null;
  const edges = useMemo(
    () => (node ? (graph?.edges ?? []).filter((e) => e.from === node.id || e.to === node.id) : []),
    [graph, node],
  );

  return (
    <CardDrawerContext.Provider value={api}>
      {children}
      {railOn
        // THE RAIL ITSELF, from 1600px: the chapter the reader is in, summarised, until a card takes
        // its place. Below 1600px it is not drawn and a card opens as the overlay it always was.
        ? createPortal(
            <aside aria-label="Chapter summary" data-testid="report-rail"
              className={`${RAIL_BOX} z-20 hidden flex-col px-4 py-6 min-[100rem]:flex`}>
              <div ref={setRailEl} className="flex flex-col gap-4" />
            </aside>,
            document.body,
          )
        : null}
      {node
        // A PORTAL, AND IT IS LOAD-BEARING — the first cut rendered in place and was measured wrong
        // in the running app: `App.tsx`'s `.reveal` animation runs `animation-fill-mode: both`, so it LEAVES a `transform`
        // on the ancestor forever, which makes that element the containing block for fixed (CSS
        // Position 3, §3.2). The drawer anchored to a 2,095px-tall div instead of the viewport, so
        // it scrolled away with the page — the exact failure the fixed positioning was chosen to
        // avoid. Nothing in jsdom sees this; only the browser did.
        ? createPortal(
            // The inspector positions itself `absolute inset-y-2 right-2` against this element.
            <div ref={panel} className={railShown ? `${RAIL_BOX} z-30` : PANEL_BOX}>
              <CardInspector
                docked={railShown}
                node={node}
                edges={edges}
                onClose={closeBack}
                closeLabel={railShown && backTo ? backTo : undefined}
                nameOf={nameOf}
                pairOf={extras?.pair ? (partner) => pairOf(node.id, partner) : undefined}
                extra={extras?.model.cards.get(node.id) ? (
                  // THE WALK, ONE TAP AWAY (report cohesion audit, 2026-09-27). The small map of the
                  // card's links that sat above it went (owner, same day: "not very useful … for fresh
                  // players it will be completely useless"); the links are listed below.
                  <div className="flex flex-col gap-2 border-t border-(--separator) pt-2">
                    <DrawerSummary extras={extras} id={node.id} name={node.cardName ?? node.label} />
                    {extras.walk ? (
                      <button type="button" onClick={() => { extras.walk!(node.id); setOpenId(null); }}
                        className="btn-secondary self-stretch">
                        Walk the map from here
                      </button>
                    ) : null}
                  </div>
                ) : undefined}
              />
            </div>,
            document.body,
          )
        : suggestion
          ? createPortal(
              <div ref={panel} className={PANEL_BOX}>
                <SuggestionPanel key={suggestion.card.name} card={suggestion.card} replaces={suggestion.replaces} onClose={closeBack} />
              </div>,
              document.body,
            )
          : null}
    </CardDrawerContext.Provider>
  );
}

/** WHAT THE CARD DOES IN THIS DECK, AS THE DRAWER MOCKUP SAYS IT (2026-09-27): how many cards it
 *  works with, split by what links them, in the map's colours, and where the report names it. */
function DrawerSummary({ extras, id, name }: { extras: DrawerExtras; id: string; name: string }) {
  const o = useMemo(() => buildOrbit(extras.model, id), [extras.model, id]);
  const where = extras.where?.(name) ?? [];
  if (!o) return null;
  const n = o.direct + o.directTokens;
  // Counted as the map's panel counts them: cards, then tokens apart.
  const once = o.sectors.flatMap((x) => x.partners).filter((p) => p.once && !p.card.isToken).length;
  const tokens = o.directTokens ? ` and ${o.directTokens} token${o.directTokens === 1 ? "" : "s"}` : "";
  return (
    <div data-testid="drawer-summary" className="flex flex-col gap-2 text-sm">
      <p className="text-(--muted)">{n === 0 ? "Nothing else in the deck works with this card." : `Works with ${countText(o.direct, once)}${tokens}.`}</p>
      {o.sectors.length ? (
        <span className="flex flex-wrap gap-1">
          {o.sectors.map((x) => (
            <span key={x.key} className="inline-flex items-center gap-1.5 rounded-(--radius) border border-(--separator) px-2 py-0.5 text-xs">
              <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: x.hue }} />
              {extras.groupName?.(x.key, x.name) ?? x.name} · {x.partners.length}
            </span>
          ))}
        </span>
      ) : null}
      {where.length ? <p className="text-xs text-(--muted)">In this report: {where.join(" · ")}</p> : null}
    </div>
  );
}

/** THE ONE WAY A PANEL ASKS WHICH CARDS ARE NEW (roadmap S9). Every surface imports this and
 *  nothing else, so the face/physical rule stays in `physicalName` above. */
export function useAdded(): Pick<CardDrawerApi, "added" | "isAdded"> {
  const { added, isAdded } = useCardDrawer();
  return { added, isAdded };
}

/** A REASON SENTENCE WITH ITS NOUNS MADE CHECKABLE (roadmap S18). Every card it names opens that
 *  card's text in the drawer, and every TOKEN it names says it is one and whose it is — which is
 *  the half the reader could not look up at all, since a token is not in the decklist and the
 *  drawer indexes cards only. See `reason-text.ts` for why both halves were needed. */
/** THE ENGINE'S ONE FALLBACK SENTENCE. `sentence.ts` prints "<card> triggers" / "it triggers" when
 *  it read the trigger and not the effect, and the card page marks that row "engine did not read
 *  what it does" while the report printed it as a claim (skeptic, UX sweep 2026-09-06: the deck's
 *  5.0 anchor was one). The mark travels with the sentence now, wherever it is printed.
 *  CEILING: keyed on the rendered text because the client cannot value-import the matcher (its
 *  module graph reaches node:fs). `sentence.test.ts` pins the fallback's last word, so a phrase
 *  change in the engine fails there rather than silently unmarking rows here. */
export const unreadEffect = (text: string): boolean => /\btriggers$/.test(text.trim());

export function ReasonText({ text, className }: { text: string; className?: string }) {
  const { known, tokens } = useCardDrawer();
  const segments = reasonSegments(text, known, tokens);
  return (
    <span className={className}>
      {unreadEffect(text) ? (
        // WHAT WAS NOT READ IS THE EFFECT, and the mark says so (review 2026-09-25). "Couldn't read
        // this card" on the deck's top-ranked key card read as the tool not understanding its own
        // best pick, when the trigger -- the half the pairing rests on -- WAS read.
        <span className="text-xs text-(--muted) mr-2">what it does isn't read yet ·</span>
      ) : null}
      {segments.map((seg, i) =>
        seg.kind === "card" ? <CardName key={i} name={seg.text} />
          : seg.kind === "token" ? (
            // WRAPS, INSIDE ITS MAKER'S NAME IF IT HAS TO: kept on one line, "Zombie (token from
            // Aphemia, the Cacophony)" ran off a phone screen (appeal review 2026-09-26).
            <span key={i}>
              {/* A REAL SPACE, not a margin: copied text and screen readers got "Mark of the
                *  Rani(token from The Rani)" (review 2026-09-25). */}
              {seg.text}{" "}
              {/* THE WORD, NOT A GLYPH: a coloured pill saying nothing is what the bracket pips
                *  were before S2 gave them words. `title` is not enough -- it does not exist on
                *  touch at all, which is the same reason `Explain` exists. */}
              <span className="text-[0.9em] text-(--muted)">
                (token{seg.maker ? <> from {seg.maker}</> : null})
              </span>
            </span>
          )
            : <span key={i}>{seg.text}</span>,
      )}
    </span>
  );
}

/** A card name that opens the drawer — and plain text when the graph cannot show it, so the report
 *  never offers a click that does nothing. Styled as text, not as a button: these sit inside table
 *  rows and list items where a button chrome would fight the row. */
export function CardName({ name, className }: { name: string; className?: string }) {
  const { open, known } = useCardDrawer();
  if (!known.has(name)) return <>{name}</>;
  return (
    <button
      type="button"
      onClick={() => open(name)}
      // A 24px HIT BOX ON A 16px LINE (cohesion sweep 2026-09-08, finding 7): 81 of the 84 sub-24px
      // targets on a phone report were this button. Vertical padding grows the box; the matching
      // negative margin hands the space back, so the sentence or the table row it sits in does not
      // move. WCAG 2.5.8 exempts inline links in prose; this is a button, in tables as often as not.
      className={`py-1 -my-1 text-left hover:text-(--accent) hover:underline underline-offset-2 ${className ?? ""}`}
    >
      {name}
    </button>
  );
}
