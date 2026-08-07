import { describe, expect, it } from "vitest";
import { CARD_MODE_Z, cardImageUrl, faceArtOf, renderModeFor } from "./card-node.js";

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

describe("faceArtOf", () => {
  const faces = new Map([["face:1:1", "https://x/back.jpg"]]);

  it("returns the card's own art when not flipped", () => {
    expect(faceArtOf("card:1", "https://x/front.jpg", false, faces)).toBe("https://x/front.jpg");
  });

  it("returns the second face's art when flipped", () => {
    expect(faceArtOf("card:1", "https://x/front.jpg", true, faces)).toBe("https://x/back.jpg");
  });

  it("falls back to the front art when flipped with no second face", () => {
    expect(faceArtOf("card:2", "https://x/front.jpg", true, faces)).toBe("https://x/front.jpg");
  });
});
