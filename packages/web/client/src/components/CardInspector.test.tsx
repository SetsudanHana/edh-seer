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

  // TRUNCATION IS STATED, NEVER SILENT — but it is the BOARD that truncates, and the sentence has to
  // say which. It used to read "32 in total · strongest 6 shown" as a header over this panel's own
  // list, which renders EVERY edge; a reviewer reading it concluded the other 26 relations were
  // unreachable. Both facts, in one sentence: the board draws 6, the panel lists all 32.
  it("says the BOARD draws the strongest few, and that the panel lists them all", () => {
    const flow = { truncated: new Map([["Bitterblossom", { down: { total: 32, shown: 6 } }]]) };
    render(<CardInspector node={node} edges={edges} flow={flow} onClose={() => {}} />);
    expect(screen.getByText(/board draws the strongest 6/i)).toBeInTheDocument();
    expect(screen.getByText(/all 32 are listed here/i)).toBeInTheDocument();
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
    expect(feedsSection?.textContent).toMatch(/strongest 6.*all 10 are listed/i);
    expect(fedBySection?.textContent).toMatch(/strongest 6.*all 8 are listed/i);
  });
});

/** THE PRINTED TYPE LINE, NOT ONE RECOMPOSED FROM THE UNION OVER FACES.
 *
 *  A node's `types`/`subtypes` are the union across every face -- right for the paint legend, where
 *  a node shows a hue per type it can be. Joining them back into a type line names an object no
 *  face is: a skeptic review, 2026-08-27, read "legendary artifact creature — robot vehicle" under
 *  a card image printing "Legendary Artifact Creature — Robot" and said "merging them describes an
 *  object that neither face is". */
describe("CardInspector type line", () => {
  const twoFaced = {
    id: "Megatron, Tyrant // Megatron, Destructive Force",
    label: "Megatron, Tyrant // Megatron, Destructive Force",
    copies: 1,
    types: ["artifact", "creature"],
    // One subtype from EACH face -- no single face is a Robot AND a Vehicle.
    subtypes: ["robot", "vehicle"],
    supertypes: ["legendary"],
    typeLine: "Legendary Artifact Creature — Robot // Legendary Artifact Creature — Robot Vehicle",
    colors: ["B"], cmc: 6,
  };

  it("shows what the card prints, not the union over its faces", () => {
    render(<CardInspector node={twoFaced as never} edges={[]} onClose={() => {}} />);
    expect(screen.getByText(twoFaced.typeLine)).toBeInTheDocument();
    // The union recomposed -- "legendary artifact creature — robot vehicle" -- must NOT appear.
    // Asserted against that exact string and not against /robot vehicle/, because the BACK face
    // really is a Robot Vehicle and the printed line rightly says so; what was wrong was flattening
    // both faces into ONE line that no face prints.
    expect(screen.queryByText("legendary artifact creature — robot vehicle")).toBeNull();
  });

  it("falls back to the union when a graph predates the field", () => {
    const { typeLine: _dropped, ...older } = twoFaced;
    render(<CardInspector node={older as never} edges={[]} onClose={() => {}} />);
    // Worse, and better than nothing -- an older cached graph must still render.
    expect(screen.getByText("legendary artifact creature — robot vehicle")).toBeInTheDocument();
  });
});

/** AND THE PANEL MUST ACTUALLY USE IT. `demand-sentence.test.ts` pins `tagLabel` itself, and
 *  mutating the inspector back to `{t}` left that test green -- the recorded trap in this repo:
 *  a probe that calls the inner function does not test the gate that selects it. This asserts the
 *  rendered CHIP, so the raw key cannot come back through the call site. */
describe("CardInspector tag chips", () => {
  const node = {
    id: "Grim Haruspex", label: "Grim Haruspex", copies: 1,
    types: ["creature"], subtypes: ["human"], supertypes: [],
    typeLine: "Creature — Human Wizard", colors: ["B"], cmc: 3,
  };
  const edges = [{
    from: "Grim Haruspex", to: "Samwise Gamgee", weight: 1.6,
    tags: ["enters:creature"],
    reasonTexts: ["When Grim Haruspex enters, Samwise Gamgee makes a token"],
  }];

  it("labels a relationship's tags instead of printing the raw key", () => {
    render(<CardInspector node={node as never} edges={edges as never} onClose={() => {}} />);
    expect(screen.getByText("Entering the battlefield · creature")).toBeInTheDocument();
    expect(screen.queryByText("enters:creature")).toBeNull();
  });
});

/** THE IMAGE IS CAPPED SO THE RELATIONSHIPS CLEAR THE FOLD.
 *
 *  jsdom has no layout, so the real check is a MEASUREMENT and not this test: on the review deck
 *  the panel is 500px tall with 1,415px of content, and FEEDS began 49px BELOW its own bottom edge
 *  -- two thirds of the panel reachable only by scrolling a box with no affordance. Three persona
 *  reads across two rounds reported the panel tells them nothing. After the cap, measured live:
 *  content 1,259px, and both FEEDS and the first relationship row sit above the fold.
 *
 *  What this test can pin is that the constraint EXISTS and that the aspect ratio is preserved --
 *  an uncapped `w-full` image is what ate the panel, and a capped one without `object-contain`
 *  would stretch a portrait card, which is worse than a small one. */
describe("CardInspector card image", () => {
  it("caps the card image and keeps its aspect ratio", () => {
    const node = {
      id: "Grim Haruspex", label: "Grim Haruspex", copies: 1,
      types: ["creature"], subtypes: ["human"], supertypes: [],
      typeLine: "Creature — Human Wizard", colors: ["B"], cmc: 3,
      artCrop: "https://example.com/a.jpg",
    };
    render(<CardInspector node={node as never} edges={[]} onClose={() => {}} />);
    const img = screen.getByAltText("Grim Haruspex");
    expect(img.className).toMatch(/max-h-/);
    expect(img.className).toContain("object-contain");
  });
});
