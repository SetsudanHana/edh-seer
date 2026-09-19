import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { EngineReading } from "./EngineReading.js";
import type { AbilityRow } from "@edh-seer/matcher/partners-core";
import { groupAnchor } from "../lib/group-anchor.js";

/** THE CARD, READ DOWN THE CARD (roadmap AJ4, spec C1). Samut is the worked example and the proof
 *  case: 4 clauses, 3 abilities, and the first clause derives nothing -- so every row of a
 *  positional zip would be wrong. */
const CLAUSES = [
  { id: 1, text: "First strike, vigilance, haste" },
  { id: 2, text: "Start your engines!" },
  { id: 3, text: "Other creatures you control get +X/+0, where X is your speed." },
  { id: 4, text: "Noncreature spells you cast cost {X} less to cast, where X is your speed." },
];
const ABILITIES: AbilityRow[] = [
  { kind: "static", clause: 3, effect: "pump", when: [], emits: [] },
  { kind: "static", clause: 4, effect: "cost-reduction", when: [], emits: [] },
  { kind: "triggered", effect: "speed", when: ["lose-life|-|-|-"], emits: [] },
];

test("each clause carries the abilities it derived, by id and never by position", () => {
  render(<EngineReading clauses={CLAUSES} abilities={ABILITIES} />);
  const items = screen.getAllByRole("listitem");
  // The keyword line is listed -- the engine read it -- and nothing is claimed under it.
  const first = items.find((li) => li.textContent?.startsWith("First strike"))!;
  expect(first.textContent).toBe("First strike, vigilance, haste");
  // The pump belongs to clause 3, not to clause 2 where a zip would have put it.
  const pump = items.find((li) => li.textContent?.includes("Other creatures you control"))!;
  expect(pump.textContent).toMatch(/static/);
});

/** A CLAUSE THAT DERIVES NOTHING SAYS NOTHING (spec C3, owner ruling): being listed is the
 *  statement that the engine read it. Any wording would editorialise on a keyword line. */
test("a clause with no abilities carries no copy", () => {
  render(<EngineReading clauses={CLAUSES} abilities={ABILITIES} />);
  expect(screen.queryByText(/nothing the engine reads/i)).toBeNull();
  expect(screen.queryByText(/no synergy/i)).toBeNull();
});

/** AN IMPLIED ABILITY HAS NO PRINTED LINE (spec C4), so it sits at the end with no quote above it.
 *  226 of 54,586 rows corpus-wide carry no clause. */
test("an ability with no clause goes to the end, under its own label", () => {
  render(<EngineReading clauses={CLAUSES} abilities={ABILITIES} />);
  const label = screen.getByText(/read off the card itself/i);
  expect(label).toBeInTheDocument();
  expect(label.compareDocumentPosition(screen.getByText(/Noncreature spells/)) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});

/** THE EVENT ROW JUMPS TO THE GROUP (spec C5): a plain anchor, and only where the group exists --
 *  an anchor that lands nowhere is worse than plain text. */
test("an event links to its partner group, and only when there is one", () => {
  const rows: AbilityRow[] = [{ kind: "triggered", clause: 2, effect: "speed", when: ["lose-life|-|-|-"], emits: [] }];
  const { rerender } = render(<EngineReading clauses={CLAUSES} abilities={rows} rarity={{ "lose-life|-|-|-": 1204 }}
    grouped={new Set(["lose-life|-|-|-"])} />);
  const link = screen.getByRole("link", { name: /life is lost/i });
  expect(link).toHaveAttribute("href", `#${groupAnchor("lose-life|-|-|-")}`);
  expect(link.textContent).toMatch(/1,204 cards/);
  // No group on this page: the same words, no link to nowhere.
  rerender(<EngineReading clauses={CLAUSES} abilities={rows} rarity={{ "lose-life|-|-|-": 1204 }} grouped={new Set()} />);
  expect(screen.queryByRole("link", { name: /life is lost/i })).toBeNull();
  expect(screen.getByText(/life is lost/i)).toBeInTheDocument();
});

/** THE CARD-LEVEL EMPTY STATE STAYS (roadmap W10): an empty reading is where a wrong "no ability"
 *  can be seen at all -- 117 derived commanders carried zero abilities. */
test("a card the engine read nothing on says so", () => {
  render(<EngineReading abilities={[]} />);
  expect(screen.getByText(/read nothing on this card/i)).toBeInTheDocument();
});
