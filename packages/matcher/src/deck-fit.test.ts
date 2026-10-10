import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { unmetConditionTags } from "./deck-fit.js";
import { cardThemeTags, eventTagKey, supplyTagKeys } from "./edges.js";

const H: Hierarchy = {};
const card = (name: string, types: string[], abilities: CardTags["abilities"]): DeckCard => ({
  card: { name, typeLine: types.join(" "), oracleText: "", keywords: [], colors: [], manaValue: 0 } as never,
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  },
});

// Brass's Tunnel-Grinder: "if you descended this turn" cares about `dies:permanent` (CR 700.11).
const grinder = card("Tunnel-Grinder", ["artifact"], [{ kind: "triggered", trigger: { verbs: ["end-step"], subject: { control: "you" } }, effect: { kind: "draw-card" }, conditionCares: ["dies:permanent"] }] as never);
// Viscera Seer: sacrificing a creature is a creature dying.
const seer = card("Viscera Seer", ["creature"], [{ kind: "activated", effect: { kind: "scry" }, emits: [{ verb: "dies", subject: { type: "creature", control: "you", token: null } }] }] as never);
// Scalding Tarn: "sacrifice this land" -- a land is not a creature, so nothing dies.
const tarn = card("Scalding Tarn", ["land"], [{ kind: "activated", effect: { kind: "search" }, emits: [{ verb: "dies", subject: { self: true, control: "you", token: null } }] }] as never);

test("a creature dying meets the descend condition's permanent demand (recall v5 #179)", () => {
  expect(unmetConditionTags([grinder, seer], H).get("Tunnel-Grinder")).toBeUndefined();
});

// CR 700.11: descended = a permanent card was put into your graveyard from anywhere this turn, so
// sacrificing Scalding Tarn IS a descent (recall v5 #179). The Tarn supplies dies:land (its own type),
// which is inside the demand's dies:permanent.
test("sacrificing a fetch land meets the descend demand: it supplies dies:land, not dies:creature", () => {
  expect(unmetConditionTags([grinder, tarn], H).get("Tunnel-Grinder")).toBeUndefined();
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["land"])).toBe("dies:land");
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["creature"])).toBe("dies:creature");
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["planeswalker"])).toBe("dies:planeswalker");
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["legendary", "artifact"])).toBe("dies:artifact");
  expect(supplyTagKeys({ verb: "dies", subject: { token: true } } as never, [])).toEqual([]);
  expect(eventTagKey({ verb: "dies", subject: { token: true } } as never, [])).toBe("dies:creature");
  expect(eventTagKey({ verb: "dies", subject: { ref: "sentence" } } as never, ["instant"])).toBe("dies:creature");
});

// Warlock Class asks for a CREATURE dying: a fetch land's dies:land does not meet it.
test("a fetch land does not meet a creature-death condition", () => {
  const warlock = card("Warlock Class", ["enchantment"], [{ kind: "triggered", trigger: { verbs: ["end-step"], subject: { control: "you" } }, effect: { kind: "" }, conditionCares: ["dies:creature"] }] as never);
  expect(unmetConditionTags([warlock, tarn], H).get("Warlock Class")).toEqual(["dies:creature"]);
});

// A card with two qualifying own types (Treasure Vault: artifact land) themes under both.
test("a multi-type card's own death is one theme tag per qualifying type", () => {
  const vault = card("Treasure Vault", ["artifact", "land"], [{ kind: "triggered", trigger: { verbs: ["dies"], subject: { self: true, control: "you" } }, effect: { kind: "" } }] as never);
  const tags = cardThemeTags(vault.tags!);
  expect(tags.has("dies:artifact")).toBe(true);
  expect(tags.has("dies:land")).toBe(true);
  expect(tags.has("dies:creature")).toBe(false);
});
