import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { RecognitionPanel } from "./RecognitionPanel.js";

const DATA = {
  resolvedCount: 100,
  totalCount: 100,
  commanderColorIdentity: ["W", "U", "B"],
  graph: {
    nodes: [
      { id: "a", label: "A", copies: 4, types: ["creature"], subtypes: [], supertypes: [] },
      { id: "b", label: "B", copies: 2, types: ["enchantment"], subtypes: [], supertypes: [] },
      { id: "l", label: "L", copies: 38, types: ["land"], subtypes: [], supertypes: [] },
    ],
    edges: [],
  },
  report: {
    cohesion: {
      theme: "enchantments entering",
      tag: "enters:enchantment",
      secondary: null,
      secondaryTag: null,
      score: 0.47,
      familyScore: 0.47,
      label: "focused",
      dominant: true,
    },
    buildParents: [{ name: "Ramp", count: 17, target: 10, leaves: [] }],
  },
} as unknown as Parameters<typeof RecognitionPanel>[0]["data"];

test("names the theme, so a reader can check it read the same deck they built", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.getByTestId("recognition-identity")).toHaveTextContent("enchantments entering");
});

test("states how much of the deck it could read", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.getByTestId("recognition-coverage")).toHaveTextContent("100");
});

test("the bar counts nonlands only, weighted by copies", () => {
  render(<RecognitionPanel data={DATA} />);
  // 4 creatures + 2 enchantments; the 38 lands are not on this chart.
  expect(screen.getByTestId("type-total")).toHaveTextContent("6");
});

test("carries no 0-5 score: recognition is not a judgement", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.queryByText(/\/\s*5\b/)).toBeNull();
});

test("says so when the engine found no dominant theme, rather than hiding it", () => {
  const noTheme = {
    ...DATA,
    report: {
      ...DATA.report,
      cohesion: { theme: "tokens", dominant: false, score: 0.1, label: "unfocused" },
    },
  } as typeof DATA;
  render(<RecognitionPanel data={noTheme} />);
  expect(screen.getByTestId("recognition-identity")).toHaveTextContent("No dominant theme");
});

/** I4 (whole-branch review, 2026-09-01). MOVED HERE, not deleted: `components.test.tsx` had
 *  "DeckIdentity names the deck when dominant is absent" and struck it as cleanup when the theme
 *  headline left `DeckIdentity`. It was pinning a TRI-STATE, and the tri-state came here with the
 *  headline. `dominant: true` is the engine saying it found one, `false` is the engine saying it
 *  looked and did not, and ABSENT is a caller written before the field existed -- which is not an
 *  opinion at all, so the theme is named rather than refused. `RecognitionPanel.tsx` spells that as
 *  `cohesion.dominant !== false`, and the "simplification" this test exists to fail is
 *  `!cohesion.dominant`, which silently collapses absent into false. */
test("an absent `dominant` field names the theme: it is a caller predating the field, not a refusal", () => {
  const noField = {
    ...DATA,
    report: {
      ...DATA.report,
      cohesion: { theme: "wizards entering", tag: "enters:wizard", score: 0.4, label: "focused" },
    },
  } as unknown as typeof DATA;
  render(<RecognitionPanel data={noField} />);
  const el = screen.getByTestId("recognition-identity");
  expect(el).toHaveTextContent("wizards entering");
  expect(el).not.toHaveTextContent("No dominant theme");
  expect(el).not.toHaveTextContent("strongest:");
});

/** THE GUARD THAT MOVED HERE FROM `DeckIdentity`. The theme headline used `strategies[0].label`
 *  for three weeks, which read "Tokens" on a wizard tribal deck while `cohesion.theme` read
 *  "wizards entering" -- the stronger answer was computed and discarded. `DeckIdentity` carries
 *  the full story in its file comment. Recognition owns the theme now, so the guard lives here:
 *  the archetype is context, never the title. */
test("names the cohesion theme, never the top archetype", () => {
  const withArchetype = {
    ...DATA,
    report: {
      ...DATA.report,
      cohesion: { ...DATA.report.cohesion, theme: "draw", dominant: true },
      strategies: [{ name: "tokens", label: "Tokens", confidence: 0.4 }],
    },
  } as typeof DATA;
  render(<RecognitionPanel data={withArchetype} />);
  expect(screen.getByTestId("recognition-identity")).toHaveTextContent("draw");
  expect(screen.getByTestId("recognition-identity")).not.toHaveTextContent("Tokens");
});

/** C2 (whole-branch review, 2026-09-01). This used to read `resolvedCount`/`totalCount` -- NAME
 *  RESOLUTION, how many decklist lines matched a card -- which on a partly-read deck can both sit
 *  at 100/100 while `report.coverage` (how many of those the synergy engine could actually read)
 *  says 52/100. `CoveragePanel` above this panel prints the coverage figure; this test proves the
 *  two counters at the top of the page cannot disagree about the same question again. */
