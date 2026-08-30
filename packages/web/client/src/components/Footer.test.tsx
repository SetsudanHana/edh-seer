import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import { Footer } from "./Footer.js";

afterEach(cleanup);

/** THE NOTICE IS A CONDITION OF SHOWING THE CARDS, so these are assertions about a legal
 *  obligation rather than about copy. The wording of the first paragraph is Wizards' own and is
 *  not ours to paraphrase. */
test("carries the Fan Content Policy wording Wizards requires, verbatim", () => {
  render(<Footer />);
  const text = document.body.textContent ?? "";
  expect(text).toContain("EDH Seer is unofficial Fan Content permitted under the");
  expect(text).toContain("Not approved or endorsed by Wizards");
  expect(text).toContain("Portions of the materials used are property of Wizards of the Coast");
  expect(text).toContain("©Wizards of the Coast LLC");
});

test("disclaims affiliation and names the trademark holder", () => {
  render(<Footer />);
  const text = document.body.textContent ?? "";
  expect(text).toContain("not affiliated with, endorsed, sponsored, or specifically approved by");
  expect(text).toMatch(/trademarks of Wizards of the Coast LLC/);
});

test("credits the data sources the app actually uses, and claims no prices", () => {
  render(<Footer />);
  const text = document.body.textContent ?? "";
  expect(text).toContain("Scryfall");
  expect(text).toContain("Commander Spellbook");
  // A price disclaimer would be a claim about data this app does not show. `cost` here is a mana
  // cost; if prices are ever added, this assertion is the thing that says the notice must change.
  expect(text).toContain("shows no card prices");
});

test("every outbound link opens away from the app and leaks no referrer", () => {
  render(<Footer />);
  const links = [...document.querySelectorAll("a")];
  expect(links.length).toBeGreaterThan(0);
  for (const a of links) {
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toContain("noopener");
    expect(a.getAttribute("rel")).toContain("noreferrer");
    expect(a.getAttribute("href")).toMatch(/^https:\/\//);
  }
});
