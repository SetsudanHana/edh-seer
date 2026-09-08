import { render } from "@testing-library/react";
import { expect, test } from "vitest";
import { CardArt } from "./CardArt.js";

/** THE CARD IMAGE IS THE PAGE'S LARGEST CONTENTFUL PAINT, and it was lazy. Lighthouse mobile on
 *  `/cards/skullclamp`, 2026-09-08: LCP 4.4 s, `lcp-lazy-loaded` failed outright, the element being
 *  this `<img>`. A lazy LCP image waits for layout AND for the bundle before its request starts;
 *  eager with high priority lets the browser fetch it the moment it sees the tag. */
test("the card image is fetched eagerly and at high priority", () => {
  const { container } = render(
    <CardArt artCrop="https://cards.scryfall.io/art_crop/front/8/2/824b2d73.jpg" name="Skullclamp" />,
  );
  const img = container.querySelector("img")!;
  expect(img.getAttribute("loading")).toBe("eager");
  expect(img.getAttribute("fetchpriority")).toBe("high");
});
