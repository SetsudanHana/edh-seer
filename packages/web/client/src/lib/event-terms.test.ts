import { expect, test } from "vitest";
import { answerTerms, eventGlyphs, eventGroup, nextOp, termsOf, withTerms, type EventTerm } from "./event-terms.js";
import { eventsFromParams, eventsToParams, type EventQuery } from "./facets.js";

const empty: EventQuery = { produce: [], consume: [], colours: [], types: [], subtypes: [], keywords: [], cardColours: [] };

test("terms round-trip through the query and the URL, in the order the sentence reads", () => {
  const terms: EventTerm[] = [
    { key: "gain-life|-|-|-", side: "makes", op: "or" },
    { key: "dies|artifact|-|-", side: "pays", op: "and" },
    { key: "lose-life|-|-|-", side: "makes", op: "not" },
    { key: "leaves-graveyard|artifact|-|-", side: "makes", op: "or" },
  ];
  const q = withTerms(empty, terms);
  expect(q.consume).toEqual(["dies|artifact|-|-"]);
  expect(q.orProduce).toEqual(["gain-life|-|-|-", "leaves-graveyard|artifact|-|-"]);
  expect(q.notProduce).toEqual(["lose-life|-|-|-"]);
  const back = eventsFromParams(eventsToParams(q, new URLSearchParams()));
  expect(termsOf(back).map((t) => `${t.op} ${t.side} ${t.key}`)).toEqual([
    "and pays dies|artifact|-|-",
    "or makes gain-life|-|-|-",
    "or makes leaves-graveyard|artifact|-|-",
    "not makes lose-life|-|-|-",
  ]);
});

/** A LINK WRITTEN BEFORE THE OPERATORS READS EXACTLY AS IT DID: no empty operator fields appear. */
test("an old link carries no operator fields", () => {
  const q = eventsFromParams(new URLSearchParams("produce=mill%7C-%7C-%7C-"));
  expect(q).toEqual({ ...empty, produce: ["mill|-|-|-"] });
  expect(termsOf(q)).toEqual([{ key: "mill|-|-|-", side: "makes", op: "and" }]);
});

test("the joining word cycles and, or, not", () => {
  expect(nextOp("and")).toBe("or");
  expect(nextOp("or")).toBe("not");
  expect(nextOp("not")).toBe("and");
});

test("and intersects, or unions, not takes away", () => {
  const lists: Record<string, number[]> = { a: [1, 2, 3], b: [2, 3, 4], c: [5], d: [3] };
  const run = (terms: EventTerm[]) => answerTerms(terms, (t) => lists[t.key]!);
  const t = (key: string, op: EventTerm["op"]): EventTerm => ({ key, side: "makes", op });
  expect([...run([t("a", "and"), t("b", "and")]).keep!]).toEqual([2, 3]);
  expect([...run([t("a", "or"), t("c", "or")]).keep!].sort()).toEqual([1, 2, 3, 5]);
  expect([...run([t("b", "and"), t("a", "or"), t("c", "or")]).keep!].sort()).toEqual([2, 3]);
  const onlyNot = run([t("d", "not")]);
  expect(onlyNot.keep).toBeNull();
  expect([...onlyNot.drop]).toEqual([3]);
});

test("a term wears its type and its zone in the mana font, and nothing it has no symbol for", () => {
  expect(eventGlyphs("leaves-graveyard|artifact|-|-")).toEqual(["artifact", "graveyard"]);
  expect(eventGlyphs("gain-life|-|-|-")).toEqual(["ability-lifelink"]);
  expect(eventGlyphs("create-token|creature|-|t")).toEqual(["creature", "token"]);
  expect(eventGlyphs("lose-life|-|-|-")).toEqual([]);
});

test("events group by what happens", () => {
  expect(eventGroup("fills|creature|-|-").id).toBe("into-yard");
  expect(eventGroup("leaves-graveyard|-|-|-").id).toBe("out-of-yard");
  expect(eventGroup("applies:pump|artifact|-|-").id).toBe("static");
  expect(eventGroup("monarch|-|-|-").id).toBe("other");
});
