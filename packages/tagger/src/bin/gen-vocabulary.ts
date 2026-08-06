/** Regenerates the engine's closed vocabularies from MTGJSON.
 *
 *  FREE: two static JSON files, no API key, no model, no spend. Re-run it whenever Wizards prints a
 *  new type — the whole point is that nobody has to remember which list needs a new word.
 *
 *  Writes:
 *    packages/tagger/src/derive/subtypes.ts   the permanent subtypes `parseSubject` matches
 *    packages/tagger/vocabulary.json          everything else, for callers that want it
 *
 *  Usage: tsx src/bin/gen-vocabulary.ts [--check]
 *    --check writes nothing and exits non-zero if the artifacts are stale, for CI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildVocabulary, renderSubtypesModule,
  type CardTypesPayload, type EnumValuesPayload,
} from "./gen-vocabulary-core.js";

const CARD_TYPES_URL = "https://mtgjson.com/api/v5/CardTypes.json";
const ENUM_VALUES_URL = "https://mtgjson.com/api/v5/EnumValues.json";

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const [types, enums] = await Promise.all([
    fetch(CARD_TYPES_URL).then((r) => r.json() as Promise<CardTypesPayload>),
    fetch(ENUM_VALUES_URL).then((r) => r.json() as Promise<EnumValuesPayload>),
  ]);
  const vocab = buildVocabulary(types, enums);

  const here = dirname(fileURLToPath(import.meta.url));
  const subtypesPath = join(here, "..", "derive", "subtypes.ts");
  const vocabPath = join(here, "..", "..", "vocabulary.json");
  const rendered = renderSubtypesModule(vocab);
  const json = `${JSON.stringify(vocab, null, 1)}\n`;

  if (check) {
    const stale = [
      readFileSync(subtypesPath, "utf8") !== rendered ? "subtypes.ts" : "",
      readFileSync(vocabPath, "utf8") !== json ? "vocabulary.json" : "",
    ].filter(Boolean);
    if (stale.length) {
      console.error(`STALE: ${stale.join(", ")} — re-run gen-vocabulary.ts`);
      process.exit(1);
    }
    console.log("vocabulary artifacts are current");
    return;
  }

  writeFileSync(subtypesPath, rendered);
  writeFileSync(vocabPath, json);
  console.log(
    `permanent subtypes ${vocab.permanentSubtypes.length} | planeswalker ${vocab.planeswalkerSubtypes.length}`
    + ` | spell ${vocab.spellSubtypes.length} | plane ${vocab.planeSubtypes.length}`
    + ` | supertypes ${vocab.supertypes.length} | keyword actions ${vocab.keywordActions.length}`
    + ` | keyword abilities ${vocab.keywordAbilities.length} | ability words ${vocab.abilityWords.length}`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
