import { afterEach, expect, test, vi } from "vitest";
import type { ProjectedGraph } from "@mtg/matcher";
import { attachRolesAndArt } from "./data.module.js";

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
    }],
    undirectedReasons: 0,
    offDeckReasons: 0,
  };
  const out = attachRolesAndArt(graph, [], new Map(), normalize);
  expect(out.edges).toEqual([{ from: "A", to: "B", weight: 1.5, tags: ["ramp"], reasonTexts: ["A ramps into B"] }]);
});

test("undirectedReasons and offDeckReasons pass straight through", () => {
  const graph = { ...emptyGraph([]), undirectedReasons: 3, offDeckReasons: 2 };
  const out = attachRolesAndArt(graph, [], new Map(), normalize);
  expect(out.undirectedReasons).toBe(3);
  expect(out.offDeckReasons).toBe(2);
});
