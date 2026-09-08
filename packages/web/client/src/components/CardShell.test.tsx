import { render, screen } from "@testing-library/react";
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
