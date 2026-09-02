import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GraphNode } from "../types.js";
import { CardInspector } from "./CardInspector.js";
import { CardDrawerProvider, useCardDrawer } from "./card-drawer.js";

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

/** THE EVIDENCE FOR A CLAIM, BESIDE THE CLAIM. Every sentence in this panel is about a card whose
 *  text the panel did not show. A skeptic review could audit only the two pairs it believed it knew
 *  and misremembered BOTH -- calling the engine wrong where oracle text says it is right -- and
 *  concluded "a right answer and a wrong answer are the same pixels". */
describe("CardInspector partner text", () => {
  const node = {
    id: "Megatron", label: "Megatron", copies: 1,
    types: ["creature"], subtypes: [], supertypes: ["legendary"],
    typeLine: "Legendary Artifact Creature — Robot", colors: ["B"], cmc: 6,
  };
  const edges = [{
    from: "Megatron", to: "Samwise Gamgee", weight: 1.6,
    tags: ["enters:creature"],
    reasonTexts: ["When Megatron enters, Samwise Gamgee makes a token"],
  }];
  const text = (id: string) =>
    id === "Samwise Gamgee"
      ? "Whenever another nontoken creature you control enters, create a Food token."
      : undefined;

  it("offers the PARTNER's printed text, not the selected card's", async () => {
    render(<CardInspector node={node as never} edges={edges as never} textOf={text} onClose={() => {}} />);
    // Collapsed by default: sixty-two rows of oracle text would bury the relationships.
    const d = screen.getByText("Samwise Gamgee's text");
    await userEvent.click(d);
    expect(screen.getByText(/Whenever another nontoken creature you control enters/)).toBeInTheDocument();
  });

  it("shows no disclosure when the partner's text is unknown", () => {
    render(<CardInspector node={node as never} edges={edges as never} onClose={() => {}} />);
    expect(screen.queryByText(/'s text$/)).toBeNull();
  });
});

/** S18, AND IT IS THE ITEM'S WHOLE ASK. The skeptic could not check one synergy claim on nine
 *  screens: "the page asserts a relationship between two named cards and never prints either
 *  card's text, so a right answer and a wrong one look identical on my screen." The roadmap line
 *  recorded this panel as already showing the partner's text one click away -- it did not, for any
 *  card with one face. `face` is set only when `faces.length > 1`, so a single-face card fell
 *  through the condition while `node.oracleText` sat on the wire unused. */
describe("CardInspector card text", () => {
  const oneFaced = {
    id: "Arcane Signet", label: "Arcane Signet", copies: 1,
    types: ["artifact"], subtypes: [], supertypes: [], typeLine: "Artifact",
    colors: [], cmc: 2,
    oracleText: "{T}: Add one mana of any color in your commander's color identity.",
  };

  it("prints a single-face card's own text, which is the evidence for every claim about it", () => {
    render(<CardInspector node={oneFaced as never} edges={[]} onClose={() => {}} />);
    expect(screen.getByText(/Add one mana of any color in your commander's color identity/))
      .toBeInTheDocument();
  });

  it("says nothing rather than an empty line when the card carries no text", () => {
    const vanilla = { ...oneFaced, oracleText: undefined };
    const { container } = render(<CardInspector node={vanilla as never} edges={[]} onClose={() => {}} />);
    expect(container.querySelector(".whitespace-pre-line")).toBeNull();
  });
});

/** A DOUBLE-FACED CARD DREW ONLY ITS FRONT. Owner, 2026-08-27: "for double faced cards we need a
 *  way to present them, cause right now you see only front". The corpus carries every face's name,
 *  type line, cost, text and art; none of it reached the panel. */
describe("CardInspector faces", () => {
  const twoFaced = {
    id: "Megatron", label: "Megatron, Tyrant // Megatron, Destructive Force", copies: 1,
    types: ["artifact", "creature"], subtypes: ["robot", "vehicle"], supertypes: ["legendary"],
    typeLine: "Legendary Artifact Creature — Robot // Legendary Artifact — Vehicle",
    colors: ["B"], cmc: 6,
    faces: [
      { name: "Megatron, Tyrant", typeLine: "Legendary Artifact Creature — Robot",
        manaCost: "{3}{R}{W}{B}", oracleText: "Your opponents can't cast spells during combat." },
      { name: "Megatron, Destructive Force", typeLine: "Legendary Artifact — Vehicle",
        oracleText: "Living metal (During your turn, this Vehicle is also a creature.)" },
    ],
  };

  it("opens on the front face and can flip to the back", async () => {
    render(<CardInspector node={twoFaced as never} edges={[]} onClose={() => {}} />);
    // The front is the default: it is the side the card is played from and the side the board draws.
    expect(screen.getByText("Legendary Artifact Creature — Robot")).toBeInTheDocument();
    expect(screen.getByText(/Your opponents can't cast spells during combat/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Megatron, Destructive Force" }));
    // The BACK's own type line, not the joined one -- once the panel describes a face, the joined
    // line names an object you are not looking at.
    expect(screen.getByText("Legendary Artifact — Vehicle")).toBeInTheDocument();
    expect(screen.getByText(/Living metal/)).toBeInTheDocument();
  });

  // Task 8: the board rims both faces of one card, and clicking the back-face circle passes the
  // BACK face's own node -- carrying `face: 1`, its index into this same `faces` array (Task 8's
  // server comment: both nodes join the same doc, so the index means the same thing on either).
  // The click already told the panel which side was meant, so it must not reopen on the front.
  it("opens on the back face when the clicked node is the back face's own node", () => {
    render(<CardInspector node={{ ...twoFaced, face: 1 } as never} edges={[]} onClose={() => {}} />);
    expect(screen.getByText("Legendary Artifact — Vehicle")).toBeInTheDocument();
    expect(screen.getByText(/Living metal/)).toBeInTheDocument();
    expect(screen.queryByText("Legendary Artifact Creature — Robot")).toBeNull();
  });

  it("shows no flip control on a single-face card", () => {
    const { faces: _dropped, ...single } = twoFaced;
    render(<CardInspector node={single as never} edges={[]} onClose={() => {}} />);
    // A control that cannot change anything is worse than no control.
    expect(screen.queryByTestId("face-flip")).toBeNull();
  });
});

/** S8. Click already opens this drawer, and S18 made that gesture load-bearing -- it is how a reader
 *  checks a synergy claim against the card's own text. So the pin is a control INSIDE the thing the
 *  click opened, rather than a second gesture on the name: one interaction, identical on touch and
 *  desktop, nothing undiscoverable. `aria-pressed` carries the state, because a screen reader gets
 *  no ring. */
describe("CardInspector pin", () => {
  const solRing = {
    id: "Sol Ring", label: "Sol Ring", copies: 1, types: ["artifact"], subtypes: [],
    supertypes: [], colors: [], cmc: 1, oracleText: "{T}: Add {C}{C}.",
  } as never as GraphNode;

  it("reads its pressed state from the prop and reports the toggle", async () => {
    const calls: number[] = [];
    const { rerender } = render(
      <CardInspector node={solRing} edges={[]} onClose={() => {}} pinned={false}
        onTogglePin={() => calls.push(1)} />,
    );
    const pin = screen.getByRole("button", { name: /pin across the report/i });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(pin);
    expect(calls).toHaveLength(1);
    rerender(
      <CardInspector node={solRing} edges={[]} onClose={() => {}} pinned
        onTogglePin={() => calls.push(1)} />,
    );
    expect(screen.getByRole("button", { name: /unpin across the report/i }))
      .toHaveAttribute("aria-pressed", "true");
  });

  /** THE PANEL IS PRESENTATIONAL BY NECESSITY, not by taste: `card-drawer.tsx` imports this module
   *  to render the drawer, so importing `usePinned` back would close an import cycle. Which makes
   *  the WIRING the thing worth testing -- a panel that renders perfectly and is handed nothing is
   *  the failure this pins. */
  it("is wired to the real pinned set when the drawer opens it", async () => {
    const graph = { nodes: [solRing], edges: [] } as never;
    function Opener() {
      const { open } = useCardDrawer();
      return <button onClick={() => open("Sol Ring")}>open it</button>;
    }
    render(<CardDrawerProvider graph={graph}><Opener /></CardDrawerProvider>);
    await userEvent.click(screen.getByText("open it"));
    await userEvent.click(screen.getByRole("button", { name: /pin across the report/i }));
    expect(screen.getByRole("button", { name: /unpin across the report/i })).toBeInTheDocument();
  });

  /** ABSENT WHERE THERE IS NOTHING TO PIN INTO -- the graph board renders this panel too, and a
   *  control that reports to nobody is worse than no control. */
  it("renders no pin control when no handler is given", () => {
    render(<CardInspector node={solRing} edges={[]} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /pin across the report/i })).toBeNull();
  });
});
