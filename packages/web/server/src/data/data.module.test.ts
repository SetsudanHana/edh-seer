import { afterEach, expect, test, vi } from "vitest";
import type { CardGraph } from "@mtg/matcher";
import { attachRolesAndArt } from "./data.module.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const normalize = (s: string) => s.toLowerCase();

test("a card node ends up with the roles its report card had", () => {
  const graph: CardGraph = {
    nodes: [
      { id: "card:krenko-id", kind: "card", label: "Krenko, Mob Boss", props: { cmc: 4 } },
      { id: "card:sol-ring-id", kind: "card", label: "Sol Ring", props: {} },
      { id: "subtype:goblin", kind: "subtype", label: "Goblin" },
    ],
    edges: [],
  };
  const docs = [
    { _id: "krenko-id", name: "Krenko, Mob Boss" },
    { _id: "sol-ring-id", name: "Sol Ring" },
  ];
  // report keys by name (case differs from the doc name -- normalize must bridge it), graph keys
  // by oracleId; only Sol Ring got a functional role from the report.
  const rolesByName = new Map([["sol ring", ["ramp"]]]);

  const out = attachRolesAndArt(graph, docs, rolesByName, normalize, new Map());

  const solRing = out.nodes.find((n) => n.id === "card:sol-ring-id");
  const krenko = out.nodes.find((n) => n.id === "card:krenko-id");
  expect(solRing?.roles).toEqual(["ramp"]);
  expect(krenko?.roles).toBeUndefined();
});

test("artCrop rides along from props, absent when the doc had none", () => {
  const graph: CardGraph = {
    nodes: [
      { id: "card:a", kind: "card", label: "A", props: { artCrop: "https://example.com/a.jpg" } },
      { id: "card:b", kind: "card", label: "B", props: {} },
    ],
    edges: [],
  };
  const out = attachRolesAndArt(graph, [], new Map(), normalize, new Map());
  expect(out.nodes.find((n) => n.id === "card:a")?.artCrop).toBe("https://example.com/a.jpg");
  expect(out.nodes.find((n) => n.id === "card:b")?.artCrop).toBeUndefined();
});

test("non-card node kinds never get roles even if a name collides", () => {
  const graph: CardGraph = {
    nodes: [{ id: "type:sol", kind: "type", label: "Sol" }],
    edges: [],
  };
  const out = attachRolesAndArt(graph, [], new Map([["sol", ["ramp"]]]), normalize, new Map());
  expect(out.nodes[0].roles).toBeUndefined();
});

test("a report role that cannot be joined to any doc is logged with its count, not thrown", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const graph: CardGraph = { nodes: [{ id: "card:a", kind: "card", label: "A" }], edges: [] };
  const docs = [{ _id: "a", name: "A" }];
  const rolesByName = new Map([["nonexistent card", ["ramp"]]]);

  expect(() => attachRolesAndArt(graph, docs, rolesByName, normalize, new Map())).not.toThrow();

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 card"));
});

test("a report copy count that cannot be joined to any doc is logged with its count, not thrown -- and distinguishably from a roles miss", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const graph: CardGraph = { nodes: [{ id: "card:a", kind: "card", label: "A" }], edges: [] };
  const docs = [{ _id: "a", name: "A" }];
  const copiesByName = new Map([["nonexistent card", 24]]);

  expect(() => attachRolesAndArt(graph, docs, new Map(), normalize, copiesByName)).not.toThrow();

  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("1 card"));
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("copy counts"));
  expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("roles"));
});

test("copies join through oracleId the same way roles do, and a single copy stays absent", () => {
  const graph: CardGraph = {
    nodes: [
      { id: "card:mountain-id", kind: "card", label: "Mountain", props: {} },
      { id: "card:sol-ring-id", kind: "card", label: "Sol Ring", props: {} },
    ],
    edges: [],
  };
  const docs = [
    { _id: "mountain-id", name: "Mountain" },
    { _id: "sol-ring-id", name: "Sol Ring" },
  ];
  const copiesByName = new Map([["Mountain", 24], ["Sol Ring", 1]]);

  const out = attachRolesAndArt(graph, docs, new Map(), normalize, copiesByName);

  expect(out.nodes.find((n) => n.id === "card:mountain-id")?.copies).toBe(24);
  expect(out.nodes.find((n) => n.id === "card:sol-ring-id")).not.toHaveProperty("copies");
});

test("an empty-array roles entry never becomes an empty `roles` key on the wire", () => {
  const graph: CardGraph = { nodes: [{ id: "card:a", kind: "card", label: "A" }], edges: [] };
  const docs = [{ _id: "a", name: "A" }];
  const rolesByName = new Map([["a", []]]);

  const out = attachRolesAndArt(graph, docs, rolesByName, normalize, new Map());

  expect(out.nodes[0]).not.toHaveProperty("roles");
});
