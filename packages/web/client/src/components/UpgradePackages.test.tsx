import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test } from "vitest";
import type { UpgradePackage, UpgradeSwap } from "@edh-seer/matcher/upgrade-package";
import type { PreconPage } from "../lib/precon-page.js";
import { beside, UpgradePackages } from "./UpgradePackages.js";
import { CardDrawerProvider } from "./card-drawer.js";

const swap = (out: string, into: string): UpgradeSwap => ({
  kind: "land", out: { name: out, reason: `${out} enters tapped.` }, in: { name: into, reason: `${into} never enters tapped and makes white or black.` },
});
const pkg = (target: 2 | 3 | 4, lands: number, bringDown: UpgradeSwap[] = []): UpgradePackage => ({
  target, from: "3", bringDown,
  sections: [
    { id: "lands", swaps: Array.from({ length: lands }, (_, i) => swap(`Tapped ${i}`, `Untapped ${i}`)) },
    { id: "ramp", swaps: [] },
  ],
});
const page = (over: Partial<PreconPage> = {}): PreconPage => ({
  slug: "p", name: "P", setCode: "X", setName: "X", releaseDate: null, commanders: ["C"], identity: ["W", "B"], theme: null, synergy: null,
  bracket: { band: "3", gameChangers: 1, combos: 0 }, commanderLinks: 0, swaps: [], route: null, gaps: [], decklist: [],
  packages: [pkg(2, 2, [{ kind: "bring-down", out: { name: "Smothering Tithe", reason: "Smothering Tithe is on the official Game Changer list." }, in: { name: "Mind Stone", reason: "Mind Stone does the same ramp." } }]), pkg(3, 5), pkg(4, 1)],
  ...over,
});
const show = (p: PreconPage) => render(<MemoryRouter><UpgradePackages page={p} /></MemoryRouter>);

