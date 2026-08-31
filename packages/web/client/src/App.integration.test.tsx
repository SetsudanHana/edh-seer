import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import App from "./App.js";
import { SAMPLE } from "./fixtures.js";
import * as api from "./api.js";

test("typing commander + decklist and clicking Analyze renders the ranked report", async () => {
  const spy = vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  render(<App />);
  await userEvent.type(screen.getByRole("textbox", { name: /commander/i }), "1 Krenko, Mob Boss");
  await userEvent.type(screen.getByRole("textbox", { name: /decklist/i }), "1 Impact Tremors");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByText("Tokens")).toBeInTheDocument()); // Overview tab, default active
  expect(screen.getByText(/Beholder's Death Ray/)).toBeInTheDocument(); // unresolved banner
  await userEvent.click(screen.getByRole("tab", { name: "Cards" }));
  // "Krenko, Mob Boss" appears in the commander textarea value and in the Cards tab's list.
  expect(screen.getAllByText(/Krenko, Mob Boss/).length).toBeGreaterThan(1);
  // commanders passed as the 2nd arg
  expect(spy).toHaveBeenCalledWith("1 Impact Tremors", "1 Krenko, Mob Boss");
});

test("shows an error banner when the api throws", async () => {
  vi.spyOn(api, "analyzeDeck").mockRejectedValue(new Error("Cannot reach MongoDB..."));
  render(<App />);
  await userEvent.type(screen.getByRole("textbox", { name: /decklist/i }), "1 Sol Ring");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByText(/Cannot reach MongoDB/)).toBeInTheDocument());
});

test("input collapses to a summary after a successful analysis", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
  // the large textarea is no longer visible
  expect(screen.queryByLabelText("Decklist")).not.toBeInTheDocument();
});

/** THERE WAS NO WAY BACK. `analyse` wrote the share hash with `replaceState`, chosen so that
 *  re-analysing does not fill the back button with near-identical entries -- but that also meant the
 *  FIRST analysis created no entry either, so Back left the site entirely. Owner report,
 *  2026-08-31: *"after we added the url there is no easy way to go back from the analysis"*.
 *
 *  The rule is now about which analysis it is: the first one pushes, so Back has somewhere on this
 *  site to go; every re-analysis replaces, which is the original reasoning, unchanged. */
test("the first analysis is a history entry, so Back returns to the paste box", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  window.history.replaceState(null, "", "/");
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await screen.findByRole("button", { name: /edit/i });
  expect(window.location.hash).toMatch(/^#deck=/);

  // What a browser does on Back: the URL changes first, then `popstate` fires.
  await act(async () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  // THE DECK SURVIVES. Back means "out of the report", not "start over" -- landing on an empty box
  // would throw away the list the reader just pasted.
  expect(await screen.findByLabelText("Decklist")).toHaveValue("1 Sol Ring");
  expect(screen.queryByRole("button", { name: /edit/i })).not.toBeInTheDocument();
});

/** Forward again, or any Back that lands ON a shared analysis, has to re-open it -- otherwise the
 *  history entry exists and does nothing when you reach it. */
test("popstate onto a deck hash re-opens that analysis", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  window.history.replaceState(null, "", "/");
  render(<App />);
  fireEvent.change(screen.getByLabelText("Decklist"), { target: { value: "1 Sol Ring" } });
  fireEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await screen.findByRole("button", { name: /edit/i });
  const withDeck = window.location.hash;

  await act(async () => {
    window.history.replaceState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByLabelText("Decklist");

  await act(async () => {
    window.history.replaceState(null, "", withDeck);
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(await screen.findByRole("button", { name: /edit/i })).toBeInTheDocument();
});
