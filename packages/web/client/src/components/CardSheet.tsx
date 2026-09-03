import { useState, type ReactNode } from "react";

/** THE CARD'S DETAIL, BELOW THE GRAPH RATHER THAN OVER IT (roadmap R1).
 *
 *  Measured at 390: the inspector rendered as a 288px overlay on a 324px canvas -- 89% of the board
 *  -- and the phone judge's report was that the picture is simply gone. It also clipped the oracle
 *  text mid-clause ("Cycling {X}{1}{U} ({X}{1}{U}, Discard this card:"), so it cost the reader the
 *  board AND did not finish the card. A sheet under the graph costs the board only when the reader
 *  opens it, and scrolls to whatever height the card needs.
 *
 *  COLLAPSED BY DEFAULT AND TOGGLING BOTH WAYS -- the T14 ruling: a control that opens must also
 *  close, or opening it deletes the only affordance for closing it.
 *
 *  Both controls are 44px, which is the house recommendation for a primary action rather than the
 *  24px floor. The thing they replace was a 39x16 CLOSE and was the only exit from the panel: a
 *  tap outside it landed on the canvas, which pans. */
export function CardSheet(
  { title, subtitle, children, onBack }:
  { title: string; subtitle: string; children: ReactNode; onBack: () => void },
) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border-t border-(--separator) bg-(--background) flex flex-col">
      <div className="flex items-center justify-between gap-3 px-3">
        <button type="button" onClick={onBack} className="min-h-11 shrink-0 eyebrow text-(--accent)">
          Back to the card list
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="min-h-11 shrink-0 eyebrow text-(--muted)"
        >
          {open ? "Hide details" : "Details"}
        </button>
      </div>
      <div className="px-3 pb-2 flex flex-col gap-0.5 min-w-0">
        <span className="truncate font-semibold">{title}</span>
        <span className="text-xs text-(--muted)">{subtitle}</span>
      </div>
      {/* The sheet, not the graph, is the only scrolling region on this surface. The canvas carries
        *  `touch-action: none`, and with the graph owning the viewport there is no page behind it to
        *  fight -- which is what turns that property from a scroll trap into the right setting. */}
      {open ? <div className="px-3 pb-3 overflow-y-auto max-h-[60svh]">{children}</div> : null}
    </div>
  );
}
