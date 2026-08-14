import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CardInspector } from "./CardInspector.js";

const node = {
  id: "Bitterblossom", label: "Bitterblossom", copies: 1,
  types: ["enchantment"], subtypes: ["faerie"], supertypes: [], colors: ["B"], cmc: 1,
  roles: ["tokens"],
};

const edges = [
  { from: "Bitterblossom", to: "Zulaport Cutthroat", weight: 2.5,
    tags: ["tokens"], reasonTexts: ["Bitterblossom makes bodies for Zulaport Cutthroat"] },
  { from: "Bitterblossom", to: "Intangible Virtue", weight: 0.4,
    tags: ["anthem"], reasonTexts: ["Bitterblossom's tokens are pumped by Intangible Virtue"] },
];

describe("CardInspector", () => {
  it("names the card", () => {
    render(<CardInspector node={node} edges={edges} onClose={() => {}} />);
    expect(screen.getByText("Bitterblossom")).toBeInTheDocument();
  });

  it("lists edges strongest first", () => {
    render(<CardInspector node={node} edges={edges} onClose={() => {}} />);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(items[0]).toContain("Zulaport Cutthroat");
    expect(items[1]).toContain("Intangible Virtue");
  });

  it("shows the reason text that justified an edge", () => {
    // The point of the panel: every visual claim one click from what produced it.
    render(<CardInspector node={node} edges={edges} onClose={() => {}} />);
    expect(screen.getByText(/makes bodies for Zulaport Cutthroat/)).toBeInTheDocument();
  });

  it("says so plainly when a card has no edges at all", () => {
    render(<CardInspector node={node} edges={[]} onClose={() => {}} />);
    expect(screen.getByText(/no synergy edges/i)).toBeInTheDocument();
  });

  // An edge is directed and this panel shows BOTH directions -- a card is the producer on some of
  // its edges and the consumer on others, and `edges` is every edge naming it on either end. The
  // four tests above only exercise the outgoing case (Bitterblossom is `from` on both fixture
  // edges); this one makes the incoming direction's row text distinguishable rather than reading
  // identically to an outgoing row that happens to name the same partner.
  it("makes the incoming direction distinct from the outgoing one", () => {
    const incoming = [
      { from: "Zulaport Cutthroat", to: "Bitterblossom", weight: 2.5,
        tags: ["tokens"], reasonTexts: ["Zulaport Cutthroat drains when Bitterblossom's faeries die"] },
    ];
    const { unmount } = render(<CardInspector node={node} edges={incoming} onClose={() => {}} />);
    const incomingRow = screen.getAllByRole("listitem")[0].textContent ?? "";
    unmount();

    render(<CardInspector node={node} edges={edges} onClose={() => {}} />);
    const outgoingRow = screen.getAllByRole("listitem")[0].textContent ?? "";

    expect(incomingRow).toContain("Zulaport Cutthroat");
    expect(outgoingRow).toContain("Zulaport Cutthroat");
    // Same partner name appears on both rows -- direction has to be carried by ordering, not just
    // which names show up.
    expect(incomingRow.indexOf("Zulaport Cutthroat")).toBeLessThan(incomingRow.indexOf("Bitterblossom"));
    expect(outgoingRow.indexOf("Bitterblossom")).toBeLessThan(outgoingRow.indexOf("Zulaport Cutthroat"));
  });

  // THE PANEL MUST SAY WHAT THE BOARD SAYS. A panel and a geometry that disagree is the failure the
  // retired rooms already produced once.
  it("splits the edge list into what the card feeds and what feeds it", () => {
    const both = [
      { from: "Bitterblossom", to: "Zulaport Cutthroat", weight: 2, tags: [], reasonTexts: ["feeds"] },
      { from: "Intangible Virtue", to: "Bitterblossom", weight: 1, tags: [], reasonTexts: ["fed by"] },
    ];
    render(<CardInspector node={node} edges={both} onClose={() => {}} />);
    // Both headings existing is not enough -- a mis-split that put both partners under ONE heading
    // would still pass that assertion. Each partner must appear under its OWN heading's section.
    const feedsSection = screen.getByText(/^Feeds$/).closest("div");
    const fedBySection = screen.getByText(/^Fed by$/).closest("div");
    expect(feedsSection?.textContent).toContain("Zulaport Cutthroat");
    expect(feedsSection?.textContent).not.toContain("Intangible Virtue");
    expect(fedBySection?.textContent).toContain("Intangible Virtue");
    expect(fedBySection?.textContent).not.toContain("Zulaport Cutthroat");
  });

  // A ONE-DIRECTIONAL CARD MUST NOT RENDER AN EMPTY HEADING. Confirmed visible in production: a
  // card with only outgoing edges left "Fed by" printed with nothing beneath it.
  it("says 'None' rather than nothing under a heading with no edges in that direction", () => {
    render(<CardInspector node={node} edges={edges} onClose={() => {}} />);
    const fedBySection = screen.getByText(/^Fed by$/).closest("div");
    expect(fedBySection?.textContent).toMatch(/none/i);
  });

  // TRUNCATION IS STATED, NEVER SILENT. A hub with 32 consumers draws 6; a view that omits three
  // quarters of a card's reach while looking complete is what "a silent wrong answer is worse than a
  // missing one" exists to prevent.
  it("states how many edges were truncated from the drawn flow", () => {
    const flow = { truncated: new Map([["Bitterblossom", { down: { total: 32, shown: 6 } }]]) };
    render(<CardInspector node={node} edges={edges} flow={flow} onClose={() => {}} />);
    expect(screen.getByText(/32 in total/)).toBeInTheDocument();
    expect(screen.getByText(/strongest 6 shown/i)).toBeInTheDocument();
  });

  // THE ROOT CAN BE TRUNCATED ON BOTH WALKS AT ONCE -- keying by id alone let the upstream walk's
  // entry silently overwrite the downstream walk's, so a card feeding 10 (shown 6) and fed by 8
  // (shown 6) printed "8 in total" under "Feeds". Each heading must read its OWN direction's entry.
  it("reports each direction's truncation separately, never the other direction's count", () => {
    const flow = {
      truncated: new Map([["Bitterblossom", { down: { total: 10, shown: 6 }, up: { total: 8, shown: 6 } }]]),
    };
    const both = [
      { from: "Bitterblossom", to: "Zulaport Cutthroat", weight: 2, tags: [], reasonTexts: ["feeds"] },
      { from: "Intangible Virtue", to: "Bitterblossom", weight: 1, tags: [], reasonTexts: ["fed by"] },
    ];
    render(<CardInspector node={node} edges={both} flow={flow} onClose={() => {}} />);
    const feedsSection = screen.getByText(/^Feeds$/).closest("div");
    const fedBySection = screen.getByText(/^Fed by$/).closest("div");
    expect(feedsSection?.textContent).toMatch(/10 in total.*strongest 6 shown/i);
    expect(fedBySection?.textContent).toMatch(/8 in total.*strongest 6 shown/i);
  });
});
