import type { ReactNode } from "react";

/** AN EXPLANATION, ONE CLICK AWAY — the report's one mechanism for saying what a number means.
 *
 *  Every scale on this page was either unexplained or explained in a `title` tooltip, which does
 *  not exist on touch at all and is undiscoverable with a mouse. The alternative the panel had
 *  already reached for — a paragraph of 11px grey prose under every block — cost roughly a quarter
 *  of the Overview's height. This is the middle: the words survive verbatim, they cost one line
 *  until asked for, and they work the same way everywhere.
 *  → `specs/2026-08-20-report-usability-review.md` §3 F7
 */
export function Explain({ label, children }: { label: string; children: ReactNode }) {
  return (
    <details className="max-w-[65ch]">
      <summary className="eyebrow cursor-pointer text-(--muted)">{label}</summary>
      {/* Explain bodies are prose (a caveat, a scale, a "what this means"), and several name a
        *  number that can shift on re-render ("by turn 7", "10 points higher") -- `tabular-nums`
        *  here once covers every caller rather than each Caveat/Explain instance needing its own. */}
      <div className="text-xs text-(--muted) pt-1 tabular-nums">{children}</div>
    </details>
  );
}
