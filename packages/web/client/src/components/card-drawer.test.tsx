import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useEffect } from "react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { buildEngineModel } from "../lib/engine-model.js";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { CardDrawerProvider, CardName, useAdded, useCardDrawer } from "./card-drawer.js";
/** The web package, found from this file rather than from the working directory, so the test runs
 *  the same from `packages/web` and from the repository root (the root vitest config). */
const WEB = join(import.meta.dirname, "..", "..", "..");

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
  const { added, isAdded } = useAdded();
  return (
    <>
      <span data-testid="lit">{isAdded(name) ? "yes" : "no"}</span>
      <span data-testid="size">{added.size}</span>
    </>
  );
}

/** THE CARDS THIS RUN ADDED ARE MARKED "NEW" (roadmap S9); the reader no longer builds the set by
 *  hand (owner, 2026-09-27). */
test("the cards this run added are new, and nothing else is", () => {
  render(
    <CardDrawerProvider graph={graph} added={["Sol Ring"]}>
      <Probe name="Sol Ring" />
    </CardDrawerProvider>,
  );
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
  expect(screen.getByTestId("size")).toHaveTextContent("1");
});

test("with nothing added, nothing is new", () => {
  render(<CardDrawerProvider graph={graph}><Probe name="Sol Ring" /></CardDrawerProvider>);
  expect(screen.getByTestId("lit")).toHaveTextContent("no");
  expect(screen.getByTestId("size")).toHaveTextContent("0");
});

/** A NEW CARD IS THE PHYSICAL CARD, NEVER A FACE (the S8 identity rule). The same card reaches this
 *  API as a face name and as a physical name, and both have to answer alike. */
test("an added face name marks the physical card, and the face answers too", () => {
  render(
    <CardDrawerProvider graph={graph} added={["Fable of the Mirror-Breaker"]}>
      <Probe name="Fable of the Mirror-Breaker // Reflection of Kiki-Jiki" />
      <span data-testid="sep" />
    </CardDrawerProvider>,
  );
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
});

test("an added physical name answers for its face name", () => {
  render(
    <CardDrawerProvider graph={graph} added={["Fable of the Mirror-Breaker // Reflection of Kiki-Jiki"]}>
      <Probe name="Fable of the Mirror-Breaker" />
    </CardDrawerProvider>,
  );
  expect(screen.getByTestId("lit")).toHaveTextContent("yes");
});

