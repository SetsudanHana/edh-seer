export function parseDecklistText(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const qtyMatch = line.match(/^(\d+)\s*x?\s+/i);
    const qty = qtyMatch ? Math.min(100, Math.max(1, parseInt(qtyMatch[1], 10))) : 1;
    const withoutQty = line.replace(/^\d+\s*x?\s+/i, "");
    const clean = withoutQty.replace(/\s*[([].*$/, "").trim();
    if (clean) for (let i = 0; i < qty; i++) names.push(clean);
  }
  return names;
}
