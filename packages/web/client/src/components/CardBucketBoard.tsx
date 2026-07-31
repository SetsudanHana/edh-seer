import type { DeckReport } from "../types.js";
import { CardSynergyList } from "./CardSynergyList.js";

type NewBucket = "consistency" | "efficiency" | "win-condition";

const NEW_BUCKETS: NewBucket[] = ["consistency", "efficiency", "win-condition"];

const BUCKET_LABELS: Record<NewBucket, string> = {
  consistency: "Consistency",
  efficiency: "Efficiency",
  "win-condition": "Win Condition",
};

const BUCKET_HINTS: Record<NewBucket, string> = {
  consistency: "Finds what it needs, turn after turn",
  efficiency: "Does the most per mana spent",
  "win-condition": "Closes the game outright",
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
  const accent = `var(--bucket-${bucket})`;
  return (
    <section id={bucket} className="scroll-mt-8 flex flex-col gap-3">
      <div className="border-t-2 pt-2 flex flex-col gap-0.5" style={{ borderColor: accent }}>
        <h2 className="text-2xl leading-none" style={{ color: accent }}>
          {BUCKET_LABELS[bucket]}
        </h2>
        <p className="text-xs text-(--muted)">{BUCKET_HINTS[bucket]}</p>
      </div>
      {qualifying.length === 0 ? (
        <p className="text-(--muted) text-sm">No cards in this deck fill this role.</p>
      ) : (
        <ul className="flex flex-col">
          {qualifying.map((c) => (
            <li
              key={c.name}
              className="flex items-center gap-3 py-2 border-b border-(--separator) hover:bg-(--surface-secondary) transition-colors px-1 -mx-1 rounded-(--radius)"
            >
              <span className="pip" style={{ ["--pip-color" as string]: accent }}>
                {c.bucketScores![bucket].toFixed(2)}
              </span>
              <span className="flex-1 min-w-0 truncate">{c.name}</span>
              {c.bucketCount && c.bucketCount > 1 && primaryBucket(c) === bucket ? (
                <span className="eyebrow shrink-0">{`${c.bucketCount}/4 roles`}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
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
    <div className="flex flex-col gap-10">
      <BucketSection bucket="consistency" cards={cards} />
      <BucketSection bucket="efficiency" cards={cards} />
      <section id="synergy" className="scroll-mt-8">
        <CardSynergyList cards={cards} commanders={commanders} />
      </section>
      <BucketSection bucket="win-condition" cards={cards} />
    </div>
  );
}
