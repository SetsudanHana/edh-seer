import { expect, test } from "vitest";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";
import { unmetConditionTags } from "./deck-fit.js";
import { eventTagKey } from "./edges.js";

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

test("a fetch land does not die: it supplies no dies tag, so the demand stays unmet", () => {
  expect(unmetConditionTags([grinder, tarn], H).get("Tunnel-Grinder")).toEqual(["dies:permanent"]);
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["land"], true)).toBeNull();
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["creature"], true)).toBe("dies:creature");
  expect(eventTagKey({ verb: "dies", subject: { self: true } } as never, ["planeswalker"], true)).toBe("dies:planeswalker");
  expect(eventTagKey({ verb: "dies", subject: { token: true } } as never, [], true)).toBeNull();
  expect(eventTagKey({ verb: "dies", subject: { token: true } } as never, [], false)).toBe("dies:creature");
});
