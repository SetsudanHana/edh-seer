import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import App from "./App.js";

test("renders a styled HeroUI Analyze button", () => {
  render(<App />);
  const btn = screen.getByRole("button", { name: "Analyze deck" });
  expect(btn).toBeInTheDocument();
  // HeroUI Buttons carry generated utility classes; unstyled plain buttons would not.
  expect(btn.className.length).toBeGreaterThan(0);
});
