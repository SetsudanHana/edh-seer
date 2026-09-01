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
    identity: "Enchantments Entering",
    buildParents: [{ name: "Ramp", count: 17, target: 10, leaves: [] }],
  },
} as unknown as Parameters<typeof RecognitionPanel>[0]["data"];

test("names the theme, so a reader can check it read the same deck they built", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.getByTestId("recognition-identity")).toHaveTextContent("Enchantments Entering");
});

test("states how much of the deck it could read", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.getByTestId("recognition-coverage")).toHaveTextContent("100");
});

test("the donut counts nonlands only, weighted by copies", () => {
  render(<RecognitionPanel data={DATA} />);
  // 4 creatures + 2 enchantments; the 38 lands are not on this chart.
  expect(screen.getByTestId("donut-total")).toHaveTextContent("6");
});

test("carries no 0-5 score: recognition is not a judgement", () => {
  render(<RecognitionPanel data={DATA} />);
  expect(screen.queryByText(/\/\s*5\b/)).toBeNull();
});
