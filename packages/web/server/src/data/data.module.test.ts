import { expect, test } from "vitest";
import type { CardGraph } from "@mtg/matcher";
import { attachRolesAndArt } from "./data.module.js";

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

  const out = attachRolesAndArt(graph, docs, rolesByName, normalize);

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
  const out = attachRolesAndArt(graph, [], new Map(), normalize);
  expect(out.nodes.find((n) => n.id === "card:a")?.artCrop).toBe("https://example.com/a.jpg");
  expect(out.nodes.find((n) => n.id === "card:b")?.artCrop).toBeUndefined();
});

test("non-card node kinds never get roles even if a name collides", () => {
  const graph: CardGraph = {
    nodes: [{ id: "type:sol", kind: "type", label: "Sol" }],
    edges: [],
  };
  const out = attachRolesAndArt(graph, [], new Map([["sol", ["ramp"]]]), normalize);
  expect(out.nodes[0].roles).toBeUndefined();
});

test("a report role that cannot be joined to any doc is logged, not thrown", () => {
  const graph: CardGraph = { nodes: [{ id: "card:a", kind: "card", label: "A" }], edges: [] };
  const docs = [{ _id: "a", name: "A" }];
  const rolesByName = new Map([["nonexistent card", ["ramp"]]]);
  expect(() => attachRolesAndArt(graph, docs, rolesByName, normalize)).not.toThrow();
});
