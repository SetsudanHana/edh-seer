import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CardSheet } from "./CardSheet.js";

test("collapsed, it names the card and keeps the graph", () => {
  render(<CardSheet title="Shark Typhoon" subtitle="42 partners" onBack={() => {}}>
    <p>every partner</p>
  </CardSheet>);
  expect(screen.getByText("Shark Typhoon")).toBeInTheDocument();
  expect(screen.getByText("42 partners")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /details/i })).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText("every partner")).toBeNull();
});

test("expanding shows the detail, and it can be collapsed again", async () => {
  const user = userEvent.setup();
  render(<CardSheet title="Shark Typhoon" subtitle="42 partners" onBack={() => {}}>
    <p>every partner</p>
  </CardSheet>);
  const toggle = screen.getByRole("button", { name: /details/i });
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("every partner")).toBeInTheDocument();
  // T14's ruling, one surface over: a control that opens must also close. Opening it used to
  // delete the only affordance for closing it.
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("back is a real target, not a 39x16 strip", async () => {
  const onBack = vi.fn();
  const user = userEvent.setup();
  render(<CardSheet title="X" subtitle="y" onBack={onBack}><p>d</p></CardSheet>);
  const back = screen.getByRole("button", { name: /back to the card list/i });
  // jsdom reports no layout, so the CLASS is what gets pinned -- the measured defect was a 39x16
  // CLOSE, and `min-h-11` is 44px.
  expect(back.className).toMatch(/min-h-11/);
  expect(screen.getByRole("button", { name: /details/i }).className).toMatch(/min-h-11/);
  await user.click(back);
  expect(onBack).toHaveBeenCalledOnce();
});
