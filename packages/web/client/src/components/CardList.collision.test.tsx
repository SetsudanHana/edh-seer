import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { CardList } from "./CardList.js";
import { CardDrawerProvider } from "./card-drawer.js";
import { indexByLabel } from "../lib/label-index.js";

/** A FACE NAMED LIKE ANOTHER DECK CARD (#1176), in the Cards list's grid. */
const PARENT = "Studious First-Year // Rampant Growth";
const FACE_ROW = `Rampant Growth (${PARENT})`;
const node = (id: string, label: string, extra: object = {}) =>
  ({ id, label, copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 2, ...extra });
const graph = { nodes: [
  node(`face:1:${PARENT}`, "Rampant Growth", { cardName: PARENT, face: 1, artCrop: "https://x/face.jpg" }),
  node("Rampant Growth", "Rampant Growth"), // no art
], edges: [] } as never;
const row = (name: string, extra: object = {}) =>
  ({ name, score: 1, authority: 1, feederLift: 0, partnerCount: 2, topPartners: [], synergyRating: 3, derived: true, roles: [], ...extra });
const cards = [row(FACE_ROW, { cardName: PARENT, face: 1 }), row("Rampant Growth")] as never;

test("the grid tile prints the face's printed name, and its menu acts on the physical card", async () => {
  render(<CardDrawerProvider graph={graph}><CardList cards={cards} /></CardDrawerProvider>);
  await userEvent.click(screen.getByRole("button", { name: "grid" }));
  expect(screen.queryByText(FACE_ROW)).toBeNull();
  expect(screen.getAllByText("Rampant Growth").length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole("button", { name: `More for ${PARENT}` })).toBeInTheDocument();
});

test("a standalone card with no art keeps its label: the face's art is not handed to it", () => {
  const art = indexByLabel((graph as unknown as { nodes: { id: string; label: string; cardName?: string; artCrop?: string }[] }).nodes, (n) => n.artCrop);
  expect(art.get("Rampant Growth")).toBeUndefined();
  expect(art.get(FACE_ROW)).toBe("https://x/face.jpg");
});
