import { afterEach, expect, test, vi } from "vitest";
import type { ProjectedGraph } from "./graph-projection.js";
import { attachRolesAndArt } from "./wire-graph.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const normalize = (s: string) => s.toLowerCase();

const node = (over: Partial<ProjectedGraph["nodes"][number]> = {}): ProjectedGraph["nodes"][number] => ({
  id: "Sol Ring", label: "Sol Ring", copies: 1,
  types: ["artifact"], subtypes: [], supertypes: [], colors: [], cmc: 1,
  ...over,
});

const emptyGraph = (nodes: ProjectedGraph["nodes"]): ProjectedGraph => ({
  nodes, edges: [], undirectedReasons: 0, offDeckReasons: 0,
});

test("joins roles and art onto a projected card node", () => {
  const graph = emptyGraph([node({ id: "Sol Ring", label: "Sol Ring", copies: 1 })]);
  const docs = [{ _id: "x", name: "Sol Ring", imageUris: { art_crop: "http://art/sol" } }];
  const rolesByName = new Map([["sol ring", ["ramp"]]]);

  const out = attachRolesAndArt(graph, docs, rolesByName, normalize);

  expect(out.nodes[0]).toMatchObject({ roles: ["ramp"], artCrop: "http://art/sol" });
});

test("a card node ends up with the roles its report card had -- report keys by name, projection keys by name, normalize bridges casing", () => {
  const graph = emptyGraph([
    node({ id: "Krenko, Mob Boss", label: "Krenko, Mob Boss", cmc: 4 }),
    node({ id: "Sol Ring", label: "Sol Ring" }),
  ]);
  const docs = [
    { _id: "krenko-id", name: "Krenko, Mob Boss" },
    { _id: "sol-ring-id", name: "Sol Ring" },
  ];
  const rolesByName = new Map([["sol ring", ["ramp"]]]);

  const out = attachRolesAndArt(graph, docs, rolesByName, normalize);

  const solRing = out.nodes.find((n) => n.id === "Sol Ring");
  const krenko = out.nodes.find((n) => n.id === "Krenko, Mob Boss");
  expect(solRing?.roles).toEqual(["ramp"]);
  expect(krenko?.roles).toBeUndefined();
});

test("artCrop rides along from the doc, absent when the doc had none", () => {
  const graph = emptyGraph([node({ id: "A", label: "A" }), node({ id: "B", label: "B" })]);
  const docs = [
    { _id: "a", name: "A", artCrop: "https://example.com/a.jpg" },
    { _id: "b", name: "B" },
  ];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  expect(out.nodes.find((n) => n.id === "A")?.artCrop).toBe("https://example.com/a.jpg");
  expect(out.nodes.find((n) => n.id === "B")?.artCrop).toBeUndefined();
});