test("reads coverage.derived/resolved, not resolvedCount/totalCount, when coverage is present", () => {
  const partlyRead = {
    ...DATA,
    report: {
      ...DATA.report,
      coverage: { resolved: 100, derived: 52, underivedNames: [], more: 0, caveat: "" },
    },
  } as typeof DATA;
  render(<RecognitionPanel data={partlyRead} />);
  expect(screen.getByTestId("recognition-coverage")).toHaveTextContent("read 52 of 100 cards");
});

test("falls back to resolvedCount/totalCount when the report carries no coverage", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.getByTestId("recognition-coverage")).toHaveTextContent("read 100 of 100 cards");
});

/** I1 (whole-branch review, 2026-09-01). `DeckIdentity` prints "No theme found in the cards read"
 *  on a partly-read deck rather than the unqualified "No dominant theme" -- the first is a
 *  statement about the ENGINE, the second a verdict about the DECK, and Recognition printed only
 *  the unqualified string, above DeckIdentity's own qualified one. */
test("qualifies the no-theme sentence on a partly-read deck, same as DeckIdentity", () => {
  const noThemePartlyRead = {
    ...DATA,
    report: {
      ...DATA.report,
      cohesion: { theme: "tokens", dominant: false, score: 0.1, label: "unfocused" },
      coverage: { resolved: 100, derived: 52, underivedNames: [], more: 0, caveat: "" },
    },
  } as unknown as typeof DATA;
  render(<RecognitionPanel data={noThemePartlyRead} />);
  const el = screen.getByTestId("recognition-identity");
  expect(el).toHaveTextContent("No theme found in the cards read");
  expect(el).not.toHaveTextContent("No dominant theme · strongest");
  // The engine's best-supported (if not dominant) theme still gets named.
  expect(el).toHaveTextContent("strongest: tokens");
});

/** I3 (whole-branch review, 2026-09-01). The spec's own ordering is "theme · commander · colour
 *  identity" -- for an EDH player the commander is the recognition anchor, and it was missing
 *  entirely. Also proves the colour identity reads as a name ("Esper"), not bare letters ("WUB"),
 *  matching `DeckIdentity`'s own `identityLabel` twenty lines below on the same page. */
test("names the commander and the colour identity, not bare letters", () => {
  const withCommander = {
    ...DATA,
    report: {
      ...DATA.report,
      deckMath: {
        castability: {
          commanders: [
            { name: "Krenko, Mob Boss", turn: 4, castable: { low: 0.5, high: 0.7 }, mana: { low: 0.5, high: 0.7 } },
          ],
        },
      },
    },
  } as typeof DATA;
  render(<RecognitionPanel data={withCommander} />);
  const el = screen.getByTestId("recognition-identity");
  expect(el).toHaveTextContent("Krenko, Mob Boss");
  expect(el).toHaveTextContent("Esper");
  expect(el).not.toHaveTextContent("WUB");
});

test("names no commander when deckMath was never computed", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.getByTestId("recognition-identity")).not.toHaveTextContent("Krenko");
});

/** THE THEME IS THE ANSWER, SO IT LOOKS LIKE ONE (owner review, 2026-09-01). "enchantments
 *  entering" shipped as the first word of a 14px muted metadata run, typographically identical to
 *  the coverage counter beside it -- the panel asked "What this deck is" and then whispered the
 *  answer at the same weight as its own footnotes. The theme now owns its own display line; the
 *  metadata that qualifies it stays small beneath. `recognition-identity` still wraps both, so the
 *  guards above (theme, commander, colours, coverage) keep reading one element. */
test("the theme is a display line of its own, not a word inside the metadata run", () => {
  render(<RecognitionPanel data={DATA} />);
  const theme = screen.getByTestId("recognition-theme");
  expect(theme).toHaveTextContent("enchantments entering");
  // The metadata paragraph carries the counter and never the theme.
  const meta = screen.getByTestId("recognition-coverage").closest("p");
  expect(meta).not.toHaveTextContent("enchantments entering");
});

/** COLOUR PIPS BESIDE THE IDENTITY NAME (owner review, 2026-09-01). "Grixis" is a name a player has
 *  to know to read; the three mana symbols are the same fact rendered in the game's own vocabulary,
 *  and index.css has said "identity in the interface uses real mana symbols" since the ramp was
 *  written. Reuses `ManaSymbols` (Scryfall symbology SVGs) rather than a second symbol path, and
 *  the pips are aria-hidden because the word next to them already says it. */
test("draws the colour identity as mana pips beside its name", () => {
  const grixis = { ...DATA, commanderColorIdentity: ["R", "B", "U"] } as typeof DATA;
  const { container } = render(<RecognitionPanel data={grixis} />);
  const pips = container.querySelectorAll("img[src*='card-symbols']");
  expect([...pips].map((p) => p.getAttribute("src"))).toEqual([
    "https://svgs.scryfall.io/card-symbols/U.svg",
    "https://svgs.scryfall.io/card-symbols/B.svg",
    "https://svgs.scryfall.io/card-symbols/R.svg",
  ]);
  expect(screen.getByTestId("recognition-identity")).toHaveTextContent("Grixis");
});
