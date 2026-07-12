import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import App from "./App.js";
import { SAMPLE } from "./fixtures.js";
import * as api from "./api.js";

test("typing a decklist and clicking Analyze renders the report", async () => {
  vi.spyOn(api, "analyzeDeck").mockResolvedValue(SAMPLE);
  render(<App />);
  await userEvent.type(screen.getByRole("textbox"), "1 Krenko, Mob Boss");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByText(/Top synergies/)).toBeInTheDocument());
  expect(screen.getByText(/Impact Tremors/)).toBeInTheDocument();
  expect(screen.getByText(/Unresolved cards/)).toBeInTheDocument();
});

test("shows an error banner when the api throws", async () => {
  vi.spyOn(api, "analyzeDeck").mockRejectedValue(new Error("Cannot reach MongoDB..."));
  render(<App />);
  await userEvent.type(screen.getByRole("textbox"), "1 Sol Ring");
  await userEvent.click(screen.getByRole("button", { name: /analyze/i }));
  await waitFor(() => expect(screen.getByText(/Cannot reach MongoDB/)).toBeInTheDocument());
});
