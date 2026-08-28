import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CardGraph } from "../types.js";
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
}

const CardDrawerContext = createContext<CardDrawerApi>({ open: () => {}, known: new Set() });

export function useCardDrawer(): CardDrawerApi {
  return useContext(CardDrawerContext);
}

export function CardDrawerProvider({ graph, children }: { graph?: CardGraph; children: ReactNode }) {
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
  const api = useMemo<CardDrawerApi>(() => ({ open, known: new Set(byName.keys()) }), [open, byName]);

  // Escape closes it. The panel has a close button of its own, but this drawer floats over a
  // ~3,000px report and the button can be off screen after the reader scrolls.
  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
              <CardInspector node={node} edges={edges} onClose={() => setOpenId(null)} />
            </div>,
            document.body,
          )
        : null}
    </CardDrawerContext.Provider>
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
