import { beforeBracket, MAX_CARD_LINE } from "./sections.js";
export function parseDecklistText(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Bounded before any pattern touches it -- see sections.ts's MAX_CARD_LINE note: a pasted
    // decklist is untrusted, and one 64,000-character line used to cost two seconds of CPU.
    const line = (raw.length > MAX_CARD_LINE ? raw.slice(0, MAX_CARD_LINE) : raw).trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    const qtyMatch = line.match(/^(\d+)\s*x?\s+/i);
    const qty = qtyMatch ? Math.min(100, Math.max(1, parseInt(qtyMatch[1], 10))) : 1;
    const withoutQty = line.replace(/^\d+\s*x?\s+/i, "");
    const clean = beforeBracket(withoutQty).trim();
    if (clean) for (let i = 0; i < qty; i++) names.push(clean);
  }
  return names;
}
