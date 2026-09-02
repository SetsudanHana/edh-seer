import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import userEvent from "@testing-library/user-event";
import { ThemeMatrix } from "./ThemeMatrix.js";
import { CardDrawerProvider, usePinned } from "./card-drawer.js";
import { SAMPLE } from "../fixtures.js";

/** A pair carrying one reason, in the shape `groupEdgesByArchetype` emits. `implied` is
 *  `Reason.impliedProducer` -- the producer supplied the event merely by existing (S17). */
const pair = (producer: string, consumer: string, implied?: boolean) =>
  ({ a: producer, b: consumer, reasons: [{ producer, consumer, tag: "t", text: "x", ...(implied ? { impliedProducer: true } : {}) }] });

const groups = [
  {
    category: "draw", label: "Draw Engine", cards: ["Skullclamp", "Grim Haruspex"],
    pairs: [pair("Skullclamp", "Grim Haruspex")],
  },
  {
    category: "gy", label: "Graveyard Matters", cards: ["Grim Haruspex"],
    // IMPLIED: Grim Haruspex is here by being a creature that dies, not by an authored effect.
    pairs: [pair("Grim Haruspex", "Bojuka Bog", true)],
  },
] as never;

const show = (names: string[], g: unknown = groups) =>
  render(
    <CardDrawerProvider graph={SAMPLE.graph}>
      <ThemeMatrix archetypes={g as never} nonlandNames={names} />
    </CardDrawerProvider>,
  );

test("a row carries one dot per group the card is in", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  const rows = screen.getAllByTestId("matrix-row");
  const haruspex = rows.find((r) => r.textContent?.startsWith("Grim Haruspex"))!;
  expect(within(haruspex).getAllByTestId("matrix-dot")).toHaveLength(2);
  const clamp = rows.find((r) => r.textContent?.startsWith("Skullclamp"))!;
  expect(within(clamp).getAllByTestId("matrix-dot")).toHaveLength(1);
});

/** A DOT IS NEVER THE ONLY CARRIER. A grid of coloured dots reads as "blank blank blank" to a
 *  screen reader, which is the colour-only failure this repo keeps fixing -- so every cell states
 *  its own membership either way. */
test("every cell says in words whether it is a member", () => {
  show(["Skullclamp"]);
  expect(screen.getByText("in Draw Engine")).toBeInTheDocument();
  expect(screen.getByText("not in Graveyard Matters")).toBeInTheDocument();
});

/** S17: ONE DOT WAS MAKING TWO CLAIMS. A filled dot is a card doing something the group is about; a
 *  hollow ring is a card whose supply was synthesised -- present when the thing happens rather than
 *  causing it. Three of four judges called this grid suspected-wrong; it was two claims drawn
 *  identically. The distinction is SHAPE, not colour, so it survives a colour-blind reader, and it
 *  is in the sentence too, because a mark is never the only carrier. */
test("an implied membership is drawn, and said, differently from an earned one", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  const rows = screen.getAllByTestId("matrix-row");
  const haruspex = rows.find((r) => r.textContent?.startsWith("Grim Haruspex"))!;
  const marks = within(haruspex).getAllByTestId("matrix-dot");
  expect(marks.map((d) => d.getAttribute("data-membership"))).toEqual(["earned", "implied"]);
  // The filled mark has no border and the ring has no fill -- a colour-only difference would be
  // invisible in forced-colours mode.
  // `--muted` (6.11:1 against the page ground), not `--fill` (2.12:1, under the 3:1 a graphical
  // object owes). Measured in the browser; S6's dot had been below the floor since it shipped.
  expect(marks[0]!.className).toMatch(/bg-\(--muted\)/);
  expect(marks[1]!.className).toMatch(/border-\(--muted\)/);
  expect(marks[1]!.className).not.toMatch(/bg-\(--muted\)/);
  expect(screen.getByText(/in Graveyard Matters, by being played rather than by doing anything/)).toBeInTheDocument();
});

test("the legend counts both kinds, because the implied half can be the larger one", () => {
  // Measured on the example deck: 177 of 295 memberships are implied, so a reader taking every dot
  // at face value reads a deck twice as connected as it is.
  show(["Skullclamp", "Grim Haruspex"]);
  expect(screen.getByText(/of them are\s+something the card does/)).toBeInTheDocument();
  expect(screen.getByText(/are the card merely being there/)).toBeInTheDocument();
});

/** THE CARDS IN NO GROUP ARE NAMED, not counted: this is the region a cut conversation starts from
 *  and a reader deciding what to cut needs to know which. Measured on the review deck: 25 of 82. */
