import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardGraph, DeckReport } from "../types.js";
import type { EngineModel } from "../lib/engine-model.js";
import { OrbitView } from "./OrbitView.js";

/** ONE CARD'S LINKS, OVER THE REPORT (owner, 2026-09-26: retire the Graph page and reach its pieces
 *  from the report). "See links" on a card anywhere in the report opens its orbit here, full
 *  screen, and Close puts the reader back where they were reading: the page underneath never
 *  moves, which a trip to another route and back could not promise.
 *
 *  A modal: the report behind cannot scroll or take focus while it is open. Focus goes to Close on
 *  open and back to whatever opened it on close; Escape closes it.
 *
 *  PORTALLED TO THE BODY, AT 27: above the site header (25), below the card drawer (30), which a
 *  card face inside the orbit opens. Rendered where it is opened, it sat inside the chapters'
 *  stacking context and the site header drew over it. */
export function OrbitOverlay({ report, graph, model, focusId, onClose }: {
  report: DeckReport; graph: CardGraph; model?: EngineModel;
  focusId: string;
  onClose: () => void;
}) {
  const [focus, setFocus] = useState(focusId);
  const close = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setFocus(focusId), [focusId]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    const was = root.style.overflow;
    root.style.overflow = "hidden";
    close.current?.focus();
    return () => { root.style.overflow = was; opener?.focus?.({ preventScroll: true }); };
  }, []);
  // Tab stays inside: the report behind is inert while this is open.
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>("button, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
    const first = items[0], last = items.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const name = model?.cards.get(focus)?.name ?? focus;
  return createPortal(
    <div ref={box} role="dialog" aria-modal="true" aria-label={`What ${name} works with`} onKeyDown={onKey}
      className="fixed inset-0 z-[27] flex flex-col bg-(--background)">
      {/* Close stays on screen: on a phone the ring and its panel are three screens tall, and
        * Close scrolled away with the first (appeal review 2026-09-26). The bar sits above the
        * scrolling part rather than pinned inside it. */}
      <div className="shrink-0 border-b border-(--separator)">
        <div className="mx-auto flex max-w-[110rem] items-center justify-between gap-3 px-4 py-2 sm:px-6">
          <p className="eyebrow text-(--muted)">What it works with</p>
          <button ref={close} type="button" onClick={onClose}
            className="min-h-11 rounded-(--radius) border border-(--separator) px-4 text-sm hover:border-(--foreground)">
            Close
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-[110rem] px-4 pb-6 sm:px-6">
          <OrbitView report={report} graph={graph} model={model} focusId={focus} onFocus={setFocus} sticky={false} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
