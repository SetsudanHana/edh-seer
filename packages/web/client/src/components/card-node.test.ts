import { describe, expect, it } from "vitest";
import {
  CARD_MODE_Z, MAX_Z, PREFETCH_Z, cardImageUrl, isOnScreen, renderModeFor, shouldPrefetchCard,
} from "./card-node.js";

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

// Card mode's image is a different file from the disc's, so crossing CARD_MODE_Z used to START a
// fetch and the card arrived as a placeholder. Prefetching the HOVERED card is the alternative to
// "fetch normal once and crop it for the disc", which was built, rendered against the true art_crop
// and rejected: normal is ~1.5x the bytes (Sol Ring 71KB vs 44KB) so a 100-card deck's open goes
// ~5.0MB -> ~7.5MB, and a fixed crop box showed a Saga's CHAPTER TEXT instead of its art.
describe("shouldPrefetchCard", () => {
  it("starts before card mode, so the image can land before the card is drawn", () => {
    expect(PREFETCH_Z).toBeLessThan(CARD_MODE_Z);
    expect(shouldPrefetchCard(PREFETCH_Z)).toBe(true);
    expect(shouldPrefetchCard(CARD_MODE_Z)).toBe(true);
  });

  it("fetches nothing extra at whole-deck zoom, which is what the rejected version cost", () => {
    expect(shouldPrefetchCard(1)).toBe(false);
    expect(shouldPrefetchCard(PREFETCH_Z - 0.01)).toBe(false);
  });
});

// WHICH cards get their full image warmed. Hover alone did not work in practice — a wheel zoom need
// not move the pointer, so `pointermove` may never fire, and when it does it fires on arrival with
// no lead time. The viewport is what bounds the cost: warming all 95 is the ~7.5MB that got the
// cropped-disc approach rejected.
describe("isOnScreen", () => {
  const cam = { x: 0, y: 0, z: 1 };
  const dim = { w: 800, h: 600 };

  it("is true inside the canvas and false beyond it", () => {
    expect(isOnScreen({ x: 400, y: 300 }, cam, dim)).toBe(true);
    expect(isOnScreen({ x: 0, y: 0 }, cam, dim)).toBe(true);
    expect(isOnScreen({ x: 801, y: 300 }, cam, dim)).toBe(false);
    expect(isOnScreen({ x: 400, y: -1 }, cam, dim)).toBe(false);
  });

  it("applies the camera, so panning changes what counts", () => {
    // The same world point, with the board panned 500px left, is off the left edge.
    expect(isOnScreen({ x: 100, y: 100 }, { x: -500, y: 0, z: 1 }, dim)).toBe(false);
    // ...and zoom moves it too: at 4x, world 100 sits at screen 400.
    expect(isOnScreen({ x: 100, y: 100 }, { x: 0, y: 0, z: 4 }, dim)).toBe(true);
    expect(isOnScreen({ x: 300, y: 100 }, { x: 0, y: 0, z: 4 }, dim)).toBe(false);
  });

  it("counts a card half-way in, which is the next one to be centred", () => {
    expect(isOnScreen({ x: 810, y: 300 }, cam, dim)).toBe(false);
    expect(isOnScreen({ x: 810, y: 300 }, cam, dim, 20)).toBe(true);
  });
});
