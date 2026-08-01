function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 border border-(--separator) rounded-(--radius) p-3">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-2xl text-(--foreground)">{value}</span>
    </div>
  );
}

export function StatTiles({
  avgManaValue,
  landCount,
}: {
  avgManaValue: number;
  landCount: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Tile label="Avg CMC" value={avgManaValue.toFixed(1)} />
      <Tile label="Lands" value={landCount} />
    </div>
  );
}
