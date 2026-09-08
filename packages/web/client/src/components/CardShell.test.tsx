import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import { CardShell } from "./CardShell.js";
import type { CardPageData } from "../lib/partners.js";

/** ONE PAGE SHAPE, TWO SURFACES (spec 2026-09-08 part 2): the same header, tabs, rail and foot
 *  under either URL; the commander tab only for a card that can lead. */
const page = (commander: boolean): CardPageData => ({
  name: "Krenko, Mob Boss", typeLine: "Legendary Creature — Goblin Warrior", manaCost: "{2}{R}{R}",
  artCrop: "https://cards.scryfall.io/art_crop/front/8/2/x.jpg", backArtCrop: null, abilities: [],
  identity: ["R"], commander, emits: [], demands: [], partners: [], pool: {}, rarity: {},
});
const mount = (commander: boolean, surface: "card" | "commander") => render(
  <MemoryRouter initialEntries={[`/${surface === "card" ? "cards" : "commanders"}/krenko-mob-boss`]}>
    <CardShell page={page(commander)} slug="krenko-mob-boss" surface={surface}><p>body</p></CardShell>
  </MemoryRouter>,
);

test("a commander card shows both tabs, the current one marked", () => {
  mount(true, "card");
  const links = screen.getByRole("navigation", { name: "Surface" }).querySelectorAll("a");
  expect([...links].map((a) => a.textContent)).toEqual(["As a card", "As a commander"]);
  expect(links[0]).toHaveAttribute("aria-current", "page");
  expect(links[1]).toHaveAttribute("href", "/commanders/krenko-mob-boss");
  expect(links[1]).not.toHaveAttribute("aria-current");
});

test("a card that cannot lead shows the card tab only", () => {
  mount(false, "card");
  expect(screen.getByRole("navigation", { name: "Surface" }).querySelectorAll("a")).toHaveLength(1);
});

test("the header, the body and the rail are one shape on either surface", () => {
  mount(true, "commander");
  expect(screen.getByRole("heading", { level: 2, name: /Krenko, Mob Boss/ })).toBeTruthy();
  expect(screen.getByText("body")).toBeTruthy();
  expect(screen.getByRole("img", { name: /the card, including its rules text/ })).toBeTruthy();
  expect(screen.getByRole("navigation", { name: "Surface" }).querySelectorAll("a")[1]).toHaveAttribute("aria-current", "page");
  // The foot's way out, on both surfaces.
  expect(screen.getByRole("link", { name: "How the engine decides" })).toBeTruthy();
});

/** THE ROWS TURN WITH THE PICTURE (owner, 2026-09-08: "we can flip the double faced card, but we see
 *  all the events for both at the same time"). Front rows by default, back rows after the flip, a
 *  line naming the face on view. A single-face card shows every row and no line. */
test("flipping a two-faced card flips the ability rows with it", () => {
  const chandra: CardPageData = {
    ...page(true),
    name: "Chandra, Fire of Kaladesh // Chandra, Roaring Flame",
    backArtCrop: "https://cards.scryfall.io/art_crop/back/8/2/x.jpg",
    abilities: [
      { kind: "triggered", when: ["cast|spell|-|-"], effect: "untap", emits: [] },
      { kind: "activated", cost: "−7", when: [], effect: "emblem", recipient: "opp", emits: [], face: 1 },
    ],
  };
  render(
    <MemoryRouter initialEntries={["/cards/chandra"]}>
      <CardShell page={chandra} slug="chandra" surface="card"><p>body</p></CardShell>
    </MemoryRouter>,
  );
  expect(screen.getAllByText(/Chandra, Fire of Kaladesh · flip the card/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/untaps a permanent/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/gives each opponent an emblem/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Flip to Chandra, Roaring Flame/ }));
  expect(screen.getAllByText(/Chandra, Roaring Flame · flip the card/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/gives each opponent an emblem/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/untaps a permanent/)).toBeNull();
});

test("a single-face card shows every row and no face line", () => {
  const krenko: CardPageData = { ...page(true), abilities: [{ kind: "activated", cost: "{T}", when: [], effect: "token-generation", emits: [] }] };
  render(
    <MemoryRouter initialEntries={["/cards/krenko-mob-boss"]}>
      <CardShell page={krenko} slug="krenko-mob-boss" surface="card"><p>body</p></CardShell>
    </MemoryRouter>,
  );
  expect(screen.getAllByText(/makes a token/).length).toBeGreaterThan(0);
  expect(screen.queryByText(/flip the card for the other face/)).toBeNull();
});
