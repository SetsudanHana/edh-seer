export function StatTiles({ avgManaValue }: { avgManaValue: number }) {
  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="flex-1 min-w-0 flex flex-col gap-0.5 rounded-lg border border-(--separator) p-4">
        <span className="eyebrow">Avg CMC</span>
        <span className="text-3xl font-semibold tabular-nums">{avgManaValue.toFixed(1)}</span>
      </div>
    </div>
  );
}
