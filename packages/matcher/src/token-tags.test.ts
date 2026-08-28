import { expect, test } from "vitest";
import type { Db } from "mongodb";
import { DERIVED_COLLECTION, type CardTags } from "@edh-seer/tagger";
import { loadTokenTags, synthesizeTokenTags, type TokenDocShape } from "./token-tags.js";

// Finding 3 (owner review, 2026-08-16): Task 5 only bought derived tags for the 94 tokens carrying
// oracle text. `loadTokenTags` falls back to this synthesis for every other resolvable token (a
// plain Bird, Soldier, Zombie) instead of dropping it -- the node has to exist for Task 7's
// mediation to reroute a relation onto it.

test("a vanilla token (no oracle text) synthesizes token:true characteristics and zero abilities", () => {
  const doc: TokenDocShape = {
    _id: "bird-oracle-id",
    name: "Bird",
    typeLine: "Token Creature — Bird",
    power: "1",
    toughness: "1",
    colors: ["W"],
    keywords: ["Flying"],
    printingIds: ["bird-printing-id"],
  };
  const tags = synthesizeTokenTags(doc);
  expect(tags.oracleId).toBe("bird-oracle-id");
  expect(tags.abilities).toEqual([]); // honest, not a gap -- a vanilla token has none
  expect(tags.characteristics.token).toBe(true); // NOT extractCharacteristics's hardcoded false
  expect(tags.characteristics.types).toContain("creature");
  expect(tags.characteristics.subtypes).toEqual(["bird"]);
  expect(tags.characteristics.power).toBe("1");
  expect(tags.characteristics.keywords).toEqual(["flying"]);
});

test("a land token (no subtype, e.g. a Mutavault copy) still synthesizes without throwing", () => {
  const doc: TokenDocShape = { _id: "mutavault-oracle-id", name: "Mutavault", typeLine: "Token Land", printingIds: [] };
  const tags = synthesizeTokenTags(doc);
  expect(tags.characteristics.types).toEqual(["token", "land"]);
  expect(tags.characteristics.subtypes).toEqual([]);
  expect(tags.characteristics.token).toBe(true);
});

// Minor (owner review, 2026-08-16): the two tests above cover `synthesizeTokenTags` in isolation but
// never exercise `loadTokenTags`'s own branch -- refuse vs. synthesize vs. use-the-real-row -- end to
// end. `Db` is a big interface; only `.collection(name).find(query).toArray()` is ever called, and
// always with a fixed query per collection (`{}` for `tokens`, `{isToken:true}` for the derived
// collection), so the fake below ignores the query and just serves the preset rows per name.
function fakeDb(tokens: TokenDocShape[], derived: (CardTags & { isToken?: boolean })[]): Db {
  const byName: Record<string, unknown[]> = { tokens, [DERIVED_COLLECTION]: derived };
  return { collection: (name: string) => ({ find: () => ({ toArray: async () => byName[name] ?? [] }) }) } as unknown as Db;
}

test("loadTokenTags: a printingId absent from the `tokens` collection refuses (null), never synthesizes", async () => {
  const db = fakeDb([{ _id: "bird-oracle", name: "Bird", printingIds: ["bird-printing"] }], []);
  const lookup = await loadTokenTags(db);
  expect(lookup({ name: "Ghost", typeLine: "Token Creature — Ghost", printingId: "unknown-printing" })).toBeNull();
});

test("loadTokenTags: a `tokens` row with no derived row synthesizes; one with a derived row uses it verbatim", async () => {
  const derivedRow: CardTags & { isToken?: boolean } = {
    oracleId: "wizard-oracle", schemaVersion: 1, promptVersion: 5, model: "claude",
    characteristics: {
      types: ["token", "creature"], subtypes: ["wizard"], colors: [], identity: [],
      cmc: 0, power: "1", toughness: "1", token: true, keywords: [],
    },
    abilities: [{ kind: "static", effect: { kind: "pump" } } as CardTags["abilities"][number]],
    isToken: true,
  };
  const db = fakeDb(
    [
      { _id: "bird-oracle", name: "Bird", typeLine: "Token Creature — Bird", printingIds: ["bird-printing"] },
      { _id: "wizard-oracle", name: "Wizard", typeLine: "Token Creature — Wizard", printingIds: ["wizard-printing"] },
    ],
    [derivedRow],
  );
  const lookup = await loadTokenTags(db);

  const bird = lookup({ name: "Bird", typeLine: "Token Creature — Bird", printingId: "bird-printing" });
  expect(bird).not.toBeNull();
  expect(bird!.abilities).toEqual([]); // synthesized -- Task 5 never bought a Bird
  expect(bird!.characteristics.token).toBe(true);

  const wizard = lookup({ name: "Wizard", typeLine: "Token Creature — Wizard", printingId: "wizard-printing" });
  expect(wizard).toBe(derivedRow); // the REAL bought row, not a synthesized stand-in
});
