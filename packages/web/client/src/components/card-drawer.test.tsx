import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { CardDrawerProvider, useCardDrawer, usePinned } from "./card-drawer.js";

const graph = {
  nodes: [
    { id: "Sol Ring", label: "Sol Ring", copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 1 },
    // A multi-face card: the FRONT face's node carries `cardName` for the physical card.
    {
      id: "Fable of the Mirror-Breaker", label: "Fable of the Mirror-Breaker",
      cardName: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
      copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 3,
    },
  ],
  edges: [],
} as never;

function Probe({ name }: { name: string }) {
  const { pinned, isPinned, togglePin, clearPins } = usePinned();
  return (
    <>
      <button onClick={() => togglePin(name)}>toggle</button>
      <button onClick={clearPins}>clear</button>
      <span data-testid="lit">{isPinned(name) ? "yes" : "no"}</span>
      <span data-testid="size">{pinned.size}</span>
    </>
  );
}

test("pinning is a toggle, and re-pinning the same card does not grow the set", async () => {
  render(<CardDrawerProvider graph={graph}><Probe name="Sol Ring" /></CardDrawerProvider>);
  expect(screen.getByTestId("lit")).toHaveTextContent("no");
  await userEvent.click(screen.getByText("toggle"));
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
  expect(screen.getByTestId("size")).toHaveTextContent("1");
  await userEvent.click(screen.getByText("toggle"));
  expect(screen.getByTestId("lit")).toHaveTextContent("no");
});

/** A PIN IS THE PHYSICAL CARD. The theme matrix's rows are FACE names and the waffle's squares are
 *  PHYSICAL names, so the same card reaches this API under two spellings -- and the eleven join
 *  sites the 2026-08-27 wave fixed, plus the twelfth S17 found, are all this one mistake. */
test("a face name and its physical name are the same pin", async () => {
  render(
    <CardDrawerProvider graph={graph}>
      <Probe name="Fable of the Mirror-Breaker" />
    </CardDrawerProvider>,
  );
  await userEvent.click(screen.getByText("toggle"));
  expect(screen.getByTestId("size")).toHaveTextContent("1");
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
});

/** THE OTHER DIRECTION, and it is the one the matrix needs: pinned by the PHYSICAL name, asked
 *  about by the FACE name. Without the resolver this reads "no" and the matrix row never lights. */
test("pinning the physical card lights its face name", async () => {
  function Both() {
    const { isPinned, togglePin } = usePinned();
    return (
      <>
        <button onClick={() => togglePin("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki")}>pin physical</button>
        <span data-testid="face">{isPinned("Fable of the Mirror-Breaker") ? "yes" : "no"}</span>
      </>
    );
  }
  render(<CardDrawerProvider graph={graph}><Both /></CardDrawerProvider>);
  await userEvent.click(screen.getByText("pin physical"));
  expect(screen.getByTestId("face")).toHaveTextContent("yes");
});

test("clearing empties the set", async () => {
  render(<CardDrawerProvider graph={graph}><Probe name="Sol Ring" /></CardDrawerProvider>);
  await userEvent.click(screen.getByText("toggle"));
  await userEvent.click(screen.getByText("clear"));
  expect(screen.getByTestId("size")).toHaveTextContent("0");
});

/** SESSION STATE OUTLIVES A SECOND ANALYZE. Without this a pin made on deck A survives into deck B,
 *  where the name either lights nothing or lights a different copy of the same card -- a claim
 *  nobody made. */
test("the set clears when a new analysis arrives", async () => {
  const { rerender } = render(
    <CardDrawerProvider graph={graph}><Probe name="Sol Ring" /></CardDrawerProvider>,
  );
  await userEvent.click(screen.getByText("toggle"));
  expect(screen.getByTestId("size")).toHaveTextContent("1");
  const otherGraph = {
    nodes: [{ id: "Sol Ring", label: "Sol Ring", copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 1 }],
    edges: [],
  } as never;
  rerender(<CardDrawerProvider graph={otherGraph}><Probe name="Sol Ring" /></CardDrawerProvider>);
  expect(screen.getByTestId("size")).toHaveTextContent("0");
});

