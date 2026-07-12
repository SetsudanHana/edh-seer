import { Card, CardContent } from "@heroui/react";
import type { DeckReport } from "../types.js";

export function SynergyList({ edges }: { edges: DeckReport["edges"] }) {
  if (edges.length === 0) return <p className="text-default-500">No synergies found.</p>;
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Top synergies</h2>
      {edges.map((e, i) => (
        <Card key={i}>
          <CardContent>
            <div className="font-medium">
              [{e.score}] {e.a} + {e.b}
            </div>
            <ul className="list-disc pl-5 text-sm text-default-600">
              {e.reasons.map((r, j) => (
                <li key={j}>{r.text}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
