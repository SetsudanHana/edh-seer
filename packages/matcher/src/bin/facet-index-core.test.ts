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

/** THE ROW CARRIES THE BEST RATE PER FAMILY (spec 2026-09-04 step 3). Divination: "Draw two
 *  cards." {2}{U} (corpus, 2026-09-17). Sol Ring states no rate and carries no `r`. */
test("a rated card's row carries floor, ceiling and mana per family; an unrated one has no r", () => {
  const divination = {
    card: { name: "Divination", manaCost: "{2}{U}", oracleText: "Draw two cards.", typeLine: "Sorcery", keywords: [], colorIdentity: ["U"] },
    tags: {
      abilities: [{ kind: "on-cast", effect: { kind: "draw-card", subject: { control: "you", token: null } }, amount: "2", repeats: "once" }],
      characteristics: { types: ["sorcery"], subtypes: [], keywords: [] },
    },
  } as never;
  const rows = buildFacetIndex([...cards, divination], [...index, { slug: "divination", name: "Divination", identity: ["U"], commander: false }]);
  expect(rows[2]).toMatchObject({ s: "divination", e: ["draw-card"], r: { cards: [2, 3, 2, 3] } });
  expect(rows[1]).not.toHaveProperty("r");
});
