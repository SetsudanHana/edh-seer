/** Whose graveyard a recursion leaves (#1470). Oracle text and clause records are copied verbatim from Mongo (`cards.oracleText`, `cardClauses.canonical`, DERIVE 446). */
import { describe, expect, test } from "vitest";
import type { ClauseRecord } from "../canonicalize.js";
import { clauseGrants, clauseTexts } from "../derive-input.js";
import { deriveAbilities, deriveCardTags } from "./derive.js";
import { graveyardOwner, selfGraveyardOwner } from "./graveyard-owner.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveInputOf } from "../derive-input.js";
import fixtures from "./graveyard-owner.fixtures.json" with { type: "json" };

type Fx = { typeLine: string; keywords: string[]; oracleText: string; clauses: unknown[] };
const FX = fixtures as unknown as Record<string, Fx>;

/** Every control the card's graveyard-origin emits and graveyard-recursion subjects carry. */
function graveyardControls(name: string): { emits: string[]; effects: string[] } {
  const f = FX[name]!;
  const { abilities } = deriveAbilities(f.clauses as ClauseRecord[], name, clauseTexts(f), undefined, f.oracleText, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clauseGrants(f));
  const emits = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.subject.zone === "graveyard" || e.subject.fromZone === "graveyard").map((e) => e.subject.control ?? "?");
  const effects = abilities.filter((a) => a.effect.kind === "graveyard-recursion").map((a) => a.effect.subject?.control ?? "?");
  return { emits, effects };
}

describe("a recursion from your graveyard carries control you", () => {
  test("Song of Inspiration: 'those cards' points at 'target permanent cards in your graveyard'", () => {
    const r = graveyardControls("Song of Inspiration");
    expect(r.emits.length).toBeGreaterThan(0);
    expect(r.emits.every((c) => c === "you")).toBe(true);
    expect(r.effects.every((c) => c === "you")).toBe(true);
  });
  test("Once and Future: the Adamant clause's 'those cards' is still your graveyard", () => {
    const r = graveyardControls("Once and Future");
    expect(r.emits.length).toBeGreaterThanOrEqual(3);
    expect(r.emits.every((c) => c === "you")).toBe(true);
    expect(r.effects.every((c) => c === "you")).toBe(true);
  });
  test("Phyrexian Grimoire: the opponent CHOOSES, the graveyard is yours; never opp", () => {
    const r = graveyardControls("Phyrexian Grimoire");
    expect(r.emits.length).toBeGreaterThan(0);
    expect(r.emits.every((c) => c === "you")).toBe(true);
    expect(r.effects.every((c) => c === "you")).toBe(true);
  });
  test("Swift Warkite: 'from your hand or graveyard' makes the graveyard branch yours", () => {
    const r = graveyardControls("Swift Warkite");
    expect(r.emits).toContain("you");
    expect(r.emits).not.toContain("any");
    expect(r.effects.every((c) => c === "you")).toBe(true);
  });
  test("Rakshasa Debaser: defending player's graveyard is never read as yours", () => {
    const r = graveyardControls("Rakshasa Debaser");
    expect(r.emits).not.toContain("you");
  });
});

describe("a granted ability's pointer is not your graveyard (Kaya the Inexorable)", () => {
  test("the ghostform return sits on any creature, an opponent's included: its emits are never you, though the emblem prints 'from your graveyard'", () => {
    const f = FX["Kaya the Inexorable"]!;
    const { abilities } = deriveAbilities(f.clauses as ClauseRecord[], "Kaya the Inexorable", clauseTexts(f), undefined, f.oracleText, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clauseGrants(f));
    const granted = abilities.filter((a) => a.clause === 2).flatMap((a) => a.emits ?? []).filter((e) => e.subject.zone === "graveyard");
    expect(granted.length).toBeGreaterThan(0);
    expect(granted.map((e) => e.subject.control)).not.toContain("you");
  });
});

describe("graveyardOwner reads only a printed 'your graveyard'", () => {
  const zone = (object: string) => ({ object, fromZone: "graveyard" });
  test("an opponent's or any graveyard is not yours", () => {
    expect(graveyardOwner(zone("target card from an opponent's graveyard"), "Exile target card from an opponent's graveyard.", "Exile target card from an opponent's graveyard.")).toBeUndefined();
    expect(graveyardOwner(zone("target card from a graveyard"), "Exile target card from a graveyard.", "Exile target card from a graveyard.")).toBeUndefined();
  });
  test("one object naming an opponent's graveyard and yours is unreadable (Dawnbreak Reclaimer)", () => {
    const o = "a creature card from an opponent's graveyard and a creature card from your graveyard";
    expect(graveyardOwner(zone(o), `Return ${o} to the battlefield.`, `Return ${o} to the battlefield.`)).toBeUndefined();
  });
  test("a pointer on a card naming two players' graveyards stays unread", () => {
    const t = "Choose a creature card in an opponent's graveyard, then that player chooses a creature card in your graveyard. Return those cards to the battlefield.";
    expect(graveyardOwner(zone("those cards"), t, t)).toBeUndefined();
  });
  test("a pointer does not borrow your graveyard from a quoted ability", () => {
    const t = 'It gains "When this creature dies, return it to its owner\'s hand." You get an emblem with "you may cast a spell from your graveyard."';
    expect(graveyardOwner(zone("it"), "return it to its owner's hand", t)).toBeUndefined();
    expect(graveyardOwner(zone("those cards"), "Return those cards to your hand.", "Choose two target cards in your graveyard. Return those cards to your hand.", true)).toBeUndefined();
  });
  test("a pointer with no graveyard anywhere stays unread", () => {
    expect(graveyardOwner(zone("those cards"), "Return those cards to your hand.", "Return those cards to your hand.")).toBeUndefined();
  });
});

