export function parseDecklistText(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const withoutQty = line.replace(/^\d+\s*x?\s+/i, "");
    const clean = withoutQty.replace(/\s*[([].*$/, "").trim();
    if (clean) names.push(clean);
  }
  return names;
}
