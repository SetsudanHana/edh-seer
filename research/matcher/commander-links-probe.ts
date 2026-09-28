/** ONE-SHOT (#681): how many of its own precon's cards each named commander links to, from the
 *  CURRENT Mongo derive -- no static build. Prints the linked cards and each link's tag.
 *
 *    npx tsx research/matcher/commander-links-probe.ts "Political Puppets" "Entropic Uprising" "Maestros Massacre" */
import { readFileSync } from "node:fs";
import { connect, docToCard, loadConfig } from "../../packages/data/src/index.js";
import { directedReasons } from "../../packages/matcher/src/edges.js";
import { loadHierarchy } from "../../packages/matcher/src/hierarchy.js";
import type { DeckCard } from "../../packages/matcher/src/types.js";

const precons = JSON.parse(readFileSync("packages/data/precons.json", "utf8")) as { name: string; commanders: string[]; cards: { name: string }[] }[];
const store = await connect(loadConfig());
const h = loadHierarchy();
const dcOf = async (name: string): Promise<DeckCard | null> => {
  const card = await store.cards.findOne({ name }) ?? await store.cards.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} //`) });
  if (!card) return null;
  const tags = await store.db.collection("cardTagsDerived").findOne({ oracleId: card._id });
  return tags ? ({ card: { ...card, ...docToCard(card) }, tags } as unknown as DeckCard) : null;
};
for (const deckName of process.argv.slice(2)) {
  const p = precons.find((x) => x.name === deckName)!;
  const cmd = (await dcOf(p.commanders[0]!))!;
  const linked = new Map<string, Set<string>>();
  for (const { name } of p.cards) {
    if (name === cmd.card.name) continue;
    const d = await dcOf(name);
    if (!d) continue;
    for (const r of [...directedReasons(d, cmd, h), ...directedReasons(cmd, d, h)]) (linked.get(name) ?? linked.set(name, new Set()).get(name)!).add(r.tag);
  }
  console.log(`${deckName} (${cmd.card.name}): ${linked.size} cards linked`);
  for (const [n, tags] of [...linked].slice(0, 40)) console.log(`   ${n}: ${[...tags].join(", ")}`);
}
await store.close();
