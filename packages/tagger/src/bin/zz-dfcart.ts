/** Do double-faced cards carry an artCrop at all? Scryfall puts `image_uris` on each FACE for a
 *  two-faced card and omits the top-level one, so a naive read gets nothing. */
import { connect, loadConfig } from "@mtg/data";
const s = await connect(loadConfig());
const cards = s.db.collection("cards");

const dfc = { typeLine: /\/\// };
const total = await cards.countDocuments({});
const dfcTotal = await cards.countDocuments(dfc);
const dfcWithArt = await cards.countDocuments({ ...dfc, artCrop: { $exists: true, $ne: null } });
const singleTotal = await cards.countDocuments({ typeLine: { $not: /\/\// } });
const singleWithArt = await cards.countDocuments({ typeLine: { $not: /\/\// }, artCrop: { $exists: true, $ne: null } });
console.log(`corpus ${total}`);
console.log(`  double-faced ${dfcTotal}, with artCrop ${dfcWithArt} (${(dfcWithArt / dfcTotal * 100).toFixed(1)}%)`);
console.log(`  single-faced ${singleTotal}, with artCrop ${singleWithArt} (${(singleWithArt / singleTotal * 100).toFixed(1)}%)`);

for (const n of ["Westvale Abbey // Ormendahl, Profane Prince", "Brazen Borrower // Petty Theft",
  "Fell the Profane // Fell Mire", "Sol Ring"]) {
  const c = await cards.findOne({ name: n }, { projection: { name: 1, layout: 1, artCrop: 1, faces: 1 } }) as never as
    { name: string; layout?: string; artCrop?: string; faces?: { name: string; artCrop?: string }[] } | null;
  console.log(`\n${c?.name}  [${c?.layout}]`);
  console.log(`  card.artCrop: ${c?.artCrop ?? "MISSING"}`);
  for (const f of c?.faces ?? []) console.log(`  face ${f.name}: ${f.artCrop ?? "MISSING"}`);
}
process.exit(0);
