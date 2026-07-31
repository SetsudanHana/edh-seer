import { useState } from "react";
import type { AnalyzeResponse } from "../types.js";
import { OverviewTab } from "./OverviewTab.js";
import { ArchetypeBoard } from "./ArchetypeBoard.js";
import { CardList } from "./CardList.js";
import { ComboList } from "./ComboList.js";
import { MissingCards } from "./MissingCards.js";

type TabId = "overview" | "archetypes" | "cards" | "combos";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "archetypes", label: "Archetypes" },
  { id: "cards", label: "Cards" },
  { id: "combos", label: "Combos" },
];

export function ReportTabs({ data }: { data: AnalyzeResponse }) {
  const [active, setActive] = useState<TabId>("overview");
  return (
    <div className="flex flex-col gap-6">
      {data.missing.length > 0 ? <MissingCards missing={data.missing} /> : null}
      <div role="tablist" aria-label="Report sections" className="flex gap-4 border-b border-(--separator)">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active === t.id}
            onClick={() => setActive(t.id)}
            className={`eyebrow pb-2 -mb-px border-b-2 ${
              active === t.id ? "border-(--accent) text-(--accent)" : "border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {active === "overview" && <OverviewTab data={data} />}
        {active === "archetypes" && <ArchetypeBoard archetypes={data.report.archetypes} />}
        {active === "cards" && <CardList cards={data.report.cards} />}
        {active === "combos" && <ComboList combos={data.report.combos} />}
      </div>
    </div>
  );
}
