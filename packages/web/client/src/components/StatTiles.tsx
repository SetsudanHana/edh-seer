function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-1 border border-(--separator) rounded-(--radius) p-3">
      <span className="eyebrow">{label}</span>
      <span className="font-mono text-2xl text-(--foreground)">{value}</span>
    </div>
  );
}

export function StatTiles({
  roles,
  avgManaValue,
  landCount,
}: {
  roles: { ramp: number; draw: number; removal: number };
  avgManaValue: number;
  landCount: number;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      <Tile label="Ramp" value={roles.ramp} />
      <Tile label="Draw" value={roles.draw} />
      <Tile label="Removal" value={roles.removal} />
      <Tile label="Avg CMC" value={avgManaValue.toFixed(1)} />
      <Tile label="Lands" value={landCount} />
    </div>
  );
}