/** THE SET BELONGS TO ITS ANALYSIS: a new deck brings its own added cards, or none. */
test("the set is rebuilt when a new analysis arrives", () => {
  const { rerender } = render(
    <CardDrawerProvider graph={graph} added={["Sol Ring"]}><Probe name="Sol Ring" /></CardDrawerProvider>,
  );
  expect(screen.getByTestId("size")).toHaveTextContent("1");
  const otherGraph = {
    nodes: [{ id: "Sol Ring", label: "Sol Ring", copies: 1, types: [], subtypes: [], supertypes: [], colors: [], cmc: 1 }],
    edges: [],
  } as never;
  rerender(<CardDrawerProvider graph={otherGraph}><Probe name="Sol Ring" /></CardDrawerProvider>);
  expect(screen.getByTestId("size")).toHaveTextContent("0");
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

/** AND THE RESERVE IS THE DRAWER'S OWN WIDTH. `sm:w-80` on the fixed container is 20rem (below `sm` it is a full-width sheet); a reserve
 *  that disagrees either leaves a strip of page under the panel or a gap beside it, and neither is
 *  visible in jsdom. Read off the source so the two cannot drift apart silently. */
test("the reserve matches the drawer's width, at the breakpoint where there is room", () => {
  const css = readFileSync(join(WEB, "client", "src", "index.css"), "utf8");
  const rule = /@media \(min-width: 100rem\) \{\s*body\.drawer-docked \{ padding-inline-end: (\d+)rem; \}/.exec(css);
  expect(rule, "body.drawer-docked rule at min-width: 100rem").not.toBeNull();
  const source = readFileSync(join(WEB, "client", "src", "components", "card-drawer.tsx"), "utf8");
  const width = /className="fixed inset-y-0 right-0 z-30 w-full sm:w-(\d+)/.exec(source);
  expect(width, "the fixed drawer container's width").not.toBeNull();
  // Tailwind's spacing scale is 0.25rem per step, so `w-80` is 20rem.
  expect(Number(rule![1]) * 4).toBe(Number(width![1]));
});

/** ONE PLACE FOR A CARD (report cohesion audit, 2026-09-27): with the report's extras registered,
 *  the drawer walks the commander's map from the card, then closes. */
test("the drawer walks the commander's map from the card, then closes", async () => {
  const { report, graph: deckGraph } = engineDeck();
  const m = buildEngineModel(report, deckGraph);
  const walk = vi.fn();
  function Register() {
    const { setExtras, open } = useCardDrawer();
    useEffect(() => { setExtras({ model: m, walk }); open("Reducer"); }, [setExtras, open]);
    return null;
  }
  render(<CardDrawerProvider graph={deckGraph}><Register /></CardDrawerProvider>);
  const drawer = await screen.findByTestId("card-inspector");
  // The small map of the card's own links went (owner, 2026-09-27): the links are listed instead.
  expect(within(drawer).queryByTestId("card-map")).toBeNull();
  fireEvent.click(within(drawer).getByRole("button", { name: "Walk the map from here" }));
  expect(walk).toHaveBeenCalledWith("Reducer");
  expect(screen.queryByTestId("card-inspector")).toBeNull();
});

/** THE DRAWER MOCKUP (2026-09-27): what the card does in this deck leads, in the map's groups and
 *  the report's own words; the engine's link lists are one tap away, folded. */
test("the drawer says what the card works with and where the report names it", async () => {
  const { report, graph: deckGraph } = engineDeck();
  const m = buildEngineModel(report, deckGraph);
  function Register() {
    const { setExtras, open } = useCardDrawer();
    useEffect(() => {
      setExtras({ model: m, walk: () => {}, where: (n) => (n === "Payoff A" ? ["on the cut list"] : []), groupName: (_k, n) => `${n}!` });
      open("Payoff A");
    }, [setExtras, open]);
    return null;
  }
  render(<CardDrawerProvider graph={deckGraph}><Register /></CardDrawerProvider>);
  const drawer = await screen.findByTestId("card-inspector");
  const summary = within(drawer).getByTestId("drawer-summary");
  expect(summary.textContent).toMatch(/Works with \d+ cards?/);
  expect(summary.textContent).toContain("In this report: on the cut list");
  expect(summary.textContent).toMatch(/! · \d+/);
});

/** OVERLAY BELOW 1600px, SO A CLICK AWAY CLOSES IT (owner, 2026-09-27); a click on another card
 *  switches to it, and a click inside the drawer keeps it. */
test("a click away closes the drawer, a click on another card switches it, a click inside keeps it", async () => {
  const user = userEvent.setup();
  render(
    <CardDrawerProvider graph={graph}>
      <Opener id="Sol Ring" />
      <p>empty page</p>
      <CardName name="Sol Ring" />
    </CardDrawerProvider>,
  );
  await user.click(screen.getByText("open it"));
  const drawer = screen.getByTestId("card-inspector");
  await user.click(within(drawer).getAllByText(/Sol Ring/)[0]!);
  expect(screen.getByTestId("card-inspector")).toBeInTheDocument();
  await user.click(screen.getByText("empty page"));
  expect(screen.queryByTestId("card-inspector")).toBeNull();
  // A card name opens it again, and the same click does not close what it opened.
  await user.click(screen.getByRole("button", { name: "Sol Ring" }));
  expect(screen.getByTestId("card-inspector")).toBeInTheDocument();
});
