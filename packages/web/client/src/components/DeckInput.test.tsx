import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { DeckInput } from "./DeckInput.js";

const props = {
  value: "",
  commanders: "",
  onChange: () => {},
  onCommandersChange: () => {},
  onAnalyze: () => {},
  loading: false,
};

/** THE CONTROLS ARE THIS APP'S OWN NOW. `@heroui/react` supplied one `Button` and one `TextArea` to
 *  this single component and dragged react-aria (194kB), react-aria-components (21kB) and
 *  tailwind-variants (140kB) with them, plus `@heroui/styles` into the CSS -- which fell from
 *  442.50kB to 41.98kB when it went. These pin the behaviour the library was providing, because a
 *  dependency removed without its behaviour replaced is a regression with a smaller bundle. */
test("the fields are labelled, and the labels point at them", () => {
  render(<DeckInput {...props} />);
  // `htmlFor`/`id` association, not just a visible word above a box.
  expect(screen.getByLabelText("Commander(s)").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Decklist").tagName).toBe("TEXTAREA");
});

test("typing reaches the handler", async () => {
  const seen: string[] = [];
  render(<DeckInput {...props} onChange={(v: string) => seen.push(v)} />);
  await userEvent.type(screen.getByLabelText("Decklist"), "S");
  expect(seen).toEqual(["S"]);
});

/** UNAVAILABLE IS DIMMED. There is no decklist to analyse, so the action genuinely cannot be taken
 *  and the control says so in the one way the rules allow: opacity plus a real `disabled`. */
test("the primary action is unavailable until there is a decklist", () => {
  const { rerender } = render(<DeckInput {...props} />);
  expect(screen.getByRole("button", { name: "Analyze deck" })).toBeDisabled();
  rerender(<DeckInput {...props} value="1 Sol Ring" />);
  expect(screen.getByRole("button", { name: "Analyze deck" })).toBeEnabled();
});

/** LOADING IS NOT DISABLED (components.md rule 8): "Reusing the disabled dimming for an in-flight
 *  action reads as 'you cannot do this', not 'this is happening'." The HeroUI version passed
 *  `isDisabled={loading}` and dimmed, which is the defect that rule names; the replacement keeps the
 *  control at full strength, swaps the label, and still refuses a second submit. `aria-busy` is what
 *  separates the two states for the stylesheet and for a screen reader. */
test("an in-flight analysis keeps the button at full strength and says what it is doing", () => {
  render(<DeckInput {...props} value="1 Sol Ring" loading />);
  const btn = screen.getByRole("button", { name: "Analyzing…" });
  expect(btn).toHaveAttribute("aria-busy", "true");
  // Still not submittable twice -- busy is about the LOOK, not about letting the click through.
  expect(btn).toBeDisabled();
  // And it is not wearing the unavailable treatment.
  expect(btn.className).toContain("btn-primary");
});

test("pressing the primary action runs the analysis once", async () => {
  let runs = 0;
  render(<DeckInput {...props} value="1 Sol Ring" onAnalyze={() => { runs += 1; }} />);
  await userEvent.click(screen.getByRole("button", { name: "Analyze deck" }));
  expect(runs).toBe(1);
});
