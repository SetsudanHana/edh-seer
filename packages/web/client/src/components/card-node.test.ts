import { describe, expect, it } from "vitest";
import { CARD_MODE_Z, MAX_Z, cardImageUrl, renderModeFor } from "./card-node.js";

describe("renderModeFor", () => {
  it("is miniature below the threshold and card at or above it", () => {
    expect(renderModeFor(1)).toBe("miniature");
    expect(renderModeFor(CARD_MODE_Z - 0.01)).toBe("miniature");
    expect(renderModeFor(CARD_MODE_Z)).toBe("card");
    expect(renderModeFor(20)).toBe("card");
  });
});

describe("cardImageUrl", () => {
  it("swaps the art_crop path segment for normal", () => {
    expect(cardImageUrl("https://cards.scryfall.io/art_crop/front/6/2/abc.jpg?123"))
      .toBe("https://cards.scryfall.io/normal/front/6/2/abc.jpg?123");
  });

  it("leaves a URL that is not an art_crop alone", () => {
    expect(cardImageUrl("https://example.com/x.jpg")).toBe("https://example.com/x.jpg");
  });

  it("only replaces the size segment, not a card id that happens to contain it", () => {
    expect(cardImageUrl("https://cards.scryfall.io/art_crop/front/a/b/art_crop.jpg"))
      .toBe("https://cards.scryfall.io/normal/front/a/b/art_crop.jpg");
  });
});

describe("zoom bounds", () => {
  it("puts card mode within reach and leaves headroom above it", () => {
    // The constraint is MAX_Z > CARD_MODE_Z, not a fixed offset: a flat ceiling of 5 once sat
    // BELOW the threshold (6) and made card mode unreachable by scrolling at all.
    expect(MAX_Z).toBeGreaterThan(CARD_MODE_Z);
  });

  it("switches to card mode at 4, where a card paints ~157px tall", () => {
    expect(CARD_MODE_Z).toBe(4);
    expect(renderModeFor(4)).toBe("card");
    expect(renderModeFor(3.99)).toBe("miniature");
  });
});
