import { expect, test } from "vitest";
import type { Characteristics, GameEvent } from "@mtg/tagger";
import { impliedEvents, impliedGraveyardEvents } from "./implied.js";

const chars = (types: string[], subtypes: string[] = []): Characteristics => ({
  types, subtypes, colors: [], identity: [], cmc: 0, power: null, toughness: null, token: false, keywords: [],
});

test("a nonland permanent implies both cast and enters carrying its full types+subtypes", () => {
  const ev = impliedEvents(chars(["creature"], ["human", "wizard"]));
  const cast = ev.find((e) => e.verb === "cast");
  const enters = ev.find((e) => e.verb === "enters");
  expect(cast).toBeDefined();
  expect(enters).toBeDefined();
  expect(enters!.subject.type).toBe("creature");
  expect(enters!.subject.subtype).toEqual(["human", "wizard"]);
  expect(enters!.subject.token).toBe(false);
  expect(enters!.subject.control).toBe("you");
  expect(cast!.subject.subtype).toEqual(["human", "wizard"]);
});

test("an instant/sorcery implies cast only (no enters)", () => {
  const ev = impliedEvents(chars(["instant"]));
  expect(ev.map((e) => e.verb)).toEqual(["cast"]);
  expect(ev[0].subject.type).toBe("instant");
});

test("a land implies enters only (landfall), never cast", () => {
  const ev = impliedEvents(chars(["land"], ["island"]));
  expect(ev.map((e) => e.verb)).toEqual(["enters"]);
  expect(ev[0].subject.type).toBe("land");
  expect(ev[0].subject.token).toBe(false);
});

test("a single subtype collapses to a bare string (matches SubjectFilter convention)", () => {
  const ev = impliedEvents(chars(["artifact"], ["equipment"]));
  const enters = ev.find((e) => e.verb === "enters")!;
  expect(enters.subject.subtype).toBe("equipment");
});

test("mill and discard imply an untyped enters@graveyard", () => {
  const emits: GameEvent[] = [
    { verb: "mill", subject: { control: "opp", token: null } },
    { verb: "discard", subject: { control: "you", token: null } },
  ];
  const out = impliedGraveyardEvents(emits);
  expect(out).toHaveLength(2);
  expect(out.every((e) => e.verb === "enters" && e.subject.zone === "graveyard")).toBe(true);
  expect(out[0].subject.type).toBeUndefined();
});

test("a nontoken leaves@battlefield (a dies) implies a typed enters@graveyard; a token does not", () => {
  const emits: GameEvent[] = [
    { verb: "leaves", subject: { control: "you", token: false, zone: "battlefield", type: "creature" } },
    { verb: "leaves", subject: { control: "you", token: true, zone: "battlefield" } },
  ];
  const out = impliedGraveyardEvents(emits);
  expect(out).toHaveLength(1);
  expect(out[0]).toEqual({ verb: "enters", subject: { control: "you", token: false, zone: "graveyard", type: "creature" } });
});

test("mill/discard do NOT imply a leaves (Blood Artist must stay unfed)", () => {
  const emits: GameEvent[] = [{ verb: "mill", subject: { control: "opp", token: null } }];
  const out = impliedGraveyardEvents(emits);
  expect(out.some((e) => e.verb === "leaves")).toBe(false);
});
