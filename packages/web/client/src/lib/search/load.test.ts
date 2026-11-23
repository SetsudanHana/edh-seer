import { describe, expect, test, vi } from "vitest";
import { evaluate, type Node } from "./evaluate.js";
import { coreContext } from "./from-event-query.js";
import { createSearchLoader, fieldsOf, withCatalogue } from "./load.js";
import { encodePostings } from "./postings.js";

const vocab = { types: ["creature"], subtypes: ["elf"], keywords: [] };
const rows = [{ identity: [], t: [0], s: [0] }, { identity: [], t: [0] }, { identity: [], t: [0], s: [0] }];

const catalogue = {
  formatVersion: 1, version: "v1", deriveVersion: 1,
  groups: {
    types: { file: null, fields: [{ id: "t", kind: "set" }] },
    read: { file: "read.json", fields: [{ id: "read", kind: "set" }] },
    other: { file: "other.json", fields: [{ id: "x", kind: "set" }] },
  },
  namedLists: { creature: { label: "Creature types", values: ["elf"] } },
};
const files: Record<string, unknown> = {
  "/static/manifest.json": { version: "v1", search: "s-abc" },
  "/static/v1/search/s-abc/catalogue.json": catalogue,
  "/static/v1/search/s-abc/read.json": { fields: { read: { kind: "set", values: { grammar: encodePostings([0, 2]) } } } },
  "/static/v1/search/s-abc/other.json": { fields: { x: { kind: "set", values: { y: encodePostings([1]) } } } },
};
const stub = (over: Record<string, unknown> = {}) => vi.fn(async (u: string | URL | Request) => {
  const all = { ...files, ...over };
  const url = String(u);
  return url in all && all[url] !== null
    ? ({ ok: true, json: async () => all[url] } as Response)
    : ({ ok: false, json: async () => ({}) } as Response);
});

const readQ: Node = { field: "read", op: "has", value: "grammar" };
const listQ: Node = { field: "st", op: "countIn", list: "creature", min: 1 };

describe("the search loader", () => {
  test("fieldsOf names every field in a tree, and the rows leaf has none", () => {
    expect(fieldsOf({ and: [readQ, { not: { op: "rows", rows: [1] } }, { field: "t", op: "has", value: "creature" }] }).sort()).toEqual(["read", "t"]);
  });

  test("a query on core fields fetches nothing", async () => {
    const f = stub();
    const loader = createSearchLoader("/static", f as unknown as typeof fetch);
    await withCatalogue(coreContext(rows, vocab), loader, { field: "t", op: "has", value: "creature" });
    expect(f).not.toHaveBeenCalled();
  });

  test("a group file is fetched only when a query names one of its fields", async () => {
    const f = stub();
    const loader = createSearchLoader("/static", f as unknown as typeof fetch);
    const ctx = await withCatalogue(coreContext(rows, vocab), loader, readQ);
    const urls = f.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/static/v1/search/s-abc/read.json");
    expect(urls).not.toContain("/static/v1/search/s-abc/other.json");
    expect(evaluate(readQ, ctx)).toEqual({ ok: true, rows: [0, 2] });
    // A second ask does not refetch.
    await withCatalogue(coreContext(rows, vocab), loader, readQ);
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith("read.json"))).toHaveLength(1);
  });

  test("a named list answers once the catalogue has loaded", async () => {
    const loader = createSearchLoader("/static", stub() as unknown as typeof fetch);
    const core = coreContext(rows, vocab);
    expect(evaluate(listQ, core).ok).toBe(false);
    expect(evaluate(listQ, await withCatalogue(core, loader, listQ))).toEqual({ ok: true, rows: [0, 2] });
  });

  test("a manifest with no `search` pointer leaves the question cannot-answer, never empty", async () => {
    const f = stub({ "/static/manifest.json": { version: "v1" } });
    const ctx = await withCatalogue(coreContext(rows, vocab), createSearchLoader("/static", f as unknown as typeof fetch), readQ);
    expect(evaluate(readQ, ctx).ok).toBe(false);
    expect(evaluate(listQ, ctx).ok).toBe(false);
  });

  test("a failed catalogue fetch is cannot-answer too", async () => {
    const f = stub({ "/static/v1/search/s-abc/catalogue.json": null });
    const ctx = await withCatalogue(coreContext(rows, vocab), createSearchLoader("/static", f as unknown as typeof fetch), readQ);
    expect(evaluate(readQ, ctx).ok).toBe(false);
  });
});
