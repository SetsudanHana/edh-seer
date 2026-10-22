// LOCAL RESEARCH ONLY (#1302): census of the library->hand `put` actions that are NOT a search, against what cardTagsDerived made of them.
// FREE: reads Mongo (cards + cardTagsDerived), writes nothing. Run from the repo root after `set -a && source packages/tagger/.env && set +a`:
//   npx tsx research/tagger/to-hand-census.ts            -- counts
//   LIST=residue npx tsx research/tagger/to-hand-census.ts -- every card whose text says "into your hand" off the top with no `to-hand`, and why
import { connect, loadConfig } from "@edh-seer/data";

const store = await connect(loadConfig());
type Ab = { clause?: number; effect: { kind: string }; chooses?: boolean; amount?: string; toHand?: string; named?: boolean; netZero?: boolean };
type Row = { name: string; oracleId: string; abilities?: Ab[]; unclaimed?: { clause: number | string; verb: string; fromZone?: string; toZone?: string; object?: string }[] };
const derived = store.db.collection<Row>("cardTagsDerived");
let unclaimedActions = 0; const unclaimedCards = new Set<string>();
const toHand: Ab[] = []; const toHandCards = new Set<string>(); const byAmount = new Map<string, number>(), byChoice = new Map<string, number>();
const residue: string[] = []; let typedDigs = 0, typedMarked = 0; const typedByAmount = new Map<string, number>(), typedCards = new Set<string>();
for await (const row of derived.find({})) {
  const card = await store.cards.findOne({ _id: row.oracleId } as never, { projection: { name: 1, oracleText: 1, legalities: 1 } }) as never as { name?: string; oracleText?: string; legalities?: { commander?: string } } | null;
  const name = card?.name ?? row.name ?? row.oracleId;
  for (const u of row.unclaimed ?? []) if (u.verb === "put" && u.fromZone === "library" && u.toZone === "hand") { unclaimedActions++; unclaimedCards.add(name); }
  const mine = (row.abilities ?? []).filter((a) => a.effect.kind === "to-hand");
  for (const a of row.abilities ?? []) if (a.toHand !== undefined) { typedMarked++; typedByAmount.set(a.toHand, (typedByAmount.get(a.toHand) ?? 0) + 1); typedCards.add(name); }
  for (const a of mine) {
    toHand.push(a); const k = String(a.amount ?? "?");
    byAmount.set(k, (byAmount.get(k) ?? 0) + 1);
    const c = String(a.chooses ?? false);
    byChoice.set(c, (byChoice.get(c) ?? 0) + 1);
    toHandCards.add(name);
  }
  const text = (card?.oracleText ?? "").replace(/\([^)]*\)/g, ""); // reminder text (explore, discover, mill) is not a clause
  const typedDig = (row.abilities ?? []).some((a) => a.effect.kind === "search");
  // The printed claim: the TOP of the library, a put/take into hand, no search word anywhere. Graveyard and exile returns say "from your graveyard" and are not caught.
  if (!mine.length && typedDig && /\btop\b[^.]*\blibrary\b/i.test(text) && /\binto (?:your|their|its owner's|that player's) hand\b/i.test(text) && !/\bsearch/i.test(text)) typedDigs++;
  else if (!mine.length && /\btop\b[^.]*\blibrary\b/i.test(text) && /\binto (?:your|their|its owner's|that player's) hand\b/i.test(text) && !/\bsearch/i.test(text)) {
    const unc = (row.unclaimed ?? []).filter((u) => u.verb === "put" && u.toZone === "hand").length;
    residue.push(`${name} | unclaimed-put-hand=${unc} | ${text.replace(/\n/g, " / ").slice(0, 600)}`);
  }
}
console.log(`unclaimed put library>hand: ${unclaimedActions} actions on ${unclaimedCards.size} cards`);
console.log(`to-hand abilities: ${toHand.length} on ${toHandCards.size} cards; by amount ${JSON.stringify([...byAmount])}; by chooses ${JSON.stringify([...byChoice])}`);
console.log(`typed digs with Ability.toHand (still search, also hand-fill): ${typedMarked} abilities on ${typedCards.size} cards; by count ${JSON.stringify([...typedByAmount])}`);
console.log(`typed digs (derive search by the 2026-09-16 ruling, not to-hand): ${typedDigs}`);
console.log(`residue (text puts a library card into hand, no search, no to-hand): ${residue.length}`);
if (process.env.LIST === "residue") for (const r of residue.sort()) console.log("RES |", r);
await store.close();
