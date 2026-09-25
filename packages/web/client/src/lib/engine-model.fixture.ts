import type { CardGraph, DeckReport } from "../types.js";

type R = { producer: string; consumer: string; tag: string; text: string; repeatability?: string; producerIsToken?: boolean };

/** A deck small enough to reason about by hand:
 *  - eight Clerics, each counted by two payoffs (`scales:cleric`, repeating);
 *  - a cost reducer making all eight cheaper (a helper);
 *  - a spell that brings one Cleric back once;
 *  - a removal spell nothing touches, and a vanilla creature nothing touches;
 *  - a pair that helps each other both ways (payoff A and payoff B);
 *  - a sidekick with a line where the commander acts, one whose effect is unread, and one where its
 *    own text acts;
 *  - the same eight Clerics again, attacking into payoff A (a group that repeats the first);
 *  - a digger that brings three Clerics back, each once. */
export function engineDeck(): { report: DeckReport; graph: CardGraph } {
  const clerics = Array.from({ length: 8 }, (_, i) => `Cleric ${i + 1}`);
  const names = ["Commander", "Payoff A", "Payoff B", "Reducer", "Raise Once", "Doom Blade", "Vanilla", "Sidekick", "Digger", ...clerics];
  const reasons: R[] = [];
  for (const c of clerics) for (const p of ["Payoff A", "Payoff B"]) reasons.push({ producer: c, consumer: p, tag: "scales:cleric", text: `While you control ${c}, ${p} counts it` });
  for (const c of clerics) reasons.push({ producer: "Reducer", consumer: c, tag: "static:cost-reduction", text: `Reducer reduces what ${c} costs`, repeatability: "static" });
  for (const c of clerics) reasons.push({ producer: c, consumer: "Payoff A", tag: "attacks:cleric", text: `Whenever ${c} attacks, Payoff A drains` });
  reasons.push({ producer: "Raise Once", consumer: "Cleric 1", tag: "recursion-target:creature", text: "Raise Once can bring back Cleric 1", repeatability: "oneshot" });
  reasons.push({ producer: "Payoff A", consumer: "Payoff B", tag: "enters:creature", text: "When Payoff A enters, Payoff B draws" });
  reasons.push({ producer: "Payoff B", consumer: "Payoff A", tag: "dies:creature", text: "When Payoff B dies, Payoff A drains" });
  reasons.push({ producer: "Commander", consumer: "Payoff A", tag: "cast:creature", text: "When Commander is cast, Payoff A scries" });
  reasons.push({ producer: "Sidekick", consumer: "Commander", tag: "enters:creature", text: "When Sidekick enters, Commander makes a token" });
  reasons.push({ producer: "Sidekick", consumer: "Cleric 3", tag: "attacks:any", text: "Whenever Sidekick attacks, Cleric 3 triggers" });
  reasons.push({ producer: "Cleric 3", consumer: "Sidekick", tag: "lifegain:any", text: "When Cleric 3 gains you life, Sidekick grows" });
  for (const c of ["Cleric 4", "Cleric 5", "Cleric 6"]) reasons.push({ producer: "Digger", consumer: c, tag: "recursion-target:creature", text: `Digger can bring back ${c}`, repeatability: "oneshot" });
  reasons.push({ producer: "Treasure", consumer: "Payoff A", tag: "creates:treasure", text: "Treasure feeds Payoff A", producerIsToken: true });
  const report = {
    commanders: ["Commander"],
    cards: names.map((name) => ({ name, isCommander: name === "Commander", score: name.startsWith("Payoff") ? 5 : 1, manaCost: name === "Doom Blade" ? "{1}{B}" : "" })),
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
