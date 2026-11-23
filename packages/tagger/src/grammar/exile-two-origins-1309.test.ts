/** #1309: an exile object that names the battlefield beside a graveyard is no graveyard-only exile, and a self-exile beside a graveyard sweep stays on the battlefield. Oracle text copied verbatim from the corpus (`cards.oracleText`, DERIVE 584). */
import { describe, expect, test } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "../derive/derive.js";
import { grammarClauseRecords } from "./clause-record.js";

const SAVIOR = "Training (Whenever this creature attacks with another creature with greater power, put a +1/+1 counter on this creature.)\nWhenever this creature trains, exile up to one other target creature from the battlefield or creature card from a graveyard.\nWhen this creature leaves the battlefield, put the exiled cards onto the battlefield under their owners' control.";
const GRAVESTONE = "Cards in graveyards can't be the targets of spells or abilities.\n{4}, {T}: Exile this artifact and all cards from all graveyards. Draw a card.";

function read(name: string, typeLine: string, oracleText: string, keywords: string[] = []) {
  const card = { name, typeLine, oracleText, keywords, manaCost: "{1}" };
  const g = grammarClauseRecords(card as never);
  expect(g.complete).toBe(true);
  const exiles = g.records.flatMap((r) => r.actions ?? []).filter((a) => a.verb === "exile");
  const { abilities } = deriveCardTags(deriveInputOf(card as never, "x", name, g.records, undefined, g.readings));
  const emits = abilities.flatMap((a) => a.emits ?? []);
  return { exiles, emits };
}

const AURELIA = "Flying, lifelink, ward {2}\nDisguise {X}{3}{W}\nWhen this creature is turned face up, exile up to X other target creatures from the battlefield and/or creature cards from graveyards.\nWhen this creature leaves the battlefield, return the exiled cards to their owners' hands.";

describe("an object naming two origins is one exile per origin (#1309)", () => {
  test("Savior of Ollenbock: a battlefield removal and a graveyard exile, each with its own emits", () => {
    const { exiles, emits } = read("Savior of Ollenbock", "Creature — Human Soldier", SAVIOR, ["Training"]);
    // The grammar keeps ONE action and no single zone.
    expect(exiles).toHaveLength(1);
    expect(exiles[0]!.fromZone ?? null).toBeNull();
    const exiled = emits.filter((e) => e.verb === "exiled");
    expect(exiled.map((e) => e.subject.fromZone).sort()).toEqual(["battlefield", "graveyard"]);
    const board = exiled.find((e) => e.subject.fromZone === "battlefield")!;
    expect(board.subject).toMatchObject({ type: "creature", scope: "target", control: "opp" });
    expect(emits.filter((e) => e.verb === "leaves").map((e) => e.subject.fromZone).sort()).toEqual(["battlefield", "graveyard"]);
    expect(emits.some((e) => e.verb === "leaves" && e.subject.zone === "graveyard")).toBe(true);
  });

  test("Savior's return of the exiled cards is not read as an exile from a graveyard", () => {
    const card = { name: "Savior of Ollenbock", typeLine: "Creature — Human Soldier", oracleText: SAVIOR, keywords: ["Training"], manaCost: "{1}" };
    const g = grammarClauseRecords(card as never);
    const { abilities } = deriveCardTags(deriveInputOf(card as never, "x", card.name, g.records, undefined, g.readings));
    const flicker = abilities.find((a) => a.effect.kind === "flicker")!;
    expect(flicker.emits!.map((e) => e.subject.fromZone)).toEqual(["exile"]);
  });

  test("Aurelia's Vindicator ('and/or ... from graveyards') reads the same two halves", () => {
    const { emits } = read("Aurelia's Vindicator", "Creature — Angel", AURELIA, ["Flying", "Lifelink", "Ward", "Disguise"]);
    expect(emits.filter((e) => e.verb === "exiled").map((e) => e.subject.fromZone).sort()).toEqual(["battlefield", "graveyard"]);
  });
});

describe("a self-exile beside a graveyard sweep (#1309)", () => {
  test("Silent Gravestone: the artifact leaves the battlefield, the sweep leaves graveyards", () => {
    const { exiles, emits } = read("Silent Gravestone", "Artifact", GRAVESTONE);
    expect(exiles.map((a) => [a.object, a.fromZone])).toEqual([["this artifact", "battlefield"], ["all cards from all graveyards", "graveyard"]]);
    const selfLeaves = emits.filter((e) => e.verb === "leaves" && e.subject.self === true);
    expect(selfLeaves).toHaveLength(1);
    expect(selfLeaves[0]!.subject.fromZone).toBe("battlefield");
    expect(emits.filter((e) => e.verb === "leaves" && e.subject.zone === "graveyard").every((e) => e.subject.self !== true)).toBe(true);
  });
});

describe("a graveyard exile keeps its graveyard (#1309 guards)", () => {
  test("Scavenging Ooze: 'target card from a graveyard'", () => {
    const { exiles, emits } = read("Scavenging Ooze", "Creature — Ooze", "{G}: Exile target card from a graveyard. If it was a creature card, put a +1/+1 counter on this creature and you gain 1 life.");
    expect(exiles[0]).toMatchObject({ fromZone: "graveyard" });
    expect(emits.some((e) => e.verb === "exiled" && e.subject.fromZone === "graveyard")).toBe(true);
  });
  test("Sagu Pummeler: 'Exile this card from your graveyard' is a self-exile from the graveyard", () => {
    const { exiles } = read("Sagu Pummeler", "Creature — Beast", "Reach\nRenew — {4}{G}, Exile this card from your graveyard: Put two +1/+1 counters and a reach counter on target creature. Activate only as a sorcery.", ["Reach"]);
    expect(exiles.length).toBeGreaterThan(0);
    expect(exiles.every((a) => a.fromZone === "graveyard")).toBe(true);
  });
});
