import { describe, expect, it } from "vitest";
import { measureDropped, measureRoles, type DroppedTagger, type DroppedRow, type RoleDetectors } from "./ratchet-measure.js";

const tagger = (over: Partial<DroppedTagger> = {}): DroppedTagger => ({
  grammarClauseRecords: () => ({ records: [{ id: 1, actions: [{ verb: "cant" }] } as never] }),
  deriveAbilitiesOf: () => ({ spliced: new Set() }),
  deriveInputOf: (() => ({})) as never,
  grantedTokenClauses: () => new Set(),
  clauseTexts: () => ({ 1: "Target creature can't block." }),
  INERT_VERBS: new Set(),
  ...over,
});
const doc = (id: string, name: string) => ({ _id: id, name, typeLine: "Instant" }) as never;
const canonical = [{ id: 1, actions: [{ verb: "cant" }] }] as never;

describe("measureDropped", () => {
  it("keys a clause with an action and no ability, reading a model row's stored records", () => {
    const rows: Record<string, DroppedRow> = { a: { clauseSource: "model", abilities: [] }, b: { clauseSource: "model", abilities: [{ clause: 1 }] } };
    const m = measureDropped([doc("a", "Abrupt"), doc("b", "Kept")], (id) => rows[id], () => canonical, tagger());
    expect(m.measured).toEqual({ Abrupt: ["1:cant"] });
    expect(m.actions).toBe(1);
    expect([...m.reportedBy.Abrupt!]).toEqual([]);
  });
  it("reads a grammar row's records from the grammar, not the clause doc", () => {
    const m = measureDropped([doc("a", "Abrupt")], () => ({ clauseSource: "grammar", abilities: [] }), () => undefined, tagger());
    expect(m.measured).toEqual({ Abrupt: ["1:cant"] });
  });
  it("counts a card with no row as underived and a row with no records as such", () => {
    const m = measureDropped([doc("a", "NoRow"), doc("b", "NoRecords")], (id) => (id === "b" ? { clauseSource: "model" } : undefined), () => undefined, tagger());
    expect(m).toMatchObject({ underived: 1, noRecords: 1, underivedNames: ["NoRow"], noRecordNames: ["NoRecords"], measured: {} });
  });
});

describe("measureRoles", () => {
  it("prefixes and merges role, answer and wincon membership by card, sorted", () => {
    const t: RoleDetectors = {
      detectBuildCategories: () => new Map([["ramp", new Set(["Sol Ring", "Cultivate"])]]),
      detectAnswerClasses: () => new Map([["creature", { cards: ["Cultivate"] }]]),
      detectWincons: () => new Map([["go-wide", new Set(["Sol Ring"])]]),
    };
    expect(measureRoles([], t)).toEqual({ Cultivate: ["answer:creature", "role:ramp"], "Sol Ring": ["role:ramp", "wincon:go-wide"] });
  });
});
