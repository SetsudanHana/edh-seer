export function MissingCards({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 border border-danger rounded-(--radius) p-4">
      <div className="flex items-center gap-3">
        <span className="pip" style={{ ["--pip-color" as string]: "var(--danger)" }}>
          {missing.length}
        </span>
        <h2 className="text-2xl leading-none text-danger">Unresolved</h2>
      </div>
      <p className="text-xs text-(--muted) -mt-2">
        Not found in the card database — check spelling or set-specific names
      </p>
      <ul className="flex flex-col gap-1 text-sm font-mono">
        {missing.map((name) => (
          <li key={name} className="text-(--foreground)">
            {name}
          </li>
        ))}
      </ul>
    </div>
  );
}
