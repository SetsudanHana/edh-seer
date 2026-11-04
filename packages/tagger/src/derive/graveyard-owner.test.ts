/** Whose graveyard a recursion leaves (#1470). Oracle text and clause records are copied verbatim from Mongo (`cards.oracleText`, `cardClauses.canonical`, DERIVE 446). */
import { describe, expect, test } from "vitest";
import type { ClauseRecord } from "../canonicalize.js";
import { clauseTexts } from "../derive-input.js";
import { deriveAbilities } from "./derive.js";
import { graveyardOwner } from "./graveyard-owner.js";
import fixtures from "./graveyard-owner.fixtures.json" with { type: "json" };

type Fx = { typeLine: string; keywords: string[]; oracleText: string; clauses: unknown[] };
const FX = fixtures as unknown as Record<string, Fx>;

/** Every control the card's graveyard-origin emits and graveyard-recursion subjects carry. */
function graveyardControls(name: string): { emits: string[]; effects: string[] } {
  const f = FX[name]!;
  const { abilities } = deriveAbilities(f.clauses as ClauseRecord[], name, clauseTexts(f), undefined, f.oracleText);
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
  test("a pointer with no graveyard anywhere stays unread", () => {
    expect(graveyardOwner(zone("those cards"), "Return those cards to your hand.", "Return those cards to your hand.")).toBeUndefined();
  });
});
