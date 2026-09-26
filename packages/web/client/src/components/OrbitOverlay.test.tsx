import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test } from "vitest";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { OrbitOverlay } from "./OrbitOverlay.js";

function Harness() {
  const { report, graph } = engineDeck();
  const model = buildEngineModel(report, graph);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen("Payoff A")}>See links</button>
      {open ? <OrbitOverlay report={report} graph={graph} model={model} focusId={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

test("See links opens the card's orbit over the report, and Close puts focus back where it was", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const opener = screen.getByRole("button", { name: "See links" });
  await user.click(opener);
  const dialog = screen.getByRole("dialog", { name: "What Payoff A works with" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getByRole("group", { name: /^Payoff A and the \d+ cards? it works with$/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
  // The page behind does not scroll while it is open.
  expect(document.documentElement.style.overflow).toBe("hidden");
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(opener).toHaveFocus();
  expect(document.documentElement.style.overflow).toBe("");
});

test("Escape closes it", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.click(screen.getByRole("button", { name: "See links" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});
