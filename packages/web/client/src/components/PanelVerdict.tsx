import type { DeckReport } from "../types.js";
import { findings, rankedFindings } from "../lib/findings.js";
import { headerGaps } from "../lib/verdict.js";
import { Arrow } from "./icons.js";

/** THE GLANCE PANEL FOLLOWS THE HEADER (#1154, owner 2026-10-10): the deck's main problem and its
 *  one fix, ahead of "Say this at the table". When any role is short, it is the finding of the
 *  header's own lead role (`headerGaps(report).filter(g => g.short > 0)[0]`, joined on the finding id
 *  the role was read from, never on headline text); only when no role is short does it fall back to
 *  `rankedFindings(report).scored[0]`, Improve's top. Not the headline verdict sentence.
 *
 *  THE SUGGESTIONS BUTTON IS NOT HERE unless asked for (`withButton`): the heading row's verdict
 *  already carries one, and two in one view is one too many. */
export function PanelVerdict({ report, withButton = false }: { report: DeckReport; withButton?: boolean }) {
  const { scored } = rankedFindings(report);
  const lead = headerGaps(report).filter((g) => g.short > 0)[0];
  const top = (lead && scored.find((f) => f.id === lead.findingId)) ?? scored[0];
  if (!top) return null;
  const n = findings(report).length;
  return (
    <section aria-label="Fix this first" data-testid="panel-verdict" className="flex min-w-0 flex-col gap-2">
      <p className="eyebrow text-(--muted)">Fix this first</p>
      <p className="max-w-[60ch] text-base sm:text-lg">{top.headline}</p>
      {top.action ? <p className="max-w-[60ch] text-sm text-(--muted)">{top.action}</p> : null}
      {withButton ? (
        <p>
          <button type="button" className="btn-secondary gap-1.5"
            onClick={() => document.getElementById("fix")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            See all {n === 1 ? "1 suggestion" : `${n} suggestions`} <Arrow dir="down" />
          </button>
        </p>
      ) : null}
    </section>
  );
}
