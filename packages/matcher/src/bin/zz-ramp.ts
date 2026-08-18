/** The three shapes a land-finder can take, and how many cards are in each. */
import { connect, loadConfig } from "@mtg/data";
import { LAND_SUBTYPES, type CardTags } from "@mtg/tagger";

const store = await connect(loadConfig());
const derived = store.db.collection<CardTags>("cardTagsDerived");
const list = (v: unknown): string[] => (v === undefined ? [] : Array.isArray(v) ? v as string[] : [String(v)]);

const shapes = { subtype: [] as string[], basic: [] as string[], bareLand: [] as string[] };
for (const t of await derived.find({ "abilities.effect.kind": "top-manipulation" }).toArray()) {
  const card = await store.cards.findOne({ _id: t.oracleId } as never) as unknown as { name: string } | null;
  for (const a of t.abilities ?? []) {
    if (a.effect.kind !== "top-manipulation" || !a.effect.subject) continue;
    const s = a.effect.subject;
    const subs = [...list(s.subtype), ...(s.anyOf ?? []).flatMap((b) => list(b.subtype))];
    const types = [...list(s.type), ...(s.anyOf ?? []).flatMap((b) => list(b.type))];
    const landSubs = subs.length > 0 && subs.every((x) => LAND_SUBTYPES.has(x));
    const isLandType = types.includes("land");
    if (landSubs) shapes.subtype.push(`${card?.name} [${subs.join("/")}]`);
    else if (isLandType && s.basic === true) shapes.basic.push(`${card?.name}`);
    else if (isLandType && subs.length === 0) shapes.bareLand.push(`${card?.name}`);
  }
}
for (const [k, v] of Object.entries(shapes)) {
  console.log(`\n${k}: ${v.length}`);
  for (const x of [...new Set(v)].slice(0, 14)) console.log(`   ${x}`);
}
await store.close();
