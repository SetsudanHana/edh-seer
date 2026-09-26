import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { engineDeck } from "../lib/engine-model.fixture.js";
import { EnginesView } from "./EnginesView.js";

test("the Overview points to the report chapters its parts moved to", () => {
  const { report, graph } = engineDeck();
  render(<EnginesView report={report} graph={graph} />);
  expect(screen.getByText(/Everything this view showed is now in the report/)).toBeInTheDocument();
  for (const name of ["Game plan", "Roles", "How to improve it"]) expect(screen.getByText(name)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Cards doing the least here" })).toBeNull();
});
