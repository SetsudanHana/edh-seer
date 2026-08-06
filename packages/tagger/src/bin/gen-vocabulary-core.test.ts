import { expect, test } from "vitest";
import { buildVocabulary, renderSubtypesModule } from "./gen-vocabulary-core.js";

const types = {
  data: {
    artifact: { subTypes: ["Equipment", "Vehicle"], superTypes: [] },
    battle: { subTypes: ["Siege"], superTypes: [] },
    creature: { subTypes: ["Rat", "Dragon", "Shapeshifter"], superTypes: [] },
    enchantment: { subTypes: ["Aura", "Saga"], superTypes: [] },
    land: { subTypes: ["Cave", "Gate"], superTypes: [] },
    planeswalker: { subTypes: ["Chandra", "Jace", "Will"], superTypes: [] },
    instant: { subTypes: ["Arcane", "Lesson"], superTypes: [] },
    sorcery: { subTypes: ["Arcane", "Adventure"], superTypes: [] },
    plane: { subTypes: ["Dominaria"], superTypes: [] },
    phenomenon: { subTypes: [], superTypes: [] },
  },
};
const enums = {
  data: {
    card: { subtypes: [], supertypes: ["Basic", "Legendary", "Snow", "World", "Host", "Ongoing"], types: [] },
    keywords: { abilityWords: ["Landfall"], keywordAbilities: ["Flying"], keywordActions: ["Investigate", "Populate"] },
  },
};

test("permanent subtypes are pooled from the five permanent card types", () => {
  const v = buildVocabulary(types, enums);
  expect(v.permanentSubtypes).toContain("vehicle");
  expect(v.permanentSubtypes).toContain("siege");
  expect(v.permanentSubtypes).toContain("rat");
  expect(v.permanentSubtypes).toContain("cave");
});

// "will" is a planeswalker type AND an ordinary English word. Merging the planeswalker set into the
// free-text set would let any sentence containing "will" narrow a subject, trading a real edge for a
// silent false one. They are emitted separately, not dropped: Chandra tribal is a real deck.
test("planeswalker subtypes are kept out of the free-text set but not discarded", () => {
  const v = buildVocabulary(types, enums);
  expect(v.permanentSubtypes).not.toContain("will");
  expect(v.permanentSubtypes).not.toContain("chandra");
  expect(v.planeswalkerSubtypes).toEqual(["chandra", "jace", "will"]);
});

test("spell subtypes are pooled across instant and sorcery, deduped", () => {
  expect(buildVocabulary(types, enums).spellSubtypes).toEqual(["adventure", "arcane", "lesson"]);
});

test("the supertypes are the closed six", () => {
  expect(buildVocabulary(types, enums).supertypes)
    .toEqual(["basic", "host", "legendary", "ongoing", "snow", "world"]);
});

test("the rendered module is valid TypeScript exporting a Set of every permanent subtype", () => {
  const src = renderSubtypesModule(buildVocabulary(types, enums));
  expect(src).toContain("export const SUBTYPES: ReadonlySet<string> = new Set([");
  expect(src).toContain('"vehicle"');
  expect(src).not.toContain('"chandra"');
  // GENERATED, so nobody hand-edits it back into rot.
  expect(src).toContain("GENERATED");
});
