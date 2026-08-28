import { expect, test } from "vitest";
import type { GameEvent } from "@edh-seer/tagger";
import { normalizeZoneEvent, zoneEventKey } from "./zones.js";

test("enters forces battlefield, overriding any tagged source zone", () => {
  expect(normalizeZoneEvent({ verb: "enters", subject: { control: "you", token: null } }).subject.zone).toBe("battlefield");
  // Muldrotha-style erroneous source zone on an enters emit is overridden:
  expect(normalizeZoneEvent({ verb: "enters", subject: { control: "you", token: null, zone: "graveyard" } }).subject.zone).toBe("battlefield");
});

test("enters-graveyard normalizes to enters@graveyard", () => {
  const n = normalizeZoneEvent({ verb: "enters-graveyard", subject: { control: "you", token: null, type: "creature" } });
  expect(n.verb).toBe("enters");
  expect(n.subject.zone).toBe("graveyard");
  expect(n.subject.type).toBe("creature");
});

test("dies normalizes to leaves@battlefield", () => {
  const n = normalizeZoneEvent({ verb: "dies", subject: { control: "you", token: null, type: "creature" } });
  expect(n.verb).toBe("leaves");
  expect(n.subject.zone).toBe("battlefield");
});

test("non-zone verbs are unchanged", () => {
  const e: GameEvent = { verb: "mill", subject: { control: "opp", token: null } };
  expect(normalizeZoneEvent(e)).toEqual(e);
});

test("zoneEventKey keeps legacy tag spellings", () => {
  expect(zoneEventKey("enters", "battlefield", "wizard")).toBe("enters:wizard");
  expect(zoneEventKey("enters", "graveyard", "creature")).toBe("enters-graveyard:creature");
  expect(zoneEventKey("leaves", "battlefield", "creature")).toBe("dies:creature");
  expect(zoneEventKey("mill", undefined, "any")).toBe("mill:any");
});
