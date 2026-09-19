/** ROADMAP AJ4 / spec C4: how many derived abilities have no clause to sit under?
 *
 *  An IMPLIED ability is read off characteristics rather than rules text -- a keyword body, a
 *  token's own line -- so it has no printed clause to attribute to and renders at the end of the
 *  card page's list with no quote above it. Until DERIVE 164 stamped `clause`, nothing
 *  distinguished them, which is why the spec left the count open.
 *
 *  Free, read-only. Run from the repo root with the env sourced.
 */
import { connect, loadConfig } from "@edh-seer/data";

interface Ab { clause?: number; kind?: string; effect?: { kind?: string } }

async function main(): Promise<void> {
  const { db, close } = await connect(loadConfig());
  const cur = db.collection("cardTagsDerived").find({}, { projection: { abilities: 1 } });
  let cards = 0, abilities = 0, noClause = 0, cardsWithImplied = 0;
  const shapes = new Map<string, number>();
  for await (const doc of cur) {
    const list = ((doc as { abilities?: Ab[] }).abilities ?? []);
    if (list.length === 0) continue;
    cards++;
    let any = false;
    for (const a of list) {
      abilities++;
      if (a.clause !== undefined) continue;
      noClause++; any = true;
      const shape = `${a.kind ?? "?"} / ${a.effect?.kind || "(no effect kind)"}`;
      shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
    }
    if (any) cardsWithImplied++;
  }
  console.log(`cards with abilities : ${cards}`);
  console.log(`abilities            : ${abilities}`);
  console.log(`WITHOUT a clause     : ${noClause} (${(noClause / abilities * 100).toFixed(1)}%), on ${cardsWithImplied} cards`);
  for (const [shape, n] of [...shapes].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`   ${String(n).padStart(6)}  ${shape}`);
  }
  await close();
}
void main();
