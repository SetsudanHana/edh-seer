import { Card, CardContent } from "@heroui/react";
import type { DeckReport } from "../types.js";
import { CardSynergyList } from "./CardSynergyList.js";

type NewBucket = "consistency" | "efficiency" | "win-condition";

const NEW_BUCKETS: NewBucket[] = ["consistency", "efficiency", "win-condition"];

const BUCKET_LABELS: Record<NewBucket, string> = {
  consistency: "Consistency",
  efficiency: "Efficiency",
  "win-condition": "Win Condition",
};

// A card can qualify for more than one of the 3 non-synergy buckets. Its N/4 badge conveys
// the same total (bucketCount) everywhere, so render it only once — in the bucket where the
// card scores highest — rather than duplicating identical badge text in every section it
// appears in.
function primaryBucket(card: DeckReport["cards"][number]): NewBucket | undefined {
  if (!card.bucketScores) return undefined;
  return NEW_BUCKETS.reduce<NewBucket | undefined>((best, bucket) => {
    const score = card.bucketScores![bucket];
    if (score <= 0) return best;
    if (!best || score > card.bucketScores![best]) return bucket;
    return best;
  }, undefined);
}

function BucketSection({ bucket, cards }: { bucket: NewBucket; cards: DeckReport["cards"] }) {
  const qualifying = cards
    .filter((c) => (c.bucketScores?.[bucket] ?? 0) > 0)
    .sort((a, b) => b.bucketScores![bucket] - a.bucketScores![bucket]);
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{BUCKET_LABELS[bucket]}</h2>
      {qualifying.length === 0 ? (
        <p className="text-default-500 text-sm">No cards in this deck fill this role.</p>
      ) : (
        qualifying.map((c) => (
          <Card key={c.name}>
            <CardContent>
              <div className="font-medium">
                [{c.bucketScores![bucket].toFixed(2)}] {c.name}
                {c.bucketCount && c.bucketCount > 1 && primaryBucket(c) === bucket ? (
                  <span className="ml-2 text-default-500 text-xs">{`${c.bucketCount}/4`}</span>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

export function CardBucketBoard({
  cards,
  commanders,
}: {
  cards: DeckReport["cards"];
  commanders: string[];
}) {
  return (
    <div className="flex flex-col gap-6">
      <BucketSection bucket="consistency" cards={cards} />
      <BucketSection bucket="efficiency" cards={cards} />
      <CardSynergyList cards={cards} commanders={commanders} />
      <BucketSection bucket="win-condition" cards={cards} />
    </div>
  );
}
