import { describe, expect, it } from "vitest";
import { impactJson, type ImpactReport } from "./derive-impact-core.js";
import { buildPairRows, classifyReport, compactRow, formatClassified, inputProblem, noRowProblem, type ImpactJson } from "./loss-classify-core.js";

const trig = (verbs: string[], subject: Record<string, unknown>) => ({ kind: "triggered", trigger: { verbs, subject } });
const SELF = trig(["damaged"], { control: "you", type: "creature", self: true });
const CLASS = trig(["damaged"], { control: "opp", type: "creature" });
const PERM = trig(["damaged"], { control: "you", type: "permanent" });
const DEALS = trig(["non-combat-damage"], { control: "you", type: "creature", self: true });
/** One id's row. */
const v = (abilities: unknown[], id = "1") => [{ id, abilities }] as never;
const both = (abilities: unknown[]) => ({ base: v(abilities), head: v(abilities) });

const key = (tag: string, p: string, c: string) => `${tag}|${p}|${c}`;
const fixture = (): ImpactJson => ({
  pairDetail: [{
    id: "x", name: "Fighter",
    lost: [
      key("damaged:creature", "Fighter", "SelfCard"),   // counterpart hears it with a SELF trigger
      key("damaged:creature", "Fighter", "ClassCard"),  // with a CLASS trigger (read at BASE)
      key("damaged:creature", "Fighter", "NoTrigger"),  // no matching trigger at all
      key("damaged:creature", "Maker", "Fighter"),      // the changed card is the CONSUMER: its own self trigger is read
      key("damaged:creature [via token]", "Fighter", "ClassCard"), // token hop, read by the consumer's trigger
      key("damaged:creature", "Fighter", "Ghost"),      // no row in the file
    ],
    gained: [
      key("damaged:creature", "Fighter", "SelfCard"),   // gained into a self trigger: probable false edge
      key("damaged:creature", "Fighter", "ClassCard"),
    ],
  }],
  pairRows: {
    Fighter: both([SELF]),
    SelfCard: both([SELF]),
    // class at BASE, self at HEAD: a LOST pair reads the BASE row, a GAINED one the HEAD row
    ClassCard: { base: v([CLASS]), head: v([SELF]) },
    NoTrigger: both([{ kind: "static" }]),
    Maker: both([]),
  },
});

describe("classifyReport", () => {
  const r = classifyReport(fixture());
  const c = r.cards[0]!;
  it("counts lost pairs per class (consumer-side and via-token pairs are read, not 'other')", () => {
    expect(c.lost).toEqual({ self: 2, class: 2, other: 0, ambiguous: 0, unmatched: 1, noRow: 1 });
    expect(c.consumerSide).toBe(1);
    expect(c.viaToken).toBe(1);
  });
  it("counts gained pairs per class, reading the HEAD row", () => {
    expect(c.gained).toEqual({ self: 2, class: 0, other: 0, ambiguous: 0, unmatched: 0, noRow: 0 });
  });
  it("lists the class-trigger counterparts with their filter and which path was read", () => {
    expect(c.classList).toEqual([
      { dir: "lost", counterpart: "ClassCard", family: "damaged", filter: "control=opp type=creature", note: "" },
      { dir: "lost", counterpart: "ClassCard", family: "damaged", filter: "control=opp type=creature", note: "via token" },
    ]);
  });
  it("flags LOST->CLASS and GAINED->SELF", () => {
    expect(c.lostToClass).toEqual(["ClassCard"]);
    expect(c.gainedToSelf).toEqual(["SelfCard", "ClassCard"]);
  });
  it("prints both flags, the labels and a one-line summary with every bucket", () => {
    const out = formatClassified(r);
    expect(out).toContain("LOST->CLASS");
    expect(out).toContain("GAINED->SELF");
    expect(out).toContain("via token");
    expect(out).toContain("consumer-side");
    expect(out).toMatch(/summary: 1 card\(s\); lost 6 \(self 2, class 2, other 0, ambiguous 0, unmatched 1, no row 1\); gained 2 \(self 2, class 0, other 0, ambiguous 0, unmatched 0, no row 0\); consumer-side 1, via token 1;/);
  });
  it("warns, per family, about a consumer with no trigger for the tag", () => {
    expect(formatClassified(r)).toContain("WARNING: 1 pair(s) into a consumer with no trigger matching the tag: damaged 1");
  });
  it("restricts to one card", () => {
    expect(classifyReport(fixture(), "Nobody").cards).toEqual([]);
    expect(classifyReport(fixture(), "Fighter").cards).toHaveLength(1);
  });
  it("a class trigger wins over a self trigger on the same counterpart", () => {
    const j = fixture();
    j.pairRows.Both = both([SELF, CLASS]);
    j.pairDetail[0]!.lost = [key("damaged:creature", "Fighter", "Both")];
    j.pairDetail[0]!.gained = [];
    expect(classifyReport(j).cards[0]!.lost).toMatchObject({ class: 1, self: 0 });
  });
});

describe("the CHANGED card as the consumer", () => {
  it("lost reads its BASE row, gained its HEAD row, and a class trigger there is LOST->CLASS", () => {
    const j: ImpactJson = {
      pairDetail: [{ name: "Taunter", lost: [key("damaged:creature", "Maker", "Taunter")], gained: [key("damaged:creature", "Maker", "Taunter")] }],
      pairRows: { Taunter: { base: v([CLASS]), head: v([SELF]) }, Maker: both([]) },
    };
    const c = classifyReport(j).cards[0]!;
    expect(c.lost).toMatchObject({ class: 1, other: 0 });
    expect(c.gained).toMatchObject({ self: 1, other: 0 });
    expect(c.consumerSide).toBe(2);
    expect(c.lostToClass).toEqual(["Maker"]);
    expect(c.gainedToSelf).toEqual(["Maker"]);
  });
  it("'other' is only a pair that names neither side as the changed card", () => {
    const j: ImpactJson = { pairDetail: [{ name: "Tok", lost: [key("damaged:creature", "A", "B")], gained: [] }], pairRows: {} };
    expect(classifyReport(j).cards[0]!.lost.other).toBe(1);
  });
});

