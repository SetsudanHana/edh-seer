import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TableTalkLine } from "./TableTalk.js";

test("the table line shows the sentence and copies it", async () => {
  const user = userEvent.setup();
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<TableTalkLine talk={{ text: "Bracket 3. It wins mostly by combat.", bracket: "Bracket 3.", headsUp: [] }} />);
  expect(screen.getByRole("heading", { name: "Say this at the table" })).toBeInTheDocument();
  expect(screen.getByTestId("table-talk-text")).toHaveTextContent("Bracket 3. It wins mostly by combat.");
  await user.click(screen.getByRole("button", { name: "Copy" }));
  expect(write).toHaveBeenCalledWith("Bracket 3. It wins mostly by combat.");
  expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
});
