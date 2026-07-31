import type { AnalyzeResponse } from "../types.js";
import { DeckIdentity } from "./DeckIdentity.js";
import { CardBucketBoard } from "./CardBucketBoard.js";
import { ComboList } from "./ComboList.js";
import { ThemeBars } from "./ThemeBars.js";
import { MissingCards } from "./MissingCards.js";

const SECTIONS = [
  { id: "consistency", label: "Consistency" },
  { id: "efficiency", label: "Efficiency" },
  { id: "synergy", label: "Synergy" },
  { id: "win-condition", label: "Win Condition" },
  { id: "combos", label: "Combos" },
  { id: "themes", label: "Themes" },
];

function SectionRail({ showMissing }: { showMissing: boolean }) {
  const links = showMissing ? [...SECTIONS, { id: "missing", label: "Unresolved" }] : SECTIONS;
  return (
    <nav
      aria-label="Report sections"
      className="flex md:flex-col gap-x-4 gap-y-2 overflow-x-auto md:overflow-visible md:w-36 shrink-0 md:sticky md:top-8 md:self-start pb-1 md:pb-0"
    >
      {links.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="eyebrow whitespace-nowrap hover:text-accent transition-colors"
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

export function ReportView({ data }: { data: AnalyzeResponse }) {
  const showMissing = data.missing.length > 0;
  return (
    <div className="flex flex-col gap-4">
      <p className="eyebrow">
        Resolved <span className="pip">{data.resolvedCount}/{data.totalCount}</span>
      </p>
      <DeckIdentity cohesion={data.report.cohesion} />
      <div className="flex flex-col md:flex-row gap-6 md:gap-10">
        <SectionRail showMissing={showMissing} />
        <div className="flex flex-col gap-10 min-w-0 flex-1">
          <CardBucketBoard cards={data.report.cards} commanders={data.report.commanders} />
          <section id="combos" className="scroll-mt-8">
            <ComboList combos={data.report.combos} />
          </section>
          <section id="themes" className="scroll-mt-8">
            <ThemeBars themes={data.report.themes} />
          </section>
          {showMissing && (
            <section id="missing" className="scroll-mt-8">
              <MissingCards missing={data.missing} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
