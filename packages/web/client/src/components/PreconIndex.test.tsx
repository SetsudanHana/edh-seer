import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";

vi.mock("../lib/precons.js", () => ({
  loadPreconIndex: async () => [
    { slug: "party-time", name: "Party Time", setCode: "CLB", setName: "Commander Legends: Battle for Baldur's Gate", releaseDate: "2022-06-10", commanders: ["Nalia de'Arnise"], identity: ["W", "B"], theme: "Party" },
    { slug: "draconic-dissent", name: "Draconic Dissent", setCode: "CLB", setName: "Commander Legends: Battle for Baldur's Gate", releaseDate: "2022-06-10", commanders: ["Firkraag, Cunning Instigator"], identity: ["U", "R"], theme: null },
    { slug: "calling-all-angels", name: "Calling All Angels", setCode: "FDC", setName: "Foundations Commander", releaseDate: "2024-11-15", commanders: ["Kaalia"], identity: ["W"], theme: "Angel tribal" },
  ],
}));
const { PreconIndex } = await import("./PreconIndex.js");

/** FOUND BY TYPING (persona round 2026-09-29): the precon-upgrader seat could not find its own
 *  precon among ~50 sets of columns. The box matches deck, commander, theme and set. */
test("the precon list filters by deck, commander, theme or set, and says when nothing matches", async () => {
  render(<MemoryRouter><PreconIndex /></MemoryRouter>);
  const box = await screen.findByRole("searchbox");
  expect(screen.getAllByRole("link")).toHaveLength(3);
  fireEvent.change(box, { target: { value: "nalia" } });
  expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([expect.stringContaining("Party Time")]);
  fireEvent.change(box, { target: { value: "foundations" } });
  expect(screen.getAllByRole("link").map((a) => a.textContent)).toEqual([expect.stringContaining("Calling All Angels")]);
  fireEvent.change(box, { target: { value: "zzz" } });
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.getByText(/No precon matches/)).toHaveTextContent("No precon matches “zzz”.");
});