// A GENUINELY TWO-FACED CARD HAS NO CARD-LEVEL ART. Scryfall puts `image_uris` on each FACE for
// transform and modal_dfc layouts and omits the top-level one, so 861 corpus cards are double-faced
// and only 370 (43%) carry a card-level artCrop -- Westvale Abbey // Ormendahl has none, and two at
// face level. Owner-reported: "the double faced cards do not show images right now".
test("a two-faced card falls back to its FRONT face's art", () => {
  const graph = emptyGraph([node({ id: "Westvale Abbey // Ormendahl, Profane Prince", label: "Westvale Abbey" })]);
  const docs = [{
    _id: "w",
    name: "Westvale Abbey // Ormendahl, Profane Prince",
    faces: [
      { name: "Westvale Abbey", artCrop: "https://example.com/front.jpg" },
      { name: "Ormendahl, Profane Prince", artCrop: "https://example.com/back.jpg" },
    ],
  }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  // The FRONT face: it is the side the card is played from and the side the board draws.
  expect(out.nodes[0]?.artCrop).toBe("https://example.com/front.jpg");
});

// Adventure, split and flip cards are ONE physical face, so they keep a card-level artCrop and the
// faces array carries none. The card level must still win where both could apply.
test("a card-level artCrop wins over a face's", () => {
  const graph = emptyGraph([node({ id: "A", label: "A" })]);
  const docs = [{
    _id: "a", name: "A", artCrop: "https://example.com/card.jpg",
    faces: [{ name: "A", artCrop: "https://example.com/face.jpg" }],
  }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  expect(out.nodes[0]?.artCrop).toBe("https://example.com/card.jpg");
});

test("a report role that cannot be joined to any graph node is logged with its count, not thrown", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const graph = emptyGraph([node({ id: "A", label: "A" })]);
  const docs = [{ _id: "a", name: "A" }];
  const rolesByName = new Map([["nonexistent card", ["ramp"]]]);

  expect(() => attachRolesAndArt(graph, docs, rolesByName, normalize)).not.toThrow();

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 card"));
});

test("an empty-array roles entry never becomes an empty `roles` key on the wire", () => {
  const graph = emptyGraph([node({ id: "A", label: "A" })]);
  const docs = [{ _id: "a", name: "A" }];
  const rolesByName = new Map([["a", []]]);

  const out = attachRolesAndArt(graph, docs, rolesByName, normalize);

  expect(out.nodes[0]).not.toHaveProperty("roles");
});

test("copies passes straight through from the projected node, untouched", () => {
  const graph = emptyGraph([node({ id: "Mountain", label: "Mountain", copies: 24 })]);
  const docs = [{ _id: "o-island", name: "Mountain" }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  expect(out.nodes[0].copies).toBe(24);
});

test("a basic land carries the lands role even though the engine gives it none", () => {
  const graph = emptyGraph([node({ id: "Island", label: "Island" })]);
  const out = attachRolesAndArt(
    graph,
    [{ _id: "o-island", name: "Island", typeLine: "Basic Land — Island" }],
    new Map(),
    normalize,
  );
  expect(out.nodes[0].roles).toEqual(["lands"]);
});

test("a utility land keeps its functional roles and gains lands", () => {
  const graph = emptyGraph([node({ id: "Otawara, Soaring City", label: "Otawara, Soaring City" })]);
  const out = attachRolesAndArt(
    graph,
    [{ _id: "o-otawara", name: "Otawara, Soaring City", typeLine: "Legendary Land" }],
    new Map([["Otawara, Soaring City", ["targetedRemoval"]]]),
    normalize,
  );
  expect(out.nodes[0].roles).toEqual(["targetedRemoval", "lands"]);
});

test("does not duplicate lands when the engine already assigned it", () => {
  const graph = emptyGraph([node({ id: "Command Tower", label: "Command Tower" })]);
  const out = attachRolesAndArt(
    graph,
    [{ _id: "o-tower", name: "Command Tower", typeLine: "Land" }],
    new Map([["Command Tower", ["lands"]]]),
    normalize,
  );
  expect(out.nodes[0].roles).toEqual(["lands"]);
});

test("a nonland is untouched", () => {
  const graph = emptyGraph([node({ id: "Sol Ring", label: "Sol Ring" })]);
  const out = attachRolesAndArt(
    graph,
    [{ _id: "o-solring", name: "Sol Ring", typeLine: "Artifact" }],
    new Map([["Sol Ring", ["ramp"]]]),
    normalize,
  );
  expect(out.nodes[0].roles).toEqual(["ramp"]);
});

test("edges are serialized to the wire shape: reasons collapse to their text", () => {
  const graph: ProjectedGraph = {
    nodes: [node({ id: "A", label: "A" }), node({ id: "B", label: "B" })],
    edges: [{
      from: "A", to: "B", weight: 1.5, tags: ["ramp"],
      reasons: [{ tag: "ramp", text: "A ramps into B" } as never],
      drawn: true,
    }],
    undirectedReasons: 0,
    offDeckReasons: 0,
  };
  const out = attachRolesAndArt(graph, [], new Map(), normalize);
  expect(out.edges).toEqual([{ from: "A", to: "B", weight: 1.5, tags: ["ramp"], reasonTexts: ["A ramps into B"], drawn: true }]);
});

test("undirectedReasons and offDeckReasons pass straight through", () => {
  const graph = { ...emptyGraph([]), undirectedReasons: 3, offDeckReasons: 2 };
  const out = attachRolesAndArt(graph, [], new Map(), normalize);
  expect(out.undirectedReasons).toBe(3);
  expect(out.offDeckReasons).toBe(2);
});

// A TOKEN JOINS NO CORPUS ROW, so its art can only come from the `tokens` collection, handed in by
// node id. Keyed on the id and not the label because 92 of the corpus's 661 token names are also a
// real card: a name key would paint the Treasure token with the art of a card called Treasure.
test("a token node takes its art from the token map, never from a same-named card doc", () => {
  const graph = emptyGraph([
    node({ id: "token:Treasure", label: "Treasure", isToken: true, types: ["token", "artifact"] }),
    node({ id: "Treasure", label: "Treasure" }),
  ]);
  const docs = [{ _id: "card", name: "Treasure", artCrop: "https://example.com/card.jpg" }];
  const tokenArt = new Map([["token:Treasure", "https://example.com/token.jpg"]]);

  const out = attachRolesAndArt(graph, docs, new Map(), normalize, tokenArt);

  expect(out.nodes.find((n) => n.id === "token:Treasure")?.artCrop).toBe("https://example.com/token.jpg");
  expect(out.nodes.find((n) => n.id === "Treasure")?.artCrop).toBe("https://example.com/card.jpg");
});

test("a token with no art row keeps the blank disc rather than borrowing a card's", () => {
  const graph = emptyGraph([node({ id: "token:Bird", label: "Bird", isToken: true })]);
  const docs = [{ _id: "b", name: "Bird", artCrop: "https://example.com/bird-card.jpg" }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize, new Map());

  expect(out.nodes[0]?.artCrop).toBeUndefined();
});

// ONE TRIGGER WITH A CHAIN OF EFFECTS IS ONE SENTENCE TO A READER. Six reasons identical in text
// and differing only in `effectKind` printed the same line six times in the inspector -- seen live on
// a token panel. The reason OBJECTS must survive (archetype detection reads their kinds), so the
// collapse happens here, on the wire.
test("identical reason sentences are collapsed on the wire, however many effect kinds derived them", () => {
  const graph = {
    ...emptyGraph([node({ id: "A", label: "A" }), node({ id: "B", label: "B" })]),
    edges: [{
      from: "A", to: "B", weight: 1, tags: ["enters:creature"],
      reasons: [
        { tag: "enters:creature", text: "A triggers on entry; B supplies it", effectKind: "drain" },
        { tag: "enters:creature", text: "A triggers on entry; B supplies it", effectKind: "draw-card" },
        { tag: "enters:creature", text: "A triggers on entry; B supplies it", effectKind: "" },
        { tag: "enters:creature", text: "B fills the graveyard, enabling A's recursion", effectKind: "graveyard-recursion" },
      ],
    }],
  } as unknown as ProjectedGraph;

  const out = attachRolesAndArt(graph, [{ _id: "a", name: "A" }, { _id: "b", name: "B" }], new Map(), normalize);

  expect(out.edges[0]?.reasonTexts).toEqual([
    "A triggers on entry; B supplies it",
    "B fills the graveyard, enabling A's recursion",
  ]);
});

/** THE JOIN DROPS ANY FIELD IT DOES NOT NAME, and has now done so five times (`producedMana`,
 *  `allParts`, `gameChanger`, `faces`, and this one). Every unit test passed on fixtures carrying
 *  `typeLine` while a live run read it as undefined on 103 of 103 nodes, because the projection's
 *  field never survived this rebuild. */
test("the printed type line survives the wire join", () => {
  const graph = {
    nodes: [
      { id: "Megatron", label: "Megatron", copies: 1, types: ["artifact", "creature"],
        subtypes: ["robot", "vehicle"], supertypes: ["legendary"],
        typeLine: "Legendary Artifact Creature — Robot // Legendary Artifact Creature — Robot Vehicle",
        colors: ["B"], cmc: 6 },
      // A token joins no doc, so the projection's copy is the only source it can have.
      { id: "token:Treasure", label: "Treasure", isToken: true as const, copies: 1,
        types: ["artifact"], subtypes: ["treasure"], supertypes: [],
        typeLine: "Token Artifact — Treasure", colors: [], cmc: 0 },
    ],
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  };
  const out = attachRolesAndArt(graph as never, [], new Map(), (n: string) => n.toLowerCase());
  expect(out.nodes[0].typeLine).toBe(graph.nodes[0].typeLine);
  expect(out.nodes[1].typeLine).toBe("Token Artifact — Treasure");
});

/** AND THE FACES, for the same reason and through the same join that has now eaten seven fields.
 *  A double-faced card's panel drew only its front; the corpus carries every face's name, type
 *  line, cost, text and art, and none of it reached the client until it was named here. */
test("every printed face survives the wire join, and only when there is more than one", () => {
  const graph = {
    nodes: [
      { id: "Megatron", label: "Megatron", copies: 1, types: ["artifact", "creature"],
        subtypes: ["robot", "vehicle"], supertypes: ["legendary"], colors: ["B"], cmc: 6 },
      { id: "Sol Ring", label: "Sol Ring", copies: 1, types: ["artifact"],
        subtypes: [], supertypes: [], colors: [], cmc: 1 },
    ],
    edges: [], undirectedReasons: 0, offDeckReasons: 0,
  };
  const docs = [
    { _id: "m", name: "Megatron", faces: [
      { name: "Megatron, Tyrant", typeLine: "Legendary Artifact Creature — Robot", artCrop: "http://a" },
      { name: "Megatron, Destructive Force", typeLine: "Legendary Artifact — Vehicle", artCrop: "http://b" },
    ] },
    { _id: "s", name: "Sol Ring" },
  ];
  const out = attachRolesAndArt(graph as never, docs as never, new Map(), (n: string) => n.toLowerCase());
  const meg = out.nodes.find((n) => n.id === "Megatron");
  expect(meg?.faces).toHaveLength(2);
  expect(meg?.faces?.[1].name).toBe("Megatron, Destructive Force");
  // A single-face card carries none: an array of one is a flip control that does nothing.
  expect(out.nodes.find((n) => n.id === "Sol Ring")?.faces).toBeUndefined();
});

// A FACE NODE MUST NOT WEAR THE FRONT FACE'S PICTURE. Task 5 gives a back face its own node, id
// `face:<n>:<name>`, `cardName` set to the physical card. The board draws two circles for one card;
// if both take the card-level (front) art the flip is invisible and the two read as duplicates.
test("a back-face node takes its own face's art, type line and oracle text", () => {
  const graph = emptyGraph([
    node({ id: "face:1:A // B", label: "B", face: 1, cardName: "A // B" }),
  ]);
  const docs = [{
    _id: "1", name: "A // B", typeLine: "Artifact // Land", artCrop: "front.jpg",
    faces: [
      { name: "A", typeLine: "Artifact", oracleText: "front text", artCrop: "front.jpg" },
      { name: "B", typeLine: "Land", oracleText: "back text", artCrop: "back.jpg" },
    ],
  }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  expect(out.nodes[0]?.artCrop).toBe("back.jpg");
  expect(out.nodes[0]?.typeLine).toBe("Land");
  expect(out.nodes[0]?.oracleText).toBe("back text");
});

// THE LANDS ROOM READS THE FACE, NOT THE CARD. Review fix, 2026-08-27: this asked the PHYSICAL
// doc's type line, which is "Instant // Land" for BOTH faces of a modal DFC -- so the Instant face
// rendered its own type line as "Instant" and simultaneously carried the `lands` role, one node
// contradicting itself. A face's roles must describe the face the board is drawing.
test("only the land face of a modal DFC is filed in the lands room", () => {
  const graph = emptyGraph([
    node({ id: "A // B", label: "A", cardName: "A // B", typeLine: "Instant" }),
    node({ id: "face:1:A // B", label: "B", face: 1, cardName: "A // B", typeLine: "Land" }),
  ]);
  const docs = [{
    _id: "1", name: "A // B", typeLine: "Instant // Land",
    faces: [{ name: "A", typeLine: "Instant" }, { name: "B", typeLine: "Land" }],
  }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  expect(out.nodes.find((n) => n.id === "A // B")?.roles).toBeUndefined();
  expect(out.nodes.find((n) => n.id === "face:1:A // B")?.roles).toEqual(["lands"]);
});

// A face with no `faces` entry on the doc (a stale, unrefreshed row) falls back to the card level
// rather than rendering nothing -- a fallback beats a blank disc.
test("a face index with no matching doc.faces entry falls back to the card-level art and type line", () => {
  const graph = emptyGraph([
    node({ id: "face:1:A // B", label: "B", face: 1, cardName: "A // B" }),
  ]);
  const docs = [{ _id: "1", name: "A // B", typeLine: "Artifact // Land", artCrop: "card.jpg" }];

  const out = attachRolesAndArt(graph, docs, new Map(), normalize);

  expect(out.nodes[0]?.artCrop).toBe("card.jpg");
  expect(out.nodes[0]?.typeLine).toBe("Artifact // Land");
});
