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

/** THE RESERVE FOLLOWS THE RAIL, NEVER THE CARD (owner, 2026-09-29). Toggled on each open, it
 *  re-flowed the whole report -- the row just clicked moved 240px down at 1920. A surface with a
 *  rail holds the space while it is mounted; opening and closing a card changes nothing on `body`. */
function RailOn() {
  const { setRailOn } = useCardDrawer();
  useEffect(() => { setRailOn(true); return () => setRailOn(false); }, [setRailOn]);
  return null;
}

/** THE WAY BACK IS WHERE THE CARD WAS OPENED FROM (persona round 2026-09-29): the page scrolling
 *  under an open card changed the surface's chapter, and the button went with it -- a card opened
 *  from Game plan offered "Back to manabase". */
function RailBack({ label }: { label: string }) {
  const { setRailOn, setRailBack } = useCardDrawer();
  useEffect(() => { setRailOn(true); return () => setRailOn(false); }, [setRailOn]);
  useEffect(() => { setRailBack(label); }, [label, setRailBack]);
  return null;
}

test("the rail's way back keeps the chapter the card was opened from", async () => {
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
  try {
    const { rerender } = render(<CardDrawerProvider graph={graph}><RailBack label="Back to game plan" /><Opener id="Sol Ring" /></CardDrawerProvider>);
    await userEvent.click(screen.getByText("open it"));
    expect(screen.getByRole("button", { name: "Back to game plan" })).toBeInTheDocument();
    // The page scrolls on under the card; the chapter behind it changes.
    rerender(<CardDrawerProvider graph={graph}><RailBack label="Back to manabase" /><Opener id="Sol Ring" /></CardDrawerProvider>);
    expect(screen.getByRole("button", { name: "Back to game plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back to manabase" })).not.toBeInTheDocument();
  } finally {
    vi.unstubAllGlobals();
  }
});

test("opening a card never moves the page: the rail holds the space while the report is up", async () => {
  const { unmount } = render(<CardDrawerProvider graph={graph}><Opener id="Sol Ring" /></CardDrawerProvider>);
  // No rail (a precon page): the card floats over the page, and nothing is reserved.
  await userEvent.click(screen.getByText("open it"));
  expect(document.body.classList.contains("drawer-rail")).toBe(false);
  unmount();
  const withRail = render(<CardDrawerProvider graph={graph}><RailOn /><Opener id="Sol Ring" /></CardDrawerProvider>);
  expect(document.body.classList.contains("drawer-rail")).toBe(true);
  await userEvent.click(screen.getByText("open it"));
  expect(document.body.classList.contains("drawer-rail")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: /close/i }));
  expect(document.body.classList.contains("drawer-rail")).toBe(true);
  withRail.unmount();
  expect(document.body.classList.contains("drawer-rail")).toBe(false);
});

/** AND THE RESERVE IS THE RAIL'S OWN WIDTH. One variable, `--rail-w`, sizes the page's reserve, the
 *  rail and the card while it covers the rail; a reserve that disagrees leaves a strip of page under
 *  the rail or a gap beside it, and neither is visible in jsdom. Read off the source so the three
 *  cannot drift apart silently. The overlay (below 100rem, or with no rail) is `sm:w-80`, which is
 *  the variable's base value. */
test("the reserve, the rail and the card on it are one width, at the breakpoint where there is room", () => {
  const css = readFileSync(join(WEB, "client", "src", "index.css"), "utf8");
  expect(css).toMatch(/@media \(min-width: 100rem\) \{\s*body\.drawer-rail \{ padding-inline-end: var\(--rail-w\); \}/);
  const base = /--rail-w: (\d+)rem;/.exec(css);
  expect(base, "--rail-w's base value").not.toBeNull();
  const source = readFileSync(join(WEB, "client", "src", "components", "card-drawer.tsx"), "utf8");
  const box = /const RAIL_BOX = "([^"]+)"/.exec(source)?.[1] ?? "";
  expect(box).toContain("w-(--rail-w)");
  // The rail and the card that covers it are the same box, so a card opening on the rail moves nothing.
  expect(source).toContain("${RAIL_BOX} z-20");
  expect(source).toContain("${RAIL_BOX} z-30");
  // Tailwind's spacing scale is 0.25rem per step, so the overlay's `sm:w-80` is 20rem.
  const overlay = /fixed inset-y-0 right-0 z-30 w-full sm:w-(\d+)/.exec(source);
  expect(Number(overlay?.[1])).toBe(Number(base![1]) * 4);
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

/** PAIR-VIEW MOCKUPS F1/F2 (owner, 2026-09-30): a link in the drawer opens the two cards as a pair
 *  on the commander's map, and the drawer closes. Without the report's map, nothing is offered. */
test("a link in the drawer opens the pair on the map, then the drawer closes", async () => {
  const { report, graph: bare } = engineDeck();
  const m = buildEngineModel(report, bare);
  // The drawer lists the graph's edges; the fixture's links live in the report, so one is drawn.
  const other = [...m.partners.get("Reducer")!.keys()][0]!;
  const deckGraph = { ...bare, edges: [{ from: "Reducer", to: other, weight: 1, tags: [], reasonTexts: ["Reducer reduces what it costs"] }] } as typeof bare;
  const pair = vi.fn();
  function Register({ withPair }: { withPair: boolean }) {
    const { setExtras, open } = useCardDrawer();
    useEffect(() => { setExtras({ model: m, walk: () => {}, ...(withPair ? { pair } : {}) }); open("Reducer"); }, [setExtras, open, withPair]);
    return null;
  }
  const { unmount } = render(<CardDrawerProvider graph={deckGraph}><Register withPair={false} /></CardDrawerProvider>);
  expect(within(await screen.findByTestId("card-inspector")).queryByRole("button", { name: "See the two on the map" })).toBeNull();
  unmount();
  render(<CardDrawerProvider graph={deckGraph}><Register withPair /></CardDrawerProvider>);
  const drawer = await screen.findByTestId("card-inspector");
  fireEvent.click(within(drawer).getAllByRole("button", { name: "See the two on the map" })[0]!);
  expect(pair).toHaveBeenCalledTimes(1);
  const [a, b] = pair.mock.calls[0]!;
  expect([a, b]).toEqual(["Reducer", other]);
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
