import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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

/** THE CARD PAGE REPLACES THE DECK TOOL, IT DOES NOT SIT UNDER IT. `main` renders unconditionally
 *  in this component, so mounting a route without this seam would have put a card page BELOW a full
 *  deck form -- which every test above would still have passed, since they all render at `/`.
 *
 *  Driven with no artifact on disk: a 404 shard is the "not in the corpus" branch, which is enough
 *  to prove which tree rendered. */
test("a card URL renders the card page and not the deck tool", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
  window.history.pushState({}, "", "/cards/krenko-mob-boss");
  try {
    render(<App />);
    expect(await screen.findByText(/no such page/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze deck" })).toBeNull();
  } finally {
    fetchSpy.mockRestore();
    window.history.pushState({}, "", "/");
  }
});

/** `/cards` IS A PAGE NOW, not the report's card list. The legacy handoff for a stale share link
 *  moved inside `CardSearch`, which is the only place it can live once the path renders something:
 *  covered there, because `window.location.replace` is not implemented in jsdom. */
test("the /cards URL renders the card search and not the deck tool", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
  window.history.pushState({}, "", "/cards");
  try {
    render(<App />);
    expect(await screen.findByRole("searchbox")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze deck" })).toBeNull();
  } finally {
    fetchSpy.mockRestore();
    window.history.pushState({}, "", "/");
  }
});

test("the commander URLs render their own pages and not the deck tool", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch")
    .mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
  try {
    window.history.pushState({}, "", "/commanders");
    const list = render(<App />);
    expect(await screen.findByRole("heading", { name: "Commanders" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze deck" })).toBeNull();
    list.unmount();

    window.history.pushState({}, "", "/commanders/krenko-mob-boss");
    render(<App />);
    expect(await screen.findByText(/no such page/i)).toBeInTheDocument();
  } finally {
    fetchSpy.mockRestore();
    window.history.pushState({}, "", "/");
  }
});

/** THE LEGACY-REDIRECT BLOCK MATCHES TWO PATHS AND THE APP HAS MANY. Without a catch-all in it,
 *  React Router logs `No routes matched location` on every other page -- noise on the landing, on
 *  every card page and on every commander page, which is how a real warning goes unread. */
test("no router warning is logged on a page the legacy block does not match", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    render(<App />);
    expect(warn.mock.calls.flat().join(" ")).not.toContain("No routes matched");
  } finally { warn.mockRestore(); }
});
