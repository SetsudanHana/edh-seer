import { expect, test } from "vitest";
import { pairReasons, themeSubjectKey, cardThemeTags } from "./edges.js";
import { keyDenotes } from "./hierarchy.js";
import type { CardTags } from "@edh-seer/tagger";
import type { DeckCard, Hierarchy } from "./types.js";

/** #1170 PR 3: THE #543 FOLD IS ON THE KEY. The owner ruled that instants and sorceries are one group
 *  (2026-09-27); the web used to fold `cast:instant` and `cast:sorcery` into `cast:instant-sorcery` after
 *  the fact, in two places, and the headline never saw it ("instants" named six decks). `themeSubjectKey`
 *  now writes `instant-sorcery` itself, so every reader sees one key. */
test("a subject of instants, of sorceries, or of both keys as instant-sorcery", () => {
  expect(themeSubjectKey({ type: "instant" })).toBe("instant-sorcery");
  expect(themeSubjectKey({ type: "sorcery" })).toBe("instant-sorcery");
  expect(themeSubjectKey({ type: ["instant", "sorcery"] })).toBe("instant-sorcery");
  expect(themeSubjectKey({ type: ["sorcery", "instant"] })).toBe("instant-sorcery");
});

test("nothing else moves: other types, negations, umbrellas, subtypes and names key as before", () => {
  expect(themeSubjectKey({ type: "creature" })).toBe("creature");
  expect(themeSubjectKey({ type: "artifact" })).toBe("artifact");
  expect(themeSubjectKey({ notType: ["creature"], type: ["instant", "sorcery", "artifact"] })).toBe("-creature");
  expect(themeSubjectKey({ umbrella: "spell", type: ["creature", "instant"] })).toBe("spell");
  expect(themeSubjectKey({ subtype: "wizard", type: "creature" })).toBe("wizard");
  expect(themeSubjectKey({ subtype: "adventure" })).toBe("adventure");
  expect(themeSubjectKey({})).toBe("any");
});

test("the hierarchy knows what the folded key denotes, so cast:instant-sorcery still sits inside cast:-creature", () => {
  expect([...keyDenotes("instant-sorcery", "cast")!].sort()).toEqual(["instant", "sorcery"]);
  const inside = [...keyDenotes("instant-sorcery", "cast")!].every((t) => keyDenotes("-creature", "cast")!.has(t));
  expect(inside).toBe(true);
});

/** THE FOLD WIDENS A LABEL, NEVER A MATCH. A reason's tag is the name of an edge; what makes the edge is
 *  `subjectMatches` on the subject's own type list. So a recursion card that returns a SORCERY joins the
 *  sorceries and not the instants, and now says so under the one shared key. */
const H: Hierarchy = {};
const card = (name: string, abilities: CardTags["abilities"], types: string[]) => ({
  card: { name, typeLine: "", oracleText: "", keywords: [], colors: [], manaValue: 0 } as unknown as DeckCard["card"],
  tags: {
    oracleId: name, schemaVersion: 1, promptVersion: 1, model: "t",
    characteristics: { types, subtypes: [], colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [] },
    abilities,
  } as CardTags,
});

test("a sorcery-only recursion card pairs with a sorcery, not an instant, under the folded tag", () => {
  const regrowth = card("Sorcery Regrowth", [{
    kind: "on-cast",
    effect: { kind: "graveyard-recursion", subject: { control: "you", token: null, type: "sorcery", scope: "target", zone: "graveyard" } },
  }] as CardTags["abilities"], ["sorcery"]);
  const sorcery = card("Divination", [], ["sorcery"]);
  const instant = card("Counterspell", [], ["instant"]);
  const tags = (a: ReturnType<typeof card>, b: ReturnType<typeof card>) => pairReasons(a, b, H).map((r) => r.tag);
  expect(tags(regrowth, sorcery)).toContain("recursion-target:instant-sorcery");
  expect(tags(regrowth, sorcery).some((t) => t === "recursion-target:sorcery")).toBe(false);
  expect(tags(regrowth, instant).some((t) => t.startsWith("recursion-target:"))).toBe(false);
});

test("a card's own theme tags carry the one key", () => {
  const caster = card("Young Pyromancer", [{
    kind: "triggered",
    trigger: { verbs: ["cast"], subject: { control: "you", token: null, type: ["instant", "sorcery"] } },
    effect: { kind: "token-generation", subject: { control: "you", token: true, type: "creature" } },
  }] as CardTags["abilities"], ["creature"]);
  const tags = [...cardThemeTags(caster.tags)];
  expect(tags).toContain("cast:instant-sorcery");
  expect(tags).not.toContain("cast:instant");
  expect(tags).not.toContain("cast:sorcery");
});
