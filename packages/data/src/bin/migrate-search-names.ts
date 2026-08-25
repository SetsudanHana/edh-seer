/** FREE — Mongo only, no network, no model. Brings persisted `searchNames` in line with
 *  `toCardDoc`'s corrected rule (roadmap I3).
 *
 *  WHY A MIGRATION AND NOT A RE-INGEST. `searchNames` has TWO writers: `toCardDoc` builds it from
 *  the card's names, and `ingestFlavorNames` `$addToSet`s Secret Lair / Universes Beyond flavor
 *  names onto it afterwards. A re-ingest would rebuild the first and DROP the second until the
 *  flavor pass ran again — this touches only the keys the defect created and leaves every other one,
 *  flavor names included, exactly where it is.
 *
 *  IT REMOVES TWO THINGS AND ADDS NOTHING:
 *    - a NON-FRONT face name ("rampant growth" on Studious First-Year // Rampant Growth), which is
 *      the collision itself;
 *    - the EMPTY key, which cannot be typed deliberately and made any line that cleaned to empty
 *      resolve at random.
 *
 *  A FLAVOR NAME THAT COINCIDES WITH A BACK-FACE NAME WOULD BE REMOVED TOO. Measured at zero on the
 *  current corpus, and stated rather than guarded: distinguishing them needs provenance this field
 *  does not carry, and the flavor pass is idempotent — re-running `ingest-flavor-names` restores any
 *  such key.
 *
 *    npx tsx packages/data/src/bin/migrate-search-names.ts            dry run, prints the diff
 *    npx tsx packages/data/src/bin/migrate-search-names.ts --run      writes */
import { connect } from "../db.js";
import { loadConfig } from "../config.js";
import { normalizeName } from "../names.js";
import type { CardDoc } from "../docs.js";

const RUN = process.argv.includes("--run");
const store = await connect(loadConfig());

const cards = await store.cards.find({}).toArray();
let changed = 0;
let removedFaces = 0;
let removedEmpty = 0;
const samples: string[] = [];

for (const c of cards as CardDoc[]) {
  const current = c.searchNames ?? [];
  // The names `toCardDoc` is entitled to index: the whole name, and the FRONT face when the card
  // has one. Everything else in the array is either a flavor name (keep) or the defect (drop).
  const faces = c.name.includes(" // ") ? c.name.split(" // ").map((s) => s.trim()) : [];
  const backFaceKeys = new Set(faces.slice(1).map(normalizeName));
  const next = current.filter((k) => k !== "" && !backFaceKeys.has(k));
  if (next.length === current.length) continue;
  changed++;
  removedFaces += current.filter((k) => backFaceKeys.has(k)).length;
  removedEmpty += current.filter((k) => k === "").length;
  if (samples.length < 12) samples.push(`${c.name}: ${JSON.stringify(current)} -> ${JSON.stringify(next)}`);
  // A CARD WHOSE ONLY KEY WAS THE EMPTY STRING KEEPS IT. `_____` really is named that, its name
  // normalizes to nothing, and leaving it unreachable would be a second defect — the empty key is
  // wrong when it SHADOWS a real name, not in itself.
  if (next.length === 0) { changed--; continue; }
  if (RUN) await store.cards.updateOne({ _id: c._id }, { $set: { searchNames: next } });
}

console.log(`${cards.length} cards · ${changed} would change`);
console.log(`  back-face keys removed: ${removedFaces} · empty keys removed: ${removedEmpty}`);
console.log(samples.map((s) => `  ${s}`).join("\n"));
console.log(RUN ? "\nWRITTEN." : "\nDRY RUN — nothing written. Re-run with --run.");
await store.close();
