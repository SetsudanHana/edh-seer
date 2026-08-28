import { describe, expect, it } from "vitest";
import { deckExportText } from "./deck-export.js";

// The header words are asserted literally rather than round-tripped through `parseDecklistSections`:
// importing `@edh-seer/data` here drags the engine's file-reading module graph into jsdom. "Commander"
// and "Deck" are Moxfield's own section names, which is what both that parser and the next tool read.
describe("deckExportText", () => {
  it("names the commander section and keeps copy counts verbatim", () => {
    expect(deckExportText("1 Samut, the Driving Force", "1 Sol Ring\n4 Rat Colony")).toBe(
      "Commander\n1 Samut, the Driving Force\n\nDeck\n1 Sol Ring\n4 Rat Colony\n",
    );
  });

  it("adds no header when no commander was typed", () => {
    expect(deckExportText("  ", "1 Sol Ring")).toBe("1 Sol Ring\n");
  });
});
