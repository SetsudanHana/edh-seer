import { describe, expect, test } from "vitest";
import { deriveRow } from "../derive-worker.js";
import { grammarClauseRecords } from "../grammar/clause-record.js";
import { deriveDiff } from "../grammar/derive-diff.js";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";
import fixtures from "./trigger-opp-control-1217.fixtures.json" with { type: "json" };

/** #1217 -- the grammar's clause record names an opponent's trigger `control: "opp"`, the stored model answer `"opponent"`; derive read only the latter, so the grammar reading of
 *  "When a creature is put into an opponent's graveyard from the battlefield" was `control: any` and its diff against the stored answer carried an unlabelled
 *  `trigger.subject(~control)` beside the labelled `emits.subject(+fromZone)`: Magus of the Bridge stayed model-sourced, its self exile without a zone.
 *  Source document and stored `cardClauses.canonical` dumped from Mongo (DERIVE 581, 2026-11-23): `trigger-opp-control-1217.fixtures.json`. */
type Fx = { source: Record<string, unknown>; canonical: unknown[] };
const fx = (fixtures as Record<string, Fx>)["Magus of the Bridge"]!;
const opts = { foldGrantTwins: false, collapseZoneSearches: false };

describe("Magus of the Bridge", () => {
  const g = grammarClauseRecords(fx.source as never);
  const stored = deriveCardTags(deriveInputOf(fx.source as never, "m", "Magus of the Bridge", fx.canonical as never), opts).abilities;
  const grammar = deriveCardTags(deriveInputOf(fx.source as never, "m", "Magus of the Bridge", g.records, undefined, g.readings), opts).abilities;
  test("the grammar's `opp` trigger control is the trigger subject's control, as the stored `opponent` is", () => {
    expect(stored[1]!.trigger!.subject.control).toBe("opp");
    expect(grammar[1]!.trigger!.subject.control).toBe("opp");
  });
  test("the only difference left is the labelled zone", () => {
    expect(deriveDiff(stored, grammar)).toBe("emits.subject(+fromZone)");
  });
  test("the card derives from the grammar and its self exile leaves the battlefield", () => {
    const row = deriveRow({ doc: { oracleId: "m", name: "Magus of the Bridge", canonical: fx.canonical } as never, source: fx.source, isToken: false });
    expect(row.fromGrammar).toBe(true);
    const exiled = row.tags.abilities.flatMap((a) => a.emits ?? []).filter((e) => e.verb === "exiled" && e.subject.self === true);
    expect(exiled.map((e) => e.subject.fromZone)).toEqual(["battlefield"]);
  });
});
