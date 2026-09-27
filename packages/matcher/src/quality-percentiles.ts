/** EVERY CARD'S QUALITY AS A PERCENTILE WITHIN EACH ROLE (spec
 *  docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md): build-static passes the whole
 *  corpus, so a percentile says "better than N% of the corpus's removal". Ties share the lower rank;
 *  a card whose score is null in a role has no percentile there. */
import { ingredients, loadQualityWeights, qualityScore, rolesOfCard, type Role } from "./quality.js";
import { loadStaples, type StaplesSnapshot } from "./staples.js";
import type { DeckCard } from "./types.js";

/** A STAPLE OUTRANKS EVERY NON-STAPLE (owner, 2026-09-27): a card on EDHTop16's staples list sorts by
 *  its play rate ABOVE every card that is not, and our ingredient score only orders the long tail below
 *  them. Encoded as one sortable key: staples in [BASE, BASE + 1], ingredient scores far below it. A
 *  staple with no readable ingredients is still ranked -- players' choice is the evidence. */
const STAPLE_BASE = 1e6;

export function qualityTable(cards: DeckCard[], staples: StaplesSnapshot = loadStaples()): Map<string, Map<Role, number>> {
  const w = loadQualityWeights();
  const byRole = new Map<Role, { name: string; s: number }[]>();
  for (const d of cards) {
    const played = staples.cards[(d.tags as { oracleId?: string } | null)?.oracleId ?? ""];
    for (const role of rolesOfCard(d)) {
      const weights = w.roles[role];
      if (!weights) continue;
      const s = played !== undefined ? STAPLE_BASE + played : qualityScore(ingredients(d, role), weights);
      if (s === null) continue;
      (byRole.get(role) ?? byRole.set(role, []).get(role)!).push({ name: d.card.name, s });
    }
  }
  const out = new Map<string, Map<Role, number>>();
  for (const [role, rows] of byRole) {
    const sorted = rows.map((r) => r.s).sort((a, b) => a - b);
    const firstAtLeast = (s: number): number => { let lo = 0, hi = sorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m]! < s) lo = m + 1; else hi = m; } return lo; };
    for (const r of rows) {
      const pct = sorted.length > 1 ? Math.round((100 * firstAtLeast(r.s)) / (sorted.length - 1)) : 100;
      (out.get(r.name) ?? out.set(r.name, new Map()).get(r.name)!).set(role, pct);
    }
  }
  return out;
}
