import type { DeckReport } from "../types.js";
import { infiniteCombos } from "./bracket-why.js";
import type { EngineModel } from "./engine-model.js";
import { comboKill } from "./table-talk.js";

/** THE DECK'S STRONGEST PAIRS, for Glance (owner ruling 2026-10-10, #1159): the cheapest two-card
 *  infinite combo first -- the pair a table would name -- then the engine's ranked synergy pairs.
 *  At most three, the combo's own two cards never repeated as a synergy. */
export type TopPair =
  | { kind: "combo"; cards: [string, string]; manaTogether: number; result: string; kill: string }
  | { kind: "synergy"; cards: [string, string]; ways: string[]; both: boolean; lines: string[] };

const front = (name: string) => name.split(" // ")[0]!;

/** The kill clause, capped for a card-sized entry: two payoffs named, the rest counted ("and 8 more").
 *  Three are all named -- "and 1 more" would hide a name to save nothing. */
function killHere(c: Parameters<typeof comboKill>[0]): string {
  const p = c.payoffs ?? [];
  return p.length > 3 ? `wins through ${front(p[0]!.name)}, ${front(p[1]!.name)} and ${p.length - 2} more` : comboKill(c);
}

export function topPairs(report: DeckReport, model: EngineModel, manaValueOf: (name: string) => number | undefined): TopPair[] {
  const out: TopPair[] = [];
  // Two named cards and nothing required: a combo that needs a third piece is not a pair.
  const c = infiniteCombos(report.combos, manaValueOf).find((x) => x.cards.length === 2 && !x.requires?.length);
  if (c) out.push({ kind: "combo", cards: [front(c.cards[0]!), front(c.cards[1]!)], manaTogether: c.manaValue, result: c.result, kill: killHere(c) });
  const taken = c ? new Set(c.cards.map(front)) : undefined;
  for (const s of model.strongest) {
    if (out.length >= 3) break;
    const a = model.cards.get(s.pair.a), b = model.cards.get(s.pair.b);
    if (!a || !b) continue;
    const cards: [string, string] = [front(a.name), front(b.name)];
    if (taken && cards.every((n) => taken.has(n))) continue;
    out.push({ kind: "synergy", cards, ways: s.ways, both: s.both, lines: s.lines.slice(0, 2).map((l) => l.text) });
  }
  return out;
}