/** THE CARDS YOU CHANGED ARE PRE-PINNED (roadmap S9). The seed rides the effect that already clears
 *  the set on a new deck, so a seeded pin cannot outlive its analysis any more than a hand-made one
 *  can. */
test("seeded names arrive pinned", () => {
  render(
    <CardDrawerProvider graph={graph} seedPins={["Sol Ring"]}>
      <Probe name="Sol Ring" />
    </CardDrawerProvider>,
  );
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
  expect(screen.getByTestId("size")).toHaveTextContent("1");
});

/** A PIN IS THE PHYSICAL CARD, NEVER A FACE (the S8 identity rule). A seeded front-face name has to
 *  light the matrix's face row and the waffle's physical square alike, which it does only if the
 *  seed resolves through the same `physicalName` a hand-made pin does. */
test("a seeded face name pins the physical card", () => {
  render(
    <CardDrawerProvider graph={graph} seedPins={["Fable of the Mirror-Breaker"]}>
      <Probe name="Fable of the Mirror-Breaker // Reflection of Kiki-Jiki" />
    </CardDrawerProvider>,
  );
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
});

/** Nothing seeded is the ordinary case -- run one, and every run whose diff is null. */
test("no seed leaves the set empty", () => {
  render(<CardDrawerProvider graph={graph}><Probe name="Sol Ring" /></CardDrawerProvider>);
  expect(screen.getByTestId("size")).toHaveTextContent("0");
});


/** THE DRAWER DOCKS FROM `xl` INSTEAD OF COVERING THE PAGE (owner's call, 2026-09-03).
 *
 *  Measured at 1920: the Cards panel capped at 88rem and left-aligned, so 448px of page sat empty
 *  on the right while the drawer covered the rows on the left. (That cap has since gone as well --
 *  the table takes the full width and reflows with the rest of the page.) The reserve is a
 *  `padding-inline-end`
 *  on `body`, not on the provider's children -- the first attempt did the latter and left the
 *  static site nav (`index.html`, outside the React root) and the app's own toolbar underneath the
 *  panel. This asserts the SIGNAL; the CSS test below asserts the rule behind it, because a class
 *  with no rule is silent and a rule with no class is dead. */
function Opener({ id }: { id: string }) {
  const { open } = useCardDrawer();
  return <button onClick={() => open(id)}>open it</button>;
}

test("opening the drawer tells the page to make room, and closing gives it back", async () => {
  render(<CardDrawerProvider graph={graph}><Opener id="Sol Ring" /></CardDrawerProvider>);
  expect(document.body.classList.contains("drawer-docked")).toBe(false);
  await userEvent.click(screen.getByText("open it"));
  expect(document.body.classList.contains("drawer-docked")).toBe(true);
  // Closed through the panel's own control, not a test-only hook: the class has to come back off
  // the way a reader takes it off.
  await userEvent.click(screen.getByRole("button", { name: /close/i }));
  expect(document.body.classList.contains("drawer-docked")).toBe(false);
});

/** AND THE RESERVE IS THE DRAWER'S OWN WIDTH. `w-80` on the fixed container is 20rem; a reserve
 *  that disagrees either leaves a strip of page under the panel or a gap beside it, and neither is
 *  visible in jsdom. Read off the source so the two cannot drift apart silently. */
test("the reserve matches the drawer's width, at the breakpoint where there is room", () => {
  const css = readFileSync(join(process.cwd(), "client", "src", "index.css"), "utf8");
  const rule = /@media \(min-width: 80rem\) \{\s*body\.drawer-docked \{ padding-inline-end: (\d+)rem; \}/.exec(css);
  expect(rule, "body.drawer-docked rule at min-width: 80rem").not.toBeNull();
  const source = readFileSync(join(process.cwd(), "client", "src", "components", "card-drawer.tsx"), "utf8");
  const width = /className="fixed inset-y-0 right-0 z-30 w-(\d+)/.exec(source);
  expect(width, "the fixed drawer container's width").not.toBeNull();
  // Tailwind's spacing scale is 0.25rem per step, so `w-80` is 20rem.
  expect(Number(rule![1]) * 4).toBe(Number(width![1]));
});
