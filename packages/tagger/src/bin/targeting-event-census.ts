/** "Becomes the target of a spell or ability" — the event Ward is (CR 702.21) and the one verb
 *  VERB_VOCAB has no word for. Parnesse, the Subtle Brush is Ward {4 life} granted to you and every
 *  permanent you control, and its clause has been stored with a PHANTOM trigger since v3 because the
 *  normalizer had no honest slot to put it in. Free, read-only.
 *
 *  Splits supply from demand, because they are answered differently: who TARGETS (every removal
 *  spell in the game — supply is not scarce) versus who PAYS OFF being targeted (the question that
 *  decides whether a verb is worth adding). */
import { connect, loadConfig } from "@mtg/data";
import { DERIVED_COLLECTION } from "../clause-store.js";

const store = await connect(loadConfig());

const TARGETED = /becomes? the targets? of/i;
const cards = await store.cards.find({ oracleText: TARGETED } as never).toArray() as unknown as
  { _id: string; name: string; typeLine?: string; oracleText?: string; keywords?: string[] }[];

const derivedIds = new Set((await store.db.collection(DERIVED_COLLECTION).find({}).project({ oracleId: 1 }).toArray())
  .map((d) => (d as unknown as { oracleId: string }).oracleId));

/** What does the card DO about being targeted? Ward-shaped is protection (a deck role, not a pairwise
 *  synergy, by the `ROLE_NOT_SYNERGY` ruling); a payoff is a real consumer. */
const shapeOf = (t: string): string => {
  if (/counter (it|that spell)[^.]*unless[^.]*pays/i.test(t)) return "ward-shaped (counter unless pays)";
  if (/\bhexproof|\bshroud|can't be the target/i.test(t)) return "grants hexproof/shroud";
  if (/\bdraw|\bcounter on|\bgets? \+|\bcreate|\bgain \d|\bdeals? \d/i.test(t)) return "PAYOFF (does something)";
  return "other";
};

const byShape = new Map<string, string[]>();
for (const c of cards) {
  // Only the sentence that carries the phrase, so an unrelated line does not decide the shape.
  const line = (c.oracleText ?? "").split("\n").find((l) => TARGETED.test(l)) ?? "";
  const key = shapeOf(line);
  byShape.set(key, [...(byShape.get(key) ?? []), `${derivedIds.has(c._id) ? "DERIVED " : "        "}${c.name}${c.keywords?.some((k) => /^ward/i.test(k)) ? " [prints Ward]" : ""}\n       ${line.trim().slice(0, 150)}`]);
}

console.log(`corpus cards whose text says "becomes the target of": ${cards.length}, of which ${cards.filter((c) => derivedIds.has(c._id)).length} in the derived corpus\n`);
for (const [k, rows] of [...byShape].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`## ${rows.length}  ${k}`);
  for (const r of rows.slice(0, 12)) console.log(`  ${r}`);
  if (rows.length > 12) console.log(`  ... and ${rows.length - 12} more`);
  console.log();
}

// Printed Ward is the same event, and there are far more of those.
const ward = await store.cards.countDocuments({ keywords: /^ward/i } as never);
console.log(`corpus cards PRINTING Ward (same event, reminder text not repeated): ${ward}`);

await store.close();
process.exit(0);
