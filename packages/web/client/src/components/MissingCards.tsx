export function MissingCards({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-lg font-semibold text-warning">Unresolved cards ({missing.length})</h2>
      <ul className="list-disc pl-5 text-sm text-default-600">
        {missing.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
