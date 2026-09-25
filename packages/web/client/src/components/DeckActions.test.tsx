import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DeckActions } from "./DeckInput.js";

/** THE DECK'S ACTIONS IN THE SUMMARY ROW (UI review 2026-09-25): the three taken often stay in view,
 *  the two taken once sit behind More, and the menu closes the ways a menu is expected to. */
test("More holds Copy decklist and Start over, and Escape or an outside press closes it", () => {
  const onStartOver = vi.fn();
  render(
    <div>
      <p>outside</p>
      <DeckActions commanders="1 Krenko, Mob Boss" value="1 Sol Ring" onAnalyze={() => {}} loading={false}
        onEdit={() => {}} onStartOver={onStartOver} shareLink="https://edhseer.cards/#deck=x" />
    </div>,
  );
  for (const name of ["Copy link", "Edit", "Re-analyse"]) expect(screen.getByRole("button", { name })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();

  const more = screen.getByRole("button", { name: "More" });
  fireEvent.click(more);
  expect(more).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("button", { name: "Copy decklist" })).toBeInTheDocument();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("button", { name: "Copy decklist" })).toBeNull();

  fireEvent.click(more);
  fireEvent.pointerDown(screen.getByText("outside"));
  expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();

  fireEvent.click(more);
  fireEvent.click(screen.getByRole("button", { name: "Start over" }));
  expect(onStartOver).toHaveBeenCalledOnce();
});

test("with no share link there is no Copy link anywhere", () => {
  render(<DeckActions commanders="" value="" onAnalyze={() => {}} loading={false} shareLink={null} />);
  fireEvent.click(screen.getByRole("button", { name: "More" }));
  expect(screen.queryByRole("button", { name: /copy link/i })).toBeNull();
});