describe("[via token] pairs", () => {
  it("into a class trigger is LOST->CLASS and carries the label", () => {
    const j: ImpactJson = { pairDetail: [{ name: "Maker", lost: [key("damaged:permanent [via token]", "Maker", "Payoff")], gained: [] }], pairRows: { Payoff: both([PERM]) } };
    const c = classifyReport(j).cards[0]!;
    expect(c.lostToClass).toEqual(["Payoff"]);
    expect(c.viaToken).toBe(1);
    expect(formatClassified(classifyReport(j))).toContain("via token");
  });
});

describe("a name that maps to more than one id", () => {
  const two = (a: unknown[], b: unknown[]): ImpactJson => ({
    pairDetail: [{ name: "Fighter", lost: [key("damaged:creature", "Fighter", "Dragon Spirit")], gained: [] }],
    pairRows: { "Dragon Spirit": { base: [{ id: "t1", abilities: a }, { id: "t2", abilities: b }] as never } },
  });
  it("is ambiguous when the variants disagree, never one picked silently", () => {
    const c = classifyReport(two([SELF], [CLASS])).cards[0]!;
    expect(c.lost).toMatchObject({ ambiguous: 1, self: 0, class: 0 });
    expect(c.lostToClass).toEqual([]);
    expect(c.ambiguousList).toEqual([{ dir: "lost", counterpart: "Dragon Spirit", tag: "damaged:creature" }]);
  });
  it("keeps the class when every variant agrees", () => {
    expect(classifyReport(two([SELF], [SELF])).cards[0]!.lost).toMatchObject({ self: 1, ambiguous: 0 });
  });
  it("buildPairRows stores every id of a duplicated name, on each side", () => {
    const rows = buildPairRows(
      [{ name: "Fighter", lost: [key("damaged:creature", "Fighter", "Dragon Spirit")], gained: [] }],
      [{ id: "t1", name: "Dragon Spirit", tags: { abilities: [SELF] } }, { id: "t2", name: "Dragon Spirit", tags: { abilities: [] } }, { id: "z", name: "Unrelated", tags: { abilities: [] } }],
      [{ id: "t1", name: "Dragon Spirit", tags: { abilities: [SELF] } }],
    );
    expect(Object.keys(rows)).toEqual(["Dragon Spirit"]);
    expect(rows["Dragon Spirit"]!.base!.map((x) => x.id)).toEqual(["t1", "t2"]);
    expect(rows["Dragon Spirit"]!.head!.map((x) => x.id)).toEqual(["t1"]);
  });
});

describe("the tag names the trigger, not just its family (#1485 review)", () => {
  const two = (tags: string[]): ImpactJson => ({
    pairDetail: [{ name: "Fighter", lost: tags.map((t) => key(t, "Fighter", "Loner")), gained: [] }],
    pairRows: { Loner: both([SELF, PERM]) },
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
    expect(formatClassified(classifyReport(two(["damaged:planeswalker"])))).toContain("AMBIGUOUS");
  });
  it("a non-combat-damage lost pair into a 'deals damage' self trigger is self", () => {
    const j: ImpactJson = { pairDetail: [{ name: "Burner", lost: [key("non-combat-damage:creature", "Burner", "Angel")], gained: [] }], pairRows: { Angel: both([DEALS]) } };
    expect(classifyReport(j).cards[0]!.lost).toMatchObject({ self: 1, unmatched: 0, ambiguous: 0 });
  });
  it("counts matched and unmatched per family", () => {
    const r = classifyReport(two(["damaged:creature", "damaged:permanent", "enters:creature"]));
    expect(r.families).toEqual([{ family: "damaged", matched: 2, ambiguous: 0, unmatched: 0 }, { family: "enters", matched: 0, ambiguous: 0, unmatched: 1 }]);
  });
});

describe("guards", () => {
  it("a JSON from before #1485 (its `rows` is the report's {totals, changes}) is refused", () => {
    const old = { pairDetail: [], rows: { totals: {}, changes: [] } } as never;
    expect(inputProblem(old)).toMatch(/pairRows/);
    expect(inputProblem(fixture())).toBeUndefined();
  });
  it("refuses a report whose pairs are mostly 'no row'", () => {
    const j: ImpactJson = { pairDetail: [{ name: "A", lost: [key("damaged:creature", "A", "X"), key("damaged:creature", "A", "Y"), key("damaged:creature", "A", "SelfCard")], gained: [] }], pairRows: { SelfCard: both([SELF]) } };
    expect(noRowProblem(classifyReport(j))).toMatch(/no row/);
    expect(noRowProblem(classifyReport(fixture()))).toBeUndefined();
  });
});

describe("derive-impact's JSON", () => {
  it("keeps the report's rows.totals / rows.changes beside pairRows", () => {
    const report = { rows: { totals: { a: 1 }, changes: [{ id: "x" }] } } as unknown as ImpactReport;
    const j = impactJson(report, [], [], { A: both([]) }) as unknown as Record<string, any>;
    expect(j.rows.totals).toEqual({ a: 1 });
    expect(j.rows.changes).toHaveLength(1);
    expect(Object.keys(j.pairRows)).toEqual(["A"]);
    expect(Object.keys(j)).toEqual(expect.arrayContaining(["pairDetail", "sampleDetail", "pairRows"]));
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
