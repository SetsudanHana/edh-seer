import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
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


/** A WAY OUT OF A REPORT (owner, 2026-09-03: "we do not have way to clear and start from the
 *  beginning").
 *
 *  The collapsed bar had `Copy link`, `Copy decklist`, `Edit` and `Re-analyze` -- and every one of
 *  them keeps the deck you are already looking at. `Edit` reopens THIS list; the deck is in the
 *  hash, so a reload brings it back too. There was no door.
 *
 *  It sits beside `Edit` rather than at the far end: the two are the same question -- change this
 *  deck, or leave it -- and the primary action stays last. */
test("the collapsed bar offers a way back to an empty page, and it is not the edit button", async () => {
  const onStartOver = vi.fn();
  const onEdit = vi.fn();
  render(<DeckInput {...props} value={"1 Sol Ring"} collapsed onEdit={onEdit} onStartOver={onStartOver} />);
  await userEvent.click(screen.getByRole("button", { name: /start over/i }));
  expect(onStartOver).toHaveBeenCalledTimes(1);
  // The two are distinct doors, and wiring one to the other is the defect this pins.
  expect(onEdit).not.toHaveBeenCalled();
});

/** AND IT IS NOT OFFERED WHERE THERE IS NOTHING TO CLEAR. The expanded form IS the empty page --
 *  a "start over" on it either does nothing or throws away a paste in progress. */
test("the open form does not offer to start over", () => {
  render(<DeckInput {...props} onStartOver={() => {}} />);
  expect(screen.queryByRole("button", { name: /start over/i })).toBeNull();
});

/** CLEARING A FORM THAT CAME BACK FULL (owner, 2026-09-04).
 *
 *  `Analyse a deck` in the header is a link to `/`, and `/` refills both fields from the remembered
 *  deck -- so a reader who has analysed one deck and wants to try another lands on the last one.
 *  `Start over` does this from the report; nothing did it from the form. */
test("Clear is offered beside Analyze, and is unavailable while there is nothing to clear", () => {
  const { rerender } = render(<DeckInput {...props} />);
  const clear = screen.getByRole("button", { name: "Clear" });
  // BOTH fields count, not just the decklist: a reader who typed only a commander has something to
  // clear, and a control that stays dim over a filled box reads as broken.
  expect(clear).toBeDisabled();
  rerender(<DeckInput {...props} commanders="1 Krenko, Mob Boss" />);
  expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
  rerender(<DeckInput {...props} value="1 Sol Ring" />);
  expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
});

test("Clear calls its handler and never the analysis", async () => {
  const onClear = vi.fn();
  const onAnalyze = vi.fn();
  render(<DeckInput {...props} value="1 Sol Ring" onClear={onClear} onAnalyze={onAnalyze} />);
  await userEvent.click(screen.getByRole("button", { name: "Clear" }));
  expect(onClear).toHaveBeenCalledTimes(1);
  expect(onAnalyze).not.toHaveBeenCalled();
});

/** NEUTRAL, NOT DESTRUCTIVE, AND NOT A SECOND PRIMARY (tokens-and-color.md). One affirmative action
 *  per screen wears the accent fill; a red Clear would put the loudest mark on the landing page on
 *  the action nobody arrived to take. The class carries the whole rule, so the class is the
 *  assertion -- and `validate_contrast.py` holds the border it uses to 3:1. */
test("Clear is the neutral variant and Analyze keeps the accent", () => {
  render(<DeckInput {...props} value="1 Sol Ring" />);
  expect(screen.getByRole("button", { name: "Clear" }).className).toContain("btn-secondary");
  expect(screen.getByRole("button", { name: "Clear" }).className).not.toContain("btn-primary");
  expect(screen.getByRole("button", { name: "Analyze deck" }).className).toContain("btn-primary");
});

/** THE COLLAPSED BAR ALREADY HAS ITS OWN WAY OUT -- `Start over`, which navigates -- and two
 *  controls for the same intent on one surface is how a reader learns neither is the real one. */
test("the collapsed bar does not grow a second clear", () => {
  render(<DeckInput {...props} value="1 Sol Ring" collapsed onClear={() => {}} />);
  expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  expect(screen.getByRole("button", { name: "Start over" })).toBeInTheDocument();
});