test("cards in no group are named, with the coverage caveat attached", () => {
  show(["Skullclamp", "Sol Ring", "Arcane Signet"]);
  expect(screen.getByText(/2 cards are in no group at all/)).toBeInTheDocument();
  expect(screen.getByText(/An unread card cannot join a group/)).toBeInTheDocument();
});

// A DECK WHOSE CARDS ALL BELONG SAYS NOTHING, rather than printing a zero.
test("nothing is admitted when every card is in a group", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  expect(screen.queryByText(/in no group at all/)).toBeNull();
});

/** THE FOLD IS A DISCLOSURE AND NEVER A CAP. The matrix's job is the pattern at the top -- the
 *  cards carrying several mechanisms -- and 57 rows of it scrolls past everything under it. */
test("rows past the fold are one click away, and the count says how many", async () => {
  const many = Array.from({ length: 25 }, (_, i) => `Card ${String(i).padStart(2, "0")}`);
  const big = [{ category: "draw", label: "Draw Engine", cards: many, pairs: [] }] as never;
  show(many, big);
  expect(screen.getAllByTestId("matrix-row")).toHaveLength(18);
  await userEvent.click(screen.getByRole("button", { name: /show the other 7 rows/ }));
  expect(screen.getAllByTestId("matrix-row")).toHaveLength(25);
});

// THE ARGUMENT AGAINST A TREEMAP, said with this deck's own arithmetic rather than asserted.
test("it states why it is a grid: more memberships than cards", () => {
  show(["Skullclamp", "Grim Haruspex"]);
  expect(screen.getByText(/3 memberships do not fit in 2 cells/)).toBeInTheDocument();
});

test("no groups means no matrix at all", () => {
  const { container } = show(["Sol Ring"], []);
  expect(container).toBeEmptyDOMElement();
});

/** S8, AND THIS IS THE SURFACE THAT PROVES THE FACE RULE. The matrix's rows are FACE names while
 *  the waffle's squares are PHYSICAL names, so a card pinned on one surface has to light on the
 *  other. Pinned here by the PHYSICAL name; the row is the FACE name. Getting this wrong is the
 *  join the 2026-08-27 wave fixed in eleven places and S17 found a twelfth of. */
test("a pinned card's row is ringed, even though the row is a face name", async () => {
  const graph = {
    nodes: [{
      id: "Fable of the Mirror-Breaker", label: "Fable of the Mirror-Breaker",
      cardName: "Fable of the Mirror-Breaker // Reflection of Kiki-Jiki",
      copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 3,
    }],
    edges: [],
  } as never;
  function Pinner() {
    const { togglePin } = usePinned();
    return <button onClick={() => togglePin("Fable of the Mirror-Breaker // Reflection of Kiki-Jiki")}>pin it</button>;
  }
  const groups = [{
    category: "draw", label: "Draw Engine", cards: ["Fable of the Mirror-Breaker"],
    pairs: [{ a: "Fable of the Mirror-Breaker", b: "X",
      reasons: [{ producer: "Fable of the Mirror-Breaker", consumer: "X", tag: "t", text: "x" }] }],
  }] as never;
  render(
    <CardDrawerProvider graph={graph}>
      <ThemeMatrix archetypes={groups} nonlandNames={["Fable of the Mirror-Breaker"]} />
      <Pinner />
    </CardDrawerProvider>,
  );
  expect(document.querySelector('tr[data-pinned="1"]')).toBeNull();
  await userEvent.click(screen.getByText("pin it"));
  const row = document.querySelector('tr[data-pinned="1"]');
  expect(row).not.toBeNull();
  // A mark is never the only carrier.
  expect(row!.textContent).toContain("pinned");
});

/** T14 (owner): *"there is option to show more, but there is no option to go back to show less"*.
 *  The control called `setExpanded(true)` and was rendered on `hidden > 0`, so opening it removed
 *  the only affordance for closing it -- a reader who opened a long grid to check one card scrolled
 *  past every row for the rest of the session. */
test("the row fold opens and closes again", async () => {
  const user = userEvent.setup();
  const groups = [{
    category: "x",
    label: "Group X",
    cards: Array.from({ length: 24 }, (_, i) => `Card ${i}`),
    pairs: [] as never[],
  }];
  const names = Array.from({ length: 24 }, (_, i) => `Card ${i}`);
  render(<ThemeMatrix archetypes={groups as never} nonlandNames={names} />);

  const open = screen.getByRole("button", { name: /show the other 6 rows/ });
  expect(open).toHaveAttribute("aria-expanded", "false");
  await user.click(open);

  // The control survives the click, now pointing the other way.
  const close = screen.getByRole("button", { name: /show fewer rows/ });
  expect(close).toHaveAttribute("aria-expanded", "true");
  await user.click(close);
  expect(screen.getByRole("button", { name: /show the other 6 rows/ })).toBeInTheDocument();
});
