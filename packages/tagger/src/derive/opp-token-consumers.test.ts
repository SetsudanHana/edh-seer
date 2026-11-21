import { describe, expect, test } from "vitest";
import { deriveAsCorpus } from "../derive-worker.js";
import fixtures from "./opp-token-consumers.fixtures.json" with { type: "json" };

/** #1696: A TOKEN REPLACEMENT THAT SAYS "UNDER YOUR CONTROL" / "IF YOU WOULD CREATE" HEARS ONLY YOUR TOKENS. The passive frame ("If one or more tokens would be created under your control, ...") printed its
 *  control AFTER the verb, where the template stopped, so Chatterfang, Mondrak, Adrix and Nev, Divine Visitation ... stored `trigger.subject.control: any` and a token an opponent is given (Balefang the Unslayable,
 *  Hunted Horror) paired with them. The active frame ("If you would create one or more tokens") named the actor `you` and dropped it (Jinnie Fay, Xorn). A card that does not limit the creator (Primal Vigor:
 *  "If one or more tokens would be created") stays `any`. Fixtures: card documents and stored `cardClauses` dumped from Mongo 2026-11-21 (DERIVE 560); derived as derive-corpus derives them. */
type Fx = { source: Record<string, unknown>; canonical?: unknown[]; segmentHash?: string };
const rowOf = (name: string) => {
  const f = (fixtures as unknown as Record<string, Fx>)[name]!;
  return deriveAsCorpus({ doc: { oracleId: name, name, canonical: f.canonical ?? [], segmentHash: f.segmentHash } as never, source: f.source, isToken: false });
};
const hears = (name: string) => rowOf(name).tags.abilities.filter((a) => a.trigger?.verbs.includes("create-token")).map((a) => a.trigger!.subject.control);

describe("a token replacement limited to your tokens hears them only", () => {
  test.each([
    "Chatterfang, Squirrel General", "Mondrak, Glory Dominus", // passive frame, model
    "Jinnie Fay, Jetmir's Second", "Xorn", // active frame "If you would create", model
    "Divine Visitation", "Kaya, Geist Hunter", // creature tokens / until end of turn
    "Holo-Engineer", // passive frame, grammar
    "Fisher's Talent", "Bilbo, Fellow Conspirator", "Flitwing, Lyev Detective", "Academy Manufactor", // active frame, grammar and model
    "Stridehangar Automaton",
    "Doubling Season", // the control was already read ("an effect would create ... under your control")
  ])("%s", (name) => {
    const c = hears(name);
    expect(c.length).toBeGreaterThan(0);
    for (const x of c) expect(x).toBe("you");
  });
  test("Primal Vigor names no creator, so it hears every token: any", () => {
    expect(hears("Primal Vigor")).toEqual(["any"]);
  });
});
