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

// THE AUTHORITATIVE SUBTYPE -> CARD TYPE MAP. `matcher/hierarchy.json` answers a DIFFERENT question
// (which card types a subtype has been printed beside) and the two disagree on 19 of 453 subtypes.
test("subtypeTypes is the CR assignment: one type each, land and creature disjoint", () => {
  const v = buildVocabulary(types, enums);
  expect(v.subtypeTypes["vehicle"]).toEqual(["artifact"]);
  expect(v.subtypeTypes["cave"]).toEqual(["land"]);
  expect(v.subtypeTypes["dragon"]).toEqual(["creature"]);
  expect(v.subtypeTypes["saga"]).toEqual(["enchantment"]);
  // A subtype claimed by both instant and sorcery keeps both -- the only genuine multi-type case.
  expect(v.subtypeTypes["arcane"]).toEqual(["instant", "sorcery"]);
  const lands = new Set(v.landSubtypes);
  expect(v.creatureSubtypes.filter((s) => lands.has(s))).toEqual([]);
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
  // The guard is about the FREE-TEXT set, not the whole module: `SUBTYPE_TYPES` below it maps every
  // subtype to its card type and legitimately names planeswalker ones. Scoped to the SUBTYPES
  // literal, which is what `parseSubject` matches against.
  const freeText = src.slice(src.indexOf("export const SUBTYPES"), src.indexOf("export const LAND_SUBTYPES"));
  expect(freeText).not.toContain('"chandra"');
  expect(freeText).not.toContain('"will"');
  // GENERATED, so nobody hand-edits it back into rot.
  expect(src).toContain("GENERATED");
});

// A land subtype is the one kind that means MANA BASE rather than typal — a fetchland naming Swamp
// is ramp, not a Swamp-tribal payoff — so callers need to tell them apart without a hardcoded list.
test("land subtypes are emitted separately as well as pooled", () => {
  const v = buildVocabulary(types, enums);
  expect(v.landSubtypes).toEqual(["cave", "gate"]);
  expect(v.permanentSubtypes).toContain("cave");
});

test("the rendered module exports the land subtypes too", () => {
  const src = renderSubtypesModule(buildVocabulary(types, enums));
  expect(src).toContain("export const LAND_SUBTYPES: ReadonlySet<string> = new Set([");
});
