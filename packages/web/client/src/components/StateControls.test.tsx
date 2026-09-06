import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { StateControls } from "./StateControls.js";

/** A GAME STATE THE OWNER SETS (roadmap W18). Speed is the player's, 1 to 4 (CR 702.179); "none"
 *  is the deck before any engine card is out, which is the report as it always was. */
test("the speed control offers none and 1 to 4, marks the current one, and reports a pick", async () => {
  const onSpeed = vi.fn();
  render(<StateControls markers={["speed"]} state={{ speed: 2 }} onState={onSpeed} />);
  expect(screen.getByRole("group", { name: /speed/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "2" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "4" }));
  expect(onSpeed).toHaveBeenCalledWith({ speed: 4 });
  await userEvent.click(screen.getByRole("button", { name: /none/i }));
  expect(onSpeed).toHaveBeenCalledWith({});
});

test("a deck that reaches no marker gets no control", () => {
  const { container } = render(<StateControls markers={[]} onState={() => {}} />);
  expect(container).toBeEmptyDOMElement();
});

/** THE BOOLEAN MARKERS ARE SWITCHES: the monarch, the initiative, the city's blessing, a completed
 *  dungeon, night. Each shows only when the deck can reach it, and reports its flip. */
test("a boolean marker is a pressable switch that reports its flip", async () => {
  const onState = vi.fn();
  render(<StateControls markers={["monarch", "dungeon"]} state={{ monarch: true }} onState={onState} />);
  expect(screen.getByRole("button", { name: /monarch/i })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: /dungeon/i })).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByRole("group", { name: /speed/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /dungeon/i }));
  expect(onState).toHaveBeenCalledWith({ monarch: true, dungeon: true });
  await userEvent.click(screen.getByRole("button", { name: /monarch/i }));
  expect(onState).toHaveBeenCalledWith({});
});

/** THE LINE SAYS WHAT THE STATE DID (roadmap W18c, owner 2026-09-06: "say what changed"), read off
 *  the report's own `enabledBy` edges rather than a remembered previous run. */
test("with edges, the line counts the edges the state made and names the cards that gained most", () => {
  const edges = [
    { a: "Garruk's Uprising", b: "Raise the Alarm", enabledBy: ["speed"] },
    { a: "Garruk's Uprising", b: "Goblin Surveyor", enabledBy: ["speed"] },
    { a: "Samut, the Driving Force", b: "Raise the Alarm" },
  ];
  render(<StateControls markers={["speed"]} state={{ speed: 4 }} onState={() => {}} edges={edges} />);
  expect(screen.getByText("speed 4: 2 edges exist because of it · Garruk's Uprising +2 · Goblin Surveyor +1 · Raise the Alarm +1")).toBeInTheDocument();
});

test("a state no edge depends on says so, and a run in flight says it is re-reading", () => {
  const { rerender } = render(<StateControls markers={["monarch"]} state={{ monarch: true }} onState={() => {}} edges={[{ a: "A", b: "B" }]} />);
  expect(screen.getByText("the monarch: no edge in this deck depends on it")).toBeInTheDocument();
  rerender(<StateControls markers={["monarch"]} state={{ monarch: true }} onState={() => {}} edges={[]} busy />);
  expect(screen.getByText("re-reading the deck under the monarch…")).toBeInTheDocument();
});
