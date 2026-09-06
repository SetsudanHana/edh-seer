import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardGraph } from "../types.js";
import { reasonSegments } from "../lib/reason-text.js";
import { CardInspector } from "./CardInspector.js";

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
  /** Names the graph carries, so a caller can ask BEFORE rendering an affordance. */
  known: ReadonlySet<string>;
  /** Token names this deck's cards make, each mapped to the card that makes it (the first such
   *  card, when several do). A token is NOT in `known` -- the drawer indexes card nodes only, and
   *  deliberately so -- but a reason sentence naming one has to be able to say what it is. */
  tokens: ReadonlyMap<string, string | undefined>;
  /** Physical card names the reader has pinned (roadmap S8). Session-only: a shared analysis link
   *  carries the deck, and a second axis of state in that hash is scope this does not need -- the
   *  same call `ReportChapters` recorded for `focus`. */
  pinned: ReadonlySet<string>;
  /** Accepts a face OR a physical name and answers about the PHYSICAL card, so no panel needs to
   *  know which kind it holds -- the matrix's rows are faces, the waffle's squares are physical. */
  isPinned: (name: string) => boolean;
  togglePin: (name: string) => void;
  clearPins: () => void;
}

const CardDrawerContext = createContext<CardDrawerApi>({
  open: () => {}, known: new Set(), tokens: new Map(),
  pinned: new Set(), isPinned: () => false, togglePin: () => {}, clearPins: () => {},
});

export function useCardDrawer(): CardDrawerApi {
  return useContext(CardDrawerContext);
}