test("opens on the bracket the precon already sits in, and says what that bracket allows", () => {
  show(page());
  expect(screen.getByRole("button", { name: "Bracket 3" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText(/Up to three Game Changers/)).toBeInTheDocument();
  expect(screen.getByText(/after them the deck still fits bracket 3/)).toBeInTheDocument();
});

test("a section shows three swaps, and the rest on request", () => {
  show(page());
  const lands = screen.getByRole("heading", { name: "Lands · 5" }).parentElement!;
  expect(within(lands).getAllByRole("listitem")).toHaveLength(3);
  fireEvent.click(within(lands).getByRole("button", { name: "Show 2 more" }));
  expect(within(lands).getAllByRole("listitem")).toHaveLength(5);
  // The fold's total sits in the heading the reader counts from (#991).
  expect(screen.getByRole("heading", { name: "Lands · 5" })).toBeInTheDocument();
  // An empty section is not drawn.
  expect(screen.queryByRole("heading", { name: "Ramp" })).toBeNull();
});

test("switching down a bracket shows the cuts that get the deck there first", () => {
  show(page());
  fireEvent.click(screen.getByRole("button", { name: "Bracket 1–2" }));
  expect(screen.getByRole("heading", { name: "First, to reach bracket 1–2 · 1" })).toBeInTheDocument();
  expect(screen.getByText(/It starts at bracket 3, so the first swap brings it down/)).toBeInTheDocument();
});

test("the summary says what the swaps do to the synergy score, and when a higher bracket changes nothing", () => {
  const two = { ...pkg(2, 2), after: { band: "1-2" as const, synergy: 3.4, mana: 0.9 } };
  const three = { ...pkg(3, 2), after: { band: "1-2" as const, synergy: 3.4, mana: 0.9 } };
  show(page({ bracket: { band: "1-2", gameChangers: 0, combos: 0 }, synergy: { score: 3, band: "Connected" }, packages: [two, three] }));
  // Said once, in the effect line, not again in the summary.
  expect(screen.getAllByText(/3\.0 → 3\.4 of 5/)).toHaveLength(1);
  expect(screen.queryByText(/synergy score goes from/)).toBeNull();
  expect(screen.getByTestId("precon-effect")).toHaveTextContent(/what this page measures/);
  expect(screen.queryByTestId("precon-same-swaps")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Bracket 3" }));
  expect(screen.getByTestId("precon-same-swaps")).toHaveTextContent("the same swaps as at bracket 1–2");
});

test("the effect line says Build and the shortfalls when the package carries them", () => {
  const two = { ...pkg(2, 2), after: { band: "1-2" as const, synergy: 3.4, mana: 0.9, build: 4.2, short: [] } };
  show(page({ bracket: { band: "1-2", gameChangers: 0, combos: 0 }, synergy: { score: 3, band: "Connected" }, build: { score: 3.6, band: "Close" }, gaps: [{ group: "Ramp", have: 9, target: 11 }], packages: [two] }));
  expect(screen.getByTestId("precon-effect")).toHaveTextContent(/Build 3\.6 → 4\.2 of 5, from close to on target; no longer short on ramp/);
});

test("a bracket no swap can reach says why instead of offering a package", () => {
  show(page({ packages: [pkg(3, 1), pkg(4, 1)], unreachable: [2] }));
  fireEvent.click(screen.getByRole("button", { name: "Bracket 1–2" }));
  expect(screen.getByTestId("precon-unreachable")).toHaveTextContent("a commander can’t be swapped out");
});

test("the tabs and the unreachable line carry the report's labels", () => {
  show(page({ packages: [pkg(3, 1)], unreachable: [2, 4] }));
  expect(screen.getAllByRole("button").map((b) => b.textContent).slice(0, 3)).toEqual(["Bracket 1–2", "Bracket 3", "Bracket 4–5"]);
  fireEvent.click(screen.getByRole("button", { name: "Bracket 4–5" }));
  expect(screen.getByTestId("precon-unreachable")).toHaveTextContent("No swaps bring this deck to bracket 4–5");
});

test("a reason beside its card's name drops the name it opens with", () => {
  expect(beside("Orzhov Basilica", "Orzhov Basilica enters tapped.")).toBe("Enters tapped.");
  expect(beside("Pious Evangel // Wayward Disciple", "Pious Evangel puts cards into the graveyard")).toBe("Puts cards into the graveyard");
  expect(beside("Crib Swap", "When a creature enters, Crib Swap…")).toBe("When a creature enters, Crib Swap…");
  expect(beside("Path to Exile", "Path to Exile is the same removal for 2 less mana.")).toBe("The same removal for 2 less mana.");
});

test("a page built before packages draws nothing", () => {
  const { container } = show(page({ packages: undefined }));
  expect(container).toBeEmptyDOMElement();
});

/** A CARD A REASON LEANS ON OPENS ITS TEXT (#983): seven of Party Time's eleven swaps cited Thwart
 *  the Grave, and the precon seat could not read it from the swap list. */
test("a deck card named in a swap reason opens the card drawer", () => {
  const graph = {
    nodes: [{ id: "Thwart the Grave", label: "Thwart the Grave", copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 3 }],
    edges: [],
  } as never;
  const reasoned: UpgradeSwap = {
    kind: "synergy", out: { name: "Stick Together", reason: "Stick Together works with 4 cards in this deck." },
    in: { name: "Pious Evangel", reason: "Pious Evangel puts cards into the graveyard that Thwart the Grave can bring back." },
  };
  render(
    <MemoryRouter>
      <CardDrawerProvider graph={graph}>
        <UpgradePackages page={page({ packages: [{ target: 3, from: "3", bringDown: [], sections: [{ id: "synergy", swaps: [reasoned] }] }] })} />
      </CardDrawerProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("link", { name: "Thwart the Grave" }));
  expect(screen.getByTestId("card-inspector")).toBeInTheDocument();
});
