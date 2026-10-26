import { expect, test } from "vitest";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags, stripCardName } from "./derive.js";

/** `stripCardName` takes the card's name (and its first word) out of a subject before it is parsed. It matched anywhere, with no word boundary: "I Am Iron Man" lost every "i" ("artifact"
 *  read "art fact"), "Command Tower" lost "Command" out of "commander's", "Me, the Immortal" the "me" of "menace", "Chant of the Skifsang" the "en" of "enchanted", "Bushi Tenderfoot" the
 *  "bushi" of "bushido". A name is whole words (#1352 review). Real oracle text (Mongo `cards`). */
test("a name is whole words: the first word 'I', 'Command', 'Me', 'Chant', 'Bushi' cut nothing out of other words", () => {
  expect(stripCardName("target artifact or creature becomes an artifact creature", "I Am Iron Man")).toBe("target artifact or creature becomes an artifact creature");
  expect(stripCardName("in your commander's color identity", "Command Tower")).toBe("in your commander's color identity");
  expect(stripCardName("a first strike, vigilance, or menace counter on me", "Me, the Immortal")).toBe("a first strike, vigilance, or menace counter on");
  expect(stripCardName("enchanted creature gets -13/-0", "Chant of the Skifsang")).toBe("enchanted creature gets -13/-0");
  expect(stripCardName("creatures with bushido", "Bushi Tenderfoot // Kenzo the Hardhearted")).toBe("creatures with bushido");
  // ...and the name itself still goes, alone or in a longer phrase.
  expect(stripCardName("Command Tower or a creature", "Command Tower")).toBe("or a creature");
  expect(stripCardName("another creature named Tower", "Command Tower")).toBe("another creature named Tower");
});

test("Command Tower: 'commander's color identity' is not cut to \"er's\" by the name 'Command'", () => {
  const card = { name: "Command Tower", typeLine: "Land", oracleText: "{T}: Add one mana of any color in your commander's color identity.", keywords: [] as string[] };
  const g = grammarClauseRecords(card);
  const tags = deriveCardTags(deriveInputOf(card, "x", card.name, g.records, undefined, g.readings));
  expect(tags.abilities.find((a) => a.effect.kind === "mana-generation")?.effect.subject).toMatchObject({ commander: true });
});