/** A card that moves ITSELF out of a graveyard leaves its owner's, which is yours (#1496). Reassembling Skeleton is read by the grammar (Mongo clauseSource: grammar, 2026-11-04); the others by the model. */
describe("a self graveyard leave carries control you (#1496)", () => {
  const selfLeaves = (abilities: ReturnType<typeof deriveAbilities>["abilities"]) =>
    abilities.flatMap((a) => a.emits ?? []).filter((e) => (e.subject.zone === "graveyard" || e.subject.fromZone === "graveyard") && e.subject.self === true);
  test("Reassembling Skeleton (grammar): leaves and enters are yours", () => {
    const card = { name: "Reassembling Skeleton", typeLine: "Creature — Skeleton Warrior", oracleText: "{1}{B}: Return this card from your graveyard to the battlefield tapped.", keywords: [] as string[] };
    const g = grammarClauseRecords(card);
    expect(g.complete).toBe(true);
    const mine = selfLeaves(deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings)).abilities);
    expect(mine.map((e) => e.verb).sort()).toEqual(["enters", "leaves"]);
    expect(mine.map((e) => e.subject.control)).toEqual(["you", "you"]);
  });
  test.each(["Scavenged Brawler", "Wave of Rats"])("%s (model): every self graveyard emit is yours", (name) => {
    const f = FX[name]!;
    const { abilities } = deriveAbilities(f.clauses as ClauseRecord[], name, clauseTexts(f), undefined, f.oracleText, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clauseGrants(f));
    const mine = selfLeaves(abilities);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.map((e) => e.subject.control)).not.toContain("any");
  });
  /** Naya Charm and Silent Gravestone are stored as clauseSource: grammar (Mongo, 2026-11-04): derived through the grammar's own records, as derive-corpus does. */
  const viaGrammar = (name: string) => {
    const f = FX[name]!;
    const card = { name, typeLine: f.typeLine, oracleText: f.oracleText, keywords: f.keywords };
    const g = grammarClauseRecords(card);
    expect(g.complete, `${name} is read completely`).toBe(true);
    return deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings)).abilities;
  };
  test("kept: a non-self 'return target card from a graveyard' stays any (Naya Charm, grammar)", () => {
    const other = viaGrammar("Naya Charm").flatMap((a) => a.emits ?? []).filter((e) => e.subject.fromZone === "graveyard" && e.subject.self !== true);
    expect(other.length).toBeGreaterThan(0);
    expect(other.map((e) => e.subject.control)).toEqual(other.map(() => "any"));
  });
  test("Silent Gravestone (grammar): 'this artifact' is exiled from the battlefield, not from a graveyard; the sweep of all graveyards stays any", () => {
    const abilities = viaGrammar("Silent Gravestone");
    expect(selfLeaves(abilities)).toEqual([]);
    const sweep = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.subject.fromZone === "graveyard");
    expect(sweep.length).toBeGreaterThan(0);
    expect(sweep.map((e) => e.subject.control)).not.toContain("you");
  });
  test("selfGraveyardOwner: yours unless the object names another graveyard", () => {
    expect(selfGraveyardOwner({ object: "this card" })).toBe("you");
    expect(selfGraveyardOwner({ object: "this artifact and all cards from all graveyards" })).toBeUndefined();
  });
  const derived = (name: string) => {
    const f = FX[name]!;
    return deriveAbilities(f.clauses as ClauseRecord[], name, clauseTexts(f), undefined, f.oracleText, undefined, undefined, undefined, undefined, undefined, undefined, undefined, clauseGrants(f)).abilities;
  };
  test.each(["Plague Reaver", "Traveling Plague"])("kept: %s hands the card to another player: its self `enters` stays any, its graveyard leave is yours (model)", (name) => {
    const mine = selfLeaves(derived(name));
    expect(mine.filter((e) => e.verb === "enters").map((e) => e.subject.control)).toEqual(["any"]);
    expect(mine.filter((e) => e.verb === "leaves").map((e) => e.subject.control)).not.toContain("any");
  });
  test.each(["Necrotic Plague", "Takklemaggot"])("%s returns itself under its own controller's control: `enters` and `leaves` are yours (model)", (name) => {
    const mine = selfLeaves(derived(name));
    expect(mine.filter((e) => e.verb === "enters").length).toBeGreaterThan(0);
    expect(mine.map((e) => e.subject.control)).not.toContain("any");
  });
});
