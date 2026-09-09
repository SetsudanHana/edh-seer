/** WHAT THE DERIVE LAYER KNOWS ABOUT THE RULES, EXECUTABLE (roadmap AC10, 2026-09-09).
 *
 *  320 comment sites cite a CR rule and almost none was an assertion. This file is the honest list:
 *  every rule number cited anywhere in the tagger's source is either ASSERTED here on a minimal
 *  fixture, TESTED elsewhere (named), or PROSE — a reading in a comment with no fixture yet. The
 *  ledger is ratcheted against the source: a citation the ledger does not know fails, and a ledger
 *  row nothing cites any more fails, so the list cannot drift in either direction. The matcher has
 *  a twin (`packages/matcher/src/rules-invariants.test.ts`). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { deriveAbilities } from "./derive.js";
import { actionEmits } from "./emits.js";
import { actionEffectKind } from "./effect-kind.js";
import { emblemRecipient } from "../emblem.js";

const ASSERTED = new Set(["104.3", "106.12a", "111.1", "111.2", "114.1", "114.2", "601.2f", "603.8", "603.12c", "614", "701.5", "701.17a", "701.22b"]);
const TESTED: Record<string, string> = {
  "701.14a": "derive.test.ts — a fight's dealer is the fighting creature, not the spell",
  "702.162": "characteristics.test.ts — a More Than Meets the Eye card is cast from either face",
  "113.8": "derive.test.ts — \"you\" in a granted ability is the recipient's controller (Hellish Rebuke)",
  "122.1b": "subject.test.ts — every keyword counter named by rule 122.1b is in the dictionary",
  "614.1c": "derive.test.ts — entering WITH counters is 614.1c, not placing counters later",
  "701": "cr-completeness.test.ts — every CR 701 keyword action is covered by a verb or excluded",
  "702": "cr-completeness.test.ts — every CR 702 keyword ability is known",
  "703": "cr-completeness.test.ts — the CR 703/116 residue words",
  "603.2": "trigger-completeness.test.ts — every rule-defined event has a word or a verdict",
  "701.3d": "trigger-completeness.test.ts (unattached) and verb-accounting.test.ts (unattach OPEN)",
  "114": "cr-sections.test.ts — 114 stays MODELLED",
  "707": "emits.test.ts / derive.test.ts — copy is the kind `clone`, no emit (verb-accounting OPEN)",
  "701.44": "verb-accounting.test.ts — explore is OPEN, a conditional outcome emits nothing",
  "705": "verb-accounting.test.ts — flip-coin is OPEN",
  "706.1": "emits — roll-dice emits dice-rolled (706.1 defines the roll)",
  "705.1": "emits — a coin is flipped by the ability's controller; flip-coin joins CONTROLLER_DEFAULT (AC11 batch 4)",
  "706": "verb-accounting.test.ts / emits — roll-dice emits dice-rolled",
};
/** A reading in a comment, no fixture. Each carries where the reading lives. */
const PROSE: Record<string, string> = {
  "100.2a": "schema: the CR's own numbering for a rules reference", "104.2": "verb-accounting: win-game NOT AN EVENT",
  "106.11": "emits: snow mana is colourless", "106.4": "normalize-prompt / verb-accounting: mana-spent, add-mana",
  "107.14": "normalize-prompt ENERGY rule: {E} is a counter", "120": "derive: damage direction split by text",
  "122": "counters — COUNTER_KINDS", "205.3": "subtypes generated from MTGJSON", "205.3i": "subtypes: Saga", "205.3k": "subtypes: Class",
  "305": "lands", "305.1": "play a land is `play`, not `enters`", "307.5": "a sorcery's own text", "309": "dungeons: words, no room model",
  "400.1": "ZONES lists the seven", "400.7": "zone changes: the enters/leaves family", "406.2": "exile is a public zone",
  "500": "phase words", "500.7": "extra turn: NOT AN EVENT", "506.4": "removed from combat", "602": "activate, a word with no producer",
  "603.4": "intervening-if (ratcheted in intervening-if-ratchet.test.ts)", "603.6c": "leaves-the-battlefield reads its zone off the text",
  "606": "loyalty abilities", "606.3": "loyalty cost is a counter change", "608": "resolves, a word", "609.7": "effects that set a value",
  "611": "continuous effects: NOT AN EVENT verbs", "613": "layers: OPEN", "613.1f": "P/T layer", "614.17": "cant: NOT AN EVENT",
  "615": "prevent: OPEN", "615.13": "prevented, a word", "700.11": "descended", "700.12": "outlaw", "700.13": "crime", "700.14": "expend",
  "700.16": "modified", "700.4": "dies (matcher asserts it)", "700.7": "monocolored/multicolored", "700.9": "historic",
  "701.10": "exchange: OPEN", "701.12": "fight emits non-combat-damage", "701.15": "reveal: OPEN", "701.17": "sacrifice",
  "701.19": "regenerate is a shield, emits nothing", "701.20": "shuffle: OPEN", "701.22": "scry", "701.22a": "scry never touches a graveyard",
  "701.23": "search", "701.23a": "search means a search HAPPENED", "701.25": "surveil", "701.25a": "surveil's graveyard half is any number",
  "701.3": "attach: OPEN", "701.30": "clash", "701.34a": "populate", "701.36": "vote", "701.45a": "assemble excluded (Unstable)",
  "701.50": "connive", "701.54": "the Ring tempts", "701.6": "create", "701.68": "blight", "701.9": "double/triple: OPEN",
  "702.100": "evolve, a trigger word", "702.111": "exploit, a word", "702.122": "becomes-crewed", "702.131": "city-blessing",
  "702.143": "foretell", "702.147": "decayed: a temporary token", "702.179": "speed", "702.189b": "firebend", "702.25": "flanking",
  "702.26": "phasing", "708": "face-down: OPEN", "712": "double-faced", "714.2b": "Saga chapters", "717": "Attractions excluded",
  "719": "Cases: solved, a word", "720": "Omen: OPEN", "725": "monarch", "726": "initiative", "730": "mutate: OPEN",
  "903": "Commander", "903.3": "the commander designation is a deck fact (matcher asserts it)",
  "118.3b": "paying life is losing life — prompt rule",
  "113.3": "schema: the ability kinds a card can name as an OBJECT (abilityKind, AC12)",
  "707.10": "schema / effect-kind: an ability is the third copyable object, kind copy-ability (AC12; derive.test asserts Gogo)",
  "605.3b": "schema: a mana ability does not use the stack, so 'activated' as an object excludes it (AC12)", "603.8": "state triggers — prompt rule", "603.12c": "reflexive — prompt rule",
};

