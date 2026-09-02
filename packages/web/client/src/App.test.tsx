import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App.js";
import { saveLastDeck } from "./lib/run-diff.js";

test("renders a styled HeroUI Analyze button", () => {
  render(<App />);
  const btn = screen.getByRole("button", { name: "Analyze deck" });
  expect(btn).toBeInTheDocument();
  // HeroUI Buttons carry generated utility classes; unstyled plain buttons would not.
  expect(btn.className.length).toBeGreaterThan(0);
});

test("empty state offers a one-click example deck", async () => {
  render(<App />);
  expect(screen.getByRole("button", { name: /example deck/i })).toBeInTheDocument();
});

/** RUN TWO STARTS WITH THE TEXT IN THE BOX (roadmap S9). */
test("the entry screen restores the last pasted deck", () => {
  saveLastDeck({ commanders: "Kess, Dissident Mage", decklist: "1 Sol Ring" });
  render(<App />);
  expect(screen.getByDisplayValue("1 Sol Ring")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Kess, Dissident Mage")).toBeInTheDocument();
  window.sessionStorage.clear();
});

/** A SHARED LINK IS THE DECK THE SENDER MEANT. Losing it to the recipient's own last paste would be
 *  a silent wrong answer of the ordinary kind. */
test("a deck in the URL beats the remembered one", () => {
  saveLastDeck({ commanders: "Kess, Dissident Mage", decklist: "1 Sol Ring" });
  window.location.hash = "#deck=whatever";
  render(<App />);
  expect(screen.queryByDisplayValue("1 Sol Ring")).toBeNull();
  window.location.hash = "";
  window.sessionStorage.clear();
});
