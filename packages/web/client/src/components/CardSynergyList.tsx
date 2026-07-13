import { Card, CardContent } from "@heroui/react";
import type { DeckReport } from "../types.js";

export function CardSynergyList({
  cards,
  commanders,
}: {
  cards: DeckReport["cards"];
  commanders: string[];
}) {
  if (cards.length === 0) return <p className="text-default-500">No cards to analyze.</p>;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">
        Card synergies{commanders.length ? ` — commander: ${commanders.join(", ")}` : ""}
      </h2>
      {cards.map((c) => {
        const plural = c.partnerCount === 1 ? "" : "s";
        return (
          <Card key={c.name}>
            <CardContent>
              <div className="font-medium">
                [{c.score}] {c.name}
                {c.isCommander ? <span className="ml-2 text-primary text-xs uppercase">commander</span> : null}
                <span className="text-default-500 text-sm"> — synergizes with {c.partnerCount} card{plural}</span>
              </div>
              <ul className="list-disc pl-5 text-sm text-default-600">
                {c.topPartners.map((p) =>
                  p.reasons.map((r, j) => <li key={`${p.name}-${j}`}>{p.name}: {r.text}</li>),
                )}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