const SRC = fileURLToPath(new URL("..", import.meta.url));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
});
const cited = new Set(walk(SRC).flatMap((p) => [...readFileSync(p, "utf8").matchAll(/\bCR (\d{3}(?:\.\d+[a-z]?)?)/g)].map((m) => m[1]!)));

test("every CR rule the tagger cites is asserted, tested elsewhere, or marked prose — and nothing is listed that nothing cites", () => {
  const known = new Set([...ASSERTED, ...Object.keys(TESTED), ...Object.keys(PROSE)]);
  expect([...cited].filter((r) => !known.has(r)).sort(), "cited in source, missing from the ledger").toEqual([]);
  expect([...known].filter((r) => !cited.has(r)).sort(), "in the ledger, cited nowhere").toEqual([]);
  expect(cited.size).toBeGreaterThan(90);
});

const clause = (text: string, verb: string, object: string, trigger?: { event: string; subject: string; control?: string }) => ({
  clauses: [{ id: 1, abilityType: (trigger ? "triggered" : "static") as "triggered" | "static", ...(trigger ? { trigger } : {}), actions: [{ verb, object }] }],
  texts: { 1: text },
});

test("CR 111.1 vs 114.1: an emblem is not a token — the grant derives the kind `emblem` and no token event", () => {
  const c = clause("You get an emblem with \"Creatures you control get +1/+1.\"", "emblem", "an emblem with \"Creatures you control get +1/+1.\"");
  const { abilities } = deriveAbilities(c.clauses, "Elspeth", c.texts, undefined, c.texts[1]);
  expect(abilities[0]?.effect.kind).toBe("emblem");
  expect((abilities[0]?.emits ?? []).some((e) => e.verb === "create-token" || e.verb === "enters")).toBe(false);
});

