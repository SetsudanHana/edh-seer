import type { CardGraph, DeckReport } from "../types.js";

type R = { producer: string; consumer: string; tag: string; text: string; repeatability?: string; producerIsToken?: boolean };

/** A deck small enough to reason about by hand:
 *  - eight Clerics, each counted by two payoffs (`scales:cleric`, repeating);
 *  - a cost reducer making all eight cheaper (a helper);
 *  - a spell that brings one Cleric back once;
 *  - a removal spell nothing touches, and a vanilla creature nothing touches;
 *  - a pair that helps each other both ways (payoff A and payoff B). */
export function engineDeck(): { report: DeckReport; graph: CardGraph } {
  const clerics = Array.from({ length: 8 }, (_, i) => `Cleric ${i + 1}`);
  const names = ["Commander", "Payoff A", "Payoff B", "Reducer", "Raise Once", "Doom Blade", "Vanilla", ...clerics];
  const reasons: R[] = [];
  for (const c of clerics) for (const p of ["Payoff A", "Payoff B"]) reasons.push({ producer: c, consumer: p, tag: "scales:cleric", text: `While you control ${c}, ${p} counts it` });
  for (const c of clerics) reasons.push({ producer: "Reducer", consumer: c, tag: "static:cost-reduction", text: `Reducer reduces what ${c} costs`, repeatability: "static" });
  reasons.push({ producer: "Raise Once", consumer: "Cleric 1", tag: "recursion-target:creature", text: "Raise Once can bring back Cleric 1", repeatability: "oneshot" });
  reasons.push({ producer: "Payoff A", consumer: "Payoff B", tag: "enters:creature", text: "When Payoff A enters, Payoff B draws" });
  reasons.push({ producer: "Payoff B", consumer: "Payoff A", tag: "dies:creature", text: "When Payoff B dies, Payoff A drains" });
  reasons.push({ producer: "Commander", consumer: "Payoff A", tag: "cast:creature", text: "When Commander is cast, Payoff A scries" });
  reasons.push({ producer: "Treasure", consumer: "Payoff A", tag: "creates:treasure", text: "Treasure feeds Payoff A", producerIsToken: true });
  const report = {
    commanders: ["Commander"],
    cards: names.map((name) => ({ name, isCommander: name === "Commander", score: name.startsWith("Payoff") ? 5 : 1 })),
    edges: reasons.map((r) => ({ a: r.producer, b: r.consumer, score: 1, reasons: [r] })),
  } as unknown as DeckReport;
  const roles: Record<string, string[]> = { "Doom Blade": ["targetedRemoval"] };
  const graph = {
    nodes: [
      ...names.map((n) => ({ id: n, label: n, copies: 1, types: ["creature"], subtypes: [], supertypes: [], colors: [], cmc: 2, roles: roles[n] ?? [] })),
      { id: "token:Treasure", label: "Treasure", isToken: true, copies: 1, types: ["artifact"], subtypes: [], supertypes: [], colors: [], cmc: 0 },
    ],
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  } as unknown as CardGraph;
  return { report, graph };
}
