import { describe, expect, it } from "vitest";
import { classifyReport, compactRow, formatClassified, type ImpactJson } from "./loss-classify-core.js";

const trig = (verbs: string[], subject: Record<string, unknown>) => ({ kind: "triggered", trigger: { verbs, subject } });
const SELF = trig(["damaged"], { control: "you", type: "creature", self: true });
const CLASS = trig(["damaged"], { control: "opp", type: "creature" });
const PERM = trig(["damaged"], { control: "you", type: "permanent" });
const DEALS = trig(["non-combat-damage"], { control: "you", type: "creature", self: true });

const key = (tag: string, p: string, c: string) => `${tag}|${p}|${c}`;
const fixture = (): ImpactJson => ({
  pairDetail: [{
    id: "x", name: "Fighter",
    lost: [
      key("damaged:creature", "Fighter", "SelfCard"),   // counterpart hears it with a SELF trigger
      key("damaged:creature", "Fighter", "ClassCard"),  // with a CLASS trigger (read at BASE)
      key("damaged:creature", "Fighter", "NoTrigger"),  // no matching trigger at all
      key("damaged:creature", "Maker", "Fighter"),      // the counterpart is the producer
      key("damaged:creature [via token]", "Fighter", "ClassCard"), // token path
      key("damaged:creature", "Fighter", "Ghost"),      // no row in the file
    ],
    gained: [
      key("damaged:creature", "Fighter", "SelfCard"),   // gained into a self trigger: probable false edge
      key("damaged:creature", "Fighter", "ClassCard"),
    ],
  }],
  rows: {
    SelfCard: { base: [SELF], head: [SELF] },
    // class at BASE, self at HEAD: a LOST pair reads the BASE row, a GAINED one the HEAD row
    ClassCard: { base: [CLASS], head: [SELF] },
    NoTrigger: { base: [{ kind: "static" }], head: [{ kind: "static" }] },
    Maker: { base: [], head: [] },
  },
});

describe("classifyReport", () => {
  const r = classifyReport(fixture());
  const c = r.cards[0]!;
  it("counts lost pairs per class", () => {
    expect(c.lost).toEqual({ self: 1, class: 1, other: 2, ambiguous: 0, unmatched: 1, noRow: 1 });
  });
  it("counts gained pairs per class, reading the HEAD row", () => {
    expect(c.gained).toEqual({ self: 2, class: 0, other: 0, ambiguous: 0, unmatched: 0, noRow: 0 });
  });
  it("lists the class-trigger counterparts with their filter", () => {
    expect(c.classList).toEqual([{ dir: "lost", counterpart: "ClassCard", family: "damaged", filter: "control=opp type=creature" }]);
  });
  it("flags LOST->CLASS and GAINED->SELF", () => {
    expect(c.lostToClass).toEqual(["ClassCard"]);
    expect(c.gainedToSelf).toEqual(["SelfCard", "ClassCard"]);
  });
  it("prints both flags and a one-line summary", () => {
    const out = formatClassified(r);
    expect(out).toContain("LOST->CLASS");
    expect(out).toContain("GAINED->SELF");
    expect(out).toMatch(/summary: 1 card\(s\); lost 6 \(self 1, class 1, other 2, ambiguous 0, unmatched 1, no row 1\); gained 2 \(self 2, class 0, other 0, ambiguous 0, unmatched 0\)/);
  });
  it("warns, per family, about a consumer with no trigger for the tag (never 'other')", () => {
    const out = formatClassified(r);
    expect(out).toContain("WARNING: 1 pair(s) into a consumer with no trigger matching the tag: damaged 1");
  });
  it("restricts to one card", () => {
    expect(classifyReport(fixture(), "Nobody").cards).toEqual([]);
    expect(classifyReport(fixture(), "Fighter").cards).toHaveLength(1);
  });
  it("a class trigger wins over a self trigger on the same counterpart", () => {
    const j = fixture();
    j.rows!.Both = { base: [SELF, CLASS], head: [SELF, CLASS] };
    j.pairDetail[0]!.lost = [key("damaged:creature", "Fighter", "Both")];
    j.pairDetail[0]!.gained = [];
    expect(classifyReport(j).cards[0]!.lost).toMatchObject({ class: 1, self: 0 });
  });
});

describe("the tag names the trigger, not just its family (#1485 review)", () => {
  // Ill-Tempered Loner // Howlpack Avenger: a self damaged trigger AND a "permanent you control" one.
  const two = (tags: string[], extra: Record<string, unknown> = {}): ImpactJson => ({
    pairDetail: [{ name: "Fighter", lost: tags.map((t) => key(t, "Fighter", "Loner")), gained: [] }],
    rows: { Loner: { base: [SELF, PERM], head: [SELF, PERM] }, ...extra },
  });
  it("damaged:creature is the SELF trigger, damaged:permanent the class one", () => {
    expect(classifyReport(two(["damaged:creature"])).cards[0]!.lost).toMatchObject({ self: 1, class: 0, ambiguous: 0 });
    const p = classifyReport(two(["damaged:permanent"])).cards[0]!;
    expect(p.lost).toMatchObject({ self: 0, class: 1 });
    expect(p.lostToClass).toEqual(["Loner"]);
  });
  it("both tags at once: one self, one class", () => {
    expect(classifyReport(two(["damaged:creature", "damaged:permanent"])).cards[0]!.lost).toMatchObject({ self: 1, class: 1 });
  });
  it("no trigger carries the class key: falls back to the family and says AMBIGUOUS, never class", () => {
    const c = classifyReport(two(["damaged:planeswalker"])).cards[0]!;
    expect(c.lost).toMatchObject({ ambiguous: 1, class: 0, self: 0 });
    expect(c.lostToClass).toEqual([]);
    expect(c.ambiguousList).toEqual([{ dir: "lost", counterpart: "Loner", tag: "damaged:planeswalker" }]);
    expect(formatClassified(classifyReport(two(["damaged:planeswalker"])))).toContain("AMBIGUOUS");
  });
  it("a non-combat-damage lost pair into a 'deals damage' self trigger is self", () => {
    const j: ImpactJson = { pairDetail: [{ name: "Burner", lost: [key("non-combat-damage:creature", "Burner", "Angel")], gained: [] }], rows: { Angel: { base: [DEALS], head: [DEALS] } } };
    expect(classifyReport(j).cards[0]!.lost).toMatchObject({ self: 1, unmatched: 0, ambiguous: 0 });
  });
  it("counts matched and unmatched per family", () => {
    const j = two(["damaged:creature", "damaged:permanent", "enters:creature"], { Loner: { base: [SELF, PERM], head: [SELF, PERM] } });
    const r = classifyReport(j);
    expect(r.families).toEqual([{ family: "damaged", matched: 2, ambiguous: 0, unmatched: 0 }, { family: "enters", matched: 0, ambiguous: 0, unmatched: 1 }]);
  });
});

describe("compactRow", () => {
  it("keeps only what classification reads", () => {
    const row = compactRow({
      abilities: [
        { kind: "triggered", clause: 3, face: 1, grantedBy: 2, text: "long", trigger: { verbs: ["damaged"], subject: { self: true, control: "you", token: null } }, emits: [{ verb: "dies", subject: { control: "opp", type: "creature" }, extra: 1 }] },
        { kind: "static" },
      ],
    });
    expect(row).toEqual([
      { kind: "triggered", grantedBy: 2, trigger: { verbs: ["damaged"], subject: { self: true, control: "you" } }, emits: [{ verb: "dies", subject: { control: "opp", type: "creature" } }] },
      { kind: "static" },
    ]);
  });
});
