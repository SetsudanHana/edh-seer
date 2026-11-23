/** "Open an Attraction" (CR 701.51: put the top card of your Attraction deck onto the battlefield under your control; CR 717.1: Attraction is an artifact subtype) (#1325).
 *  EVERY CARD HERE IS REAL INPUT: `attraction.fixtures.json` holds the card document and the clause records derive used,
 *  dumped from Mongo by `research/attraction/dump-attraction-fixtures.mts`. */
import { describe, expect, it } from "vitest";
import { deriveInputOf } from "../derive-input.js";
import { deriveCardTags } from "./derive.js";
import { GUARDED_VERBS } from "./verb-words.js";
import type { CardTags } from "../schema.js";
import fixtures from "./attraction.fixtures.json" with { type: "json" };

const tagsOf = (name: string): CardTags => {
  const fx = (fixtures as unknown as Record<string, { card: Record<string, unknown> & { _id: string; name: string }; clauses: never[] }>)[name]!;
  expect(fx, `fixture for ${name}`).toBeDefined();
  return deriveCardTags(deriveInputOf(fx.card as never, fx.card._id, fx.card.name, fx.clauses));
};
const emitsOf = (name: string) => tagsOf(name).abilities.flatMap((a) => a.emits ?? []);
/** Every commander-legal card that prints "open an Attraction" (corpus census, 18). */
const OPENERS = ["Complaints Clerk", "Discourtesy Clerk", "Pick-a-Beeble", "Myra the Magnificent", "Soul Swindler", "Coming Attraction", "Seasoned Buttoneer", "Rad Rascal", "Squirrel Squatters",
  "\"Lifetime\" Pass Holder", "Ride Guide", "Spinnerette, Arachnobat", "Quick Fixer", "Petting Zookeeper", "Deadbeat Attendant", "The Most Dangerous Gamer", "Dee Kay, Finder of the Lost", "Monitor Monitor", "Draconian Gate-Bot"];

describe("open an Attraction is the Attraction card entering under your control (#1325)", () => {
  it("every opener emits one `enters` of an artifact Attraction you control, not a token", () => {
    for (const n of OPENERS) {
      const enters = emitsOf(n).filter((e) => e.verb === "enters" && [e.subject.subtype].flat().includes("attraction"));
      expect(enters.length, n).toBeGreaterThan(0);
      for (const e of enters) {
        expect(e.subject, n).toMatchObject({ control: "you", type: "artifact", subtype: "attraction" });
        expect(e.subject.token, n).not.toBe(true);
      }
    }
  });
  it("none of them makes a Clue, or a token of an Attraction (an Attraction is a card, CR 717.1)", () => {
    for (const n of OPENERS) {
      const emits = emitsOf(n);
      expect(emits.filter((e) => e.verb === "create-token" && [e.subject.subtype].flat().includes("attraction")), n).toEqual([]);
      expect(emits.filter((e) => [e.subject.subtype].flat().includes("clue")), n).toEqual([]);
    }
  });
  it("the opening is read, so it is no longer unclaimed", () => {
    for (const n of OPENERS) expect((tagsOf(n).unclaimed ?? []).filter((u) => /attraction/i.test(u.object ?? "")), n).toEqual([]);
  });
  it("Gate-Bot's 'destroy target Attraction' mode is untouched", () => {
    expect(emitsOf("Draconian Gate-Bot").some((e) => e.verb === "dies")).toBe(true);
  });
});

describe("a real investigator is unchanged (#1325)", () => {
  it("Tireless Tracker and Forensic Gadgeteer still make a Clue token", () => {
    for (const n of ["Tireless Tracker", "Forensic Gadgeteer"]) {
      const made = emitsOf(n).filter((e) => e.verb === "create-token");
      expect(made.length, n).toBeGreaterThan(0);
      for (const e of made) expect(e.subject, n).toMatchObject({ token: true, subtype: "clue" });
    }
  });
});

describe("investigate is a guarded verb (#1325)", () => {
  it("is in GUARDED_VERBS", () => { expect(GUARDED_VERBS.has("investigate")).toBe(true); });
});
