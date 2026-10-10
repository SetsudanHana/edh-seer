import type { DeckReport } from "../types.js";
import { findings, rankedFindings } from "../lib/findings.js";
import { Arrow } from "./icons.js";

/** THE GLANCE PANEL LEADS WITH THE VERDICT (#1154, owner 2026-10-10): the deck's main problem and
 *  its one fix, ahead of "Say this at the table". Read from `rankedFindings(...).scored[0]`, the same
 *  impact order Improve and the header use -- never re-ranked here. Not the headline verdict sentence. */
export function PanelVerdict({ report }: { report: DeckReport }) {
  const top = rankedFindings(report).scored[0];
  if (!top) return null;
  const n = findings(report).length;
  return (
    <section aria-label="Fix this first" data-testid="panel-verdict" className="flex min-w-0 flex-col gap-2">
      <p className="eyebrow text-(--muted)">Fix this first</p>
      <p className="max-w-[60ch] text-base sm:text-lg">{top.headline}</p>
      {top.action ? <p className="max-w-[60ch] text-sm text-(--muted)">{top.action}</p> : null}
      <p>
        <button type="button" className="btn-secondary gap-1.5"
          onClick={() => document.getElementById("fix")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
          See all {n === 1 ? "1 suggestion" : `${n} suggestions`} <Arrow dir="down" />
        </button>
      </p>
    </section>
  );
}
