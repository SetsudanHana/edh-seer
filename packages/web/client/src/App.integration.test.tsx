import { render, screen, waitFor } from "@testing-library/react";
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
