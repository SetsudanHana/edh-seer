import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { CardDrawerProvider, usePinned } from "./card-drawer.js";

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
