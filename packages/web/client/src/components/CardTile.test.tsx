import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";
import { CardTile } from "./CardTile.js";
import { printingImageUrl } from "./card-node.js";
import { PeekContext, type PeekApi } from "./peek.js";

const ID = "57adbd6e-88ec-4472-a9c9-90b679fa881f";

test("a printing id rebuilds Scryfall's small card image, and garbage rebuilds nothing", () => {
  expect(printingImageUrl(ID)).toBe(`https://cards.scryfall.io/small/front/5/7/${ID}.jpg`);
  expect(printingImageUrl(ID, "normal")).toBe(`https://cards.scryfall.io/normal/front/5/7/${ID}.jpg`);
  expect(printingImageUrl("../evil")).toBeNull();
});

test("a tile is the whole card, lazy, with the name and pips; no picture still gets a framed tile", () => {
  const { container } = render(
    <MemoryRouter><CardTile slug="krenko-mob-boss" name="Krenko, Mob Boss" art={ID} identity={["R"]} caption="makes more tokens" /></MemoryRouter>,
  );
  const img = container.querySelector('img[alt$=", the card"]')!;
  expect(img.getAttribute("src")).toBe(`https://cards.scryfall.io/small/front/5/7/${ID}.jpg`);
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(img.getAttribute("alt")).toBe("Krenko, Mob Boss, the card");
  expect(screen.getByText("makes more tokens")).toBeTruthy();
  expect(screen.getByRole("link").getAttribute("href")).toBe("/cards/krenko-mob-boss");

  const bare = render(<MemoryRouter><CardTile slug="x" name="No Picture" /></MemoryRouter>);
  expect(bare.container.querySelector('img[alt$=", the card"]')).toBeNull();
  expect(bare.getByRole("img", { name: "No Picture, no picture" })).toBeTruthy();
});

test("a plain click peeks; a modified click is left to the link", () => {
  const push = vi.fn();
  const peek: PeekApi = { stack: [], push, back: () => {}, close: () => {} };
  render(
    <MemoryRouter><PeekContext.Provider value={peek}>
      <CardTile slug="krenko-mob-boss" name="Krenko, Mob Boss" art={ID} to="/commanders/krenko-mob-boss" />
    </PeekContext.Provider></MemoryRouter>,
  );
  const link = screen.getByRole("link");
  expect(link.getAttribute("href")).toBe("/commanders/krenko-mob-boss");
  fireEvent.click(link, { button: 0 });
  expect(push).toHaveBeenCalledWith("krenko-mob-boss", link);
  fireEvent.click(link, { button: 0, metaKey: true });
  expect(push).toHaveBeenCalledTimes(1);
});
