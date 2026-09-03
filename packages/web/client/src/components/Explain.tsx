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
      {/* THE HEIGHT IS NOT SET HERE, and an earlier attempt at this fix put `py-3.5` on this line
        *  and measured no change at all: `index.css` carries an UNLAYERED `summary` rule, and an
        *  unlayered rule beats Tailwind's `utilities` layer outright -- the same trap that file
        *  already documents for `.eyebrow`. So the 44px lives there, where it covers every
        *  disclosure in the app rather than only this component's.
        *
        *  WHAT DOES BELONG HERE IS THE AFFORDANCE. Size was half of why the phone judge never
        *  opened one; the other half is that a grey 11px line with a triangle reads as a caption.
        *  The accent on hover is what every other disclosure in this app already does
        *  (`CardInspector`), and a colour utility DOES win over the rule above. */}
      <summary className="eyebrow cursor-pointer text-(--muted) hover:text-(--accent)">
        {label}
      </summary>
      {/* Explain bodies are prose (a caveat, a scale, a "what this means"), and several name a
        *  number that can shift on re-render ("by turn 7", "10 points higher") -- `tabular-nums`
        *  here once covers every caller rather than each Caveat/Explain instance needing its own. */}
      <div className="text-xs text-(--muted) pt-1 tabular-nums">{children}</div>
    </details>
  );
}
