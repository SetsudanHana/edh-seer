import { expect, test } from "vitest";
import { EFFECT_KINDS } from "@edh-seer/tagger/schema";
import { buildFacetIndex } from "./facet-index-core.js";
import type { NameIndexEntry } from "./partners-core.js";

/** THE FACET ROWS SAY WHAT THE SIGNALS SAY, and nothing the vocabulary does not know. */
const TAGS = {
  abilities: [{
    kind: "activated",
    effect: { kind: "token-generation", subject: { type: "creature", subtype: "goblin" } },
    emits: [{ verb: "create-token", subject: { type: "creature", subtype: "goblin", token: true } }],
  }],
  characteristics: { types: ["creature"], subtypes: ["goblin"], keywords: [] },
};
const cards = [
  { card: { name: "Krenko, Mob Boss", oracleText: "{T}: Create X 1/1 red Goblin creature tokens.", colorIdentity: ["R"] }, tags: TAGS },
  { card: { name: "Sol Ring", oracleText: "{T}: Add {C}{C}.", colorIdentity: [] }, tags: null },
] as never;
const index: NameIndexEntry[] = [
  { slug: "krenko-mob-boss", name: "Krenko, Mob Boss", identity: ["R"], commander: true },
  { slug: "sol-ring", name: "Sol Ring", identity: [], commander: false },
];

test("one row per index entry, with identity, commander flag, kinds and archetypes", () => {
  const rows = buildFacetIndex(cards, index);
  expect(rows.map((r) => r.s)).toEqual(["krenko-mob-boss", "sol-ring"]);
  expect(rows[0]).toMatchObject({ i: "R", c: 1, e: ["token-generation"] });
  expect(rows[0]!.t).toContain("tokens");
  expect(rows[1]).toEqual({ s: "sol-ring", i: "", c: 0, e: [], t: [], d: [] });
});

test("every effect kind a row carries is a real one", () => {
  for (const r of buildFacetIndex(cards, index)) for (const e of r.e) expect(EFFECT_KINDS).toContain(e);
});