export function CardDrawerProvider({ graph, seedPins, children }: {
  graph?: CardGraph;
  /** THE CARDS THIS RUN ADDED (roadmap S9), pinned on arrival so they light in every chapter without
   *  the reader hunting for them. Resolved through `physicalName` exactly as a hand-made pin is, so
   *  a two-faced addition pins the physical card. The CALLER caps the list -- see `ReportShell`. */
  seedPins?: readonly string[];
  children: ReactNode;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
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
  const open = useCallback(
    (name: string) => {
      const id = byName.get(name);
      if (id) setOpenId(id);
    },
    [byName],
  );
  /** WHICH CARD MAKES EACH TOKEN, read off the graph's own create edges (`The Rani creates Mark of
   *  the Rani`). A token name in a reason sentence was dead text saying nothing -- see
   *  `reason-text.ts` -- and "the token your commander makes" is the whole answer a reader needed
   *  before they could judge the claim around it. */
  const tokens = useMemo(() => {
    const byId = new Map((graph?.nodes ?? []).map((n) => [n.id, n]));
    const m = new Map<string, string | undefined>();
    for (const n of graph?.nodes ?? []) if (n.isToken) m.set(n.label, undefined);
    for (const e of graph?.edges ?? []) {
      const to = byId.get(e.to);
      if (!to?.isToken || m.get(to.label) !== undefined) continue;
      const from = byId.get(e.from);
      if (from && !from.isToken) m.set(to.label, from.label);
    }
    return m;
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

  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());

  /** THE SET DIES WITH THE ANALYSIS, AND IS BORN WITH IT. `graph` is a new object per analyze, so
   *  this runs exactly when the deck under the report changes -- without it a pin made on deck A
   *  survives into deck B, where the name either lights nothing or lights a different card.
   *
   *  The S9 seed rides the same effect rather than a second one, which is what keeps that
   *  guarantee: there is no frame in which yesterday's pins and today's seed are both in the set.
   *
   *  Keyed on `graph` ALONE on purpose. `seedPins` is derived from the same analysis, so it changes
   *  with `graph`; listing it would only add a re-seed on an unrelated re-render, which would undo
   *  the reader's own unpinning. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPinned(new Set((seedPins ?? []).map(physicalName))); }, [graph]);

  const togglePin = useCallback((name: string) => {
    const key = physicalName(name);
    setPinned((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, [physicalName]);

  const isPinned = useCallback(
    (name: string) => pinned.has(physicalName(name)),
    [pinned, physicalName],
  );
  const clearPins = useCallback(() => setPinned(new Set()), []);

  const api = useMemo<CardDrawerApi>(
    () => ({ open, known: new Set(byName.keys()), tokens, pinned, isPinned, togglePin, clearPins }),
    [open, byName, tokens, pinned, isPinned, togglePin, clearPins],
  );

  // Escape closes it. The panel has a close button of its own, but this drawer floats over a
  // ~3,000px report and the button can be off screen after the reader scrolls.
  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  /** THE DRAWER IS DOCKED FROM `xl`, NOT LAID OVER THE PAGE (owner's call, 2026-09-03).
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
   *  `index.css` carries the `@media (min-width: 80rem)` and the transition; this only says WHEN. */
  useEffect(() => {
    if (openId === null) return;
    document.body.classList.add("drawer-docked");
    return () => document.body.classList.remove("drawer-docked");
  }, [openId]);

  const node = openId ? graph?.nodes.find((n) => n.id === openId) ?? null : null;
  const edges = useMemo(
    () => (node ? (graph?.edges ?? []).filter((e) => e.from === node.id || e.to === node.id) : []),
    [graph, node],
  );

  return (
    <CardDrawerContext.Provider value={api}>
      {children}
      {node
        // A PORTAL, AND IT IS LOAD-BEARING — the first cut rendered in place and was measured wrong
        // in the running app: `App.tsx`'s `.reveal` animation runs `animation-fill-mode: both`, so it LEAVES a `transform`
        // on the ancestor forever, which makes that element the containing block for fixed (CSS
        // Position 3, §3.2). The drawer anchored to a 2,095px-tall div instead of the viewport, so
        // it scrolled away with the page — the exact failure the fixed positioning was chosen to
        // avoid. Nothing in jsdom sees this; only the browser did.
        ? createPortal(
            // The inspector positions itself `absolute inset-y-2 right-2` against this element.
            <div className="fixed inset-y-0 right-0 z-30 w-80 max-w-[90vw]">
              <CardInspector
                node={node}
                edges={edges}
                onClose={() => setOpenId(null)}
                pinned={pinned.has(node.cardName ?? node.label)}
                onTogglePin={() => togglePin(node.cardName ?? node.label)}
              />
            </div>,
            document.body,
          )
        : null}
    </CardDrawerContext.Provider>
  );
}

/** THE ONE WAY A PANEL ASKS ABOUT PINS (roadmap S8). Every surface imports this and nothing else,
 *  so the face/physical rule stays in `physicalName` above rather than spreading across six
 *  components -- which is how eleven join sites drifted apart in the first place. */
export function usePinned(): Pick<CardDrawerApi, "pinned" | "isPinned" | "togglePin" | "clearPins"> {
  const { pinned, isPinned, togglePin, clearPins } = useCardDrawer();
  return { pinned, isPinned, togglePin, clearPins };
}

/** A REASON SENTENCE WITH ITS NOUNS MADE CHECKABLE (roadmap S18). Every card it names opens that
 *  card's text in the drawer, and every TOKEN it names says it is one and whose it is — which is
 *  the half the reader could not look up at all, since a token is not in the decklist and the
 *  drawer indexes cards only. See `reason-text.ts` for why both halves were needed. */
/** THE ENGINE'S ONE FALLBACK SENTENCE. `sentence.ts` prints "<card> triggers" / "it triggers" when
 *  it read the trigger and not the effect, and the card page marks that row "engine did not read
 *  what it does" while the report printed it as a claim (skeptic, UX sweep 2026-09-06: the deck's
 *  5.0 anchor was one). The mark travels with the sentence now, wherever it is printed. */
export const unreadEffect = (text: string): boolean => /\btriggers$/.test(text.trim());

export function ReasonText({ text, className }: { text: string; className?: string }) {
  const { known, tokens } = useCardDrawer();
  const segments = reasonSegments(text, known, tokens);
  return (
    <span className={className}>
      {unreadEffect(text) ? (
        <span className="eyebrow text-(--muted) mr-2">engine did not read what it does ·</span>
      ) : null}
      {segments.map((seg, i) =>
        seg.kind === "card" ? <CardName key={i} name={seg.text} />
          : seg.kind === "token" ? (
            <span key={i} className="whitespace-nowrap">
              {seg.text}
              {/* THE WORD, NOT A GLYPH: a coloured pill saying nothing is what the bracket pips
                *  were before S2 gave them words. `title` is not enough -- it does not exist on
                *  touch at all, which is the same reason `Explain` exists. */}
              <span className="ml-1 text-[0.9em] text-(--muted)">
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
      className={`text-left hover:text-(--accent) hover:underline underline-offset-2 ${className ?? ""}`}
    >
      {name}
    </button>
  );
}
