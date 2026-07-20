import type { DeckReport } from "@mtg/engine";

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s.padEnd(n));

/** Number of biggest rank movers to surface below the two-column table. */
const MOVERS_SHOWN = 5;

/**
 * Two-column top-N ranking: flat on the left, structured on the right, rank-aligned.
 * Followed by a "Biggest movers" section highlighting the cards whose rank position
 * changed the most between the two engines (present in both card lists).
 */
export function rankTable(flat: DeckReport, structured: DeckReport, topN: number): string {
  const lines: string[] = [`${pad("#", 3)}${pad("FLAT", 34)}STRUCTURED`];
  for (let i = 0; i < topN; i++) {
    const f = flat.cards[i];
    const s = structured.cards[i];
    const fc = f ? `${f.name} (${f.score.toFixed(2)})` : "";
    const sc = s ? `${s.name} (${s.score.toFixed(2)})` : "";
    if (!f && !s) break;
    lines.push(`${pad(String(i + 1), 3)}${pad(fc, 34)}${sc}`);
  }

  const flatRank = new Map(flat.cards.map((c, i) => [c.name, i + 1]));
  const structRank = new Map(structured.cards.map((c, i) => [c.name, i + 1]));
  const movers = [...flatRank.keys()]
    .filter((name) => structRank.has(name))
    .map((name) => {
      const fr = flatRank.get(name)!;
      const sr = structRank.get(name)!;
      return { name, fr, sr, delta: fr - sr };
    })
    .filter((m) => m.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, MOVERS_SHOWN);

  if (movers.length > 0) {
    lines.push("");
    lines.push("Biggest movers (flat rank -> structured rank):");
    for (const m of movers) {
      const arrow = m.delta > 0 ? "up" : "down";
      lines.push(`  ${m.name}: #${m.fr} -> #${m.sr} (${arrow} ${Math.abs(m.delta)})`);
    }
  }

  return lines.join("\n");
}