test("CR 114.2: the recipient controls the emblem — you by default, an opponent only when the sentence says so", () => {
  expect(emblemRecipient("You get an emblem with \"...\"")).toBe("you");
  expect(emblemRecipient("Target opponent gets an emblem with \"...\"")).toBe("opp");
});

test("CR 111.2: a created token is its creator's — the emit's control is `you`", () => {
  // The default reads the SENTENCE (a player named earlier blocks it), so the clause text is required.
  const e = actionEmits({ verb: "create", object: "a 1/1 white Soldier creature token" }, "Create a 1/1 white Soldier creature token.");
  expect(e.map((x) => x.verb)).toContain("create-token");
  for (const x of e) expect(x.subject.control).toBe("you");
});

test("CR 701.17a: you may sacrifice only what you control — an unqualified sacrifice is the controller's", () => {
  for (const e of actionEmits({ verb: "sacrifice", object: "a creature" }, "Sacrifice a creature.")) expect(e.subject.control).toBe("you");
  // ...and a sentence that names another player keeps its wildcard, which is what Dark Deal needs.
  expect(actionEmits({ verb: "sacrifice", object: "a creature" }, "Each player sacrifices a creature.").every((e) => e.subject.control === "any")).toBe(true);
});

test("CR 701.22b: scry 0 is no scry event", () => {
  expect(actionEmits({ verb: "scry", object: "0", amount: "0" }, "")).toEqual([]);
  expect(actionEmits({ verb: "scry", object: "2", amount: "2" }, "").map((e) => e.verb)).toEqual(["scry"]);
});

test("CR 701.5: countering a spell is an event — the action emits it and `countered` watches it", () => {
  expect(actionEmits({ verb: "counter-spell", object: "target spell" }, "").map((e) => e.verb)).toEqual(["counter-spell"]);
});

test("CR 601.2f: a sentence about this spell's OWN cost is never a tax", () => {
  const text = "This spell costs {1}{W} more to cast for each target beyond the first.";
  expect(actionEffectKind({ verb: "cost-modify", object: "this spell" }, text)).not.toBe("tax");
  expect(actionEffectKind({ verb: "cost-modify", object: "creature spells your opponents cast" }, "Creature spells your opponents cast cost {1} more to cast.")).toBe("tax");
});

test("CR 614: a multiplier performs no action — Hardened Scales places no counter", () => {
  const text = "If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.";
  const c = clause(text, "add-counter", "+1/+1 counters");
  const { abilities } = deriveAbilities(c.clauses, "Hardened Scales", c.texts, undefined, text);
  expect(abilities.length).toBeGreaterThan(0);
  for (const a of abilities) expect(a.emits ?? []).toEqual([]);
});

test("CR 106.12a and 104.3: 'tapped for mana' is refused, and 'loses the game' is read as loses-game, never as lose-life", () => {
  const mana = clause("Whenever a land is tapped for mana, add an additional {G}.", "add-mana", "{G}", { event: "taps", subject: "a land", control: "any" });
  expect(deriveAbilities(mana.clauses, "Mana Reflection", mana.texts, undefined, mana.texts[1]).unknownTriggers).toContain("taps-for-mana");
  const lose = clause("Whenever a player loses the game, draw a card.", "draw", "a card", { event: "life-lost", subject: "a player", control: "any" });
  const out = deriveAbilities(lose.clauses, "Ramses", lose.texts, undefined, lose.texts[1]);
  expect(out.abilities[0]?.trigger?.verbs).toEqual(["loses-game"]);
});

test("CR 603.8 and 603.12c: a state trigger and a reflexive trigger refuse into unknownTriggers, forming no edge", () => {
  for (const [event, text] of [["state", "When you control no Islands, sacrifice this creature."], ["reflexive", "When you do, draw a card."]] as const) {
    const c = clause(text, "draw", "a card", { event, subject: "you control no Islands" });
    const out = deriveAbilities(c.clauses, "Seasinger", c.texts, undefined, text);
    expect(out.unknownTriggers).toContain(event);
    expect(out.abilities.every((a) => a.trigger === undefined)).toBe(true);
  }
});
