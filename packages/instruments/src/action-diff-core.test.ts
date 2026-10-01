import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "vitest";
import { parse } from "@edh-seer/tagger/grammar";
import { parseSubject } from "@edh-seer/tagger/subject";
import { actionDiff, align, diffActions, familyOf, readActions, storedCounter, type ActionReading, type ActionRow, type StoredAction } from "./action-diff-core.js";

const subjectOf = (t: string) => parse(t) ?? parseSubject(t);
const row = (effect: string, actions: StoredAction[], cards = 1): ActionRow => ({ effect, type: "spell", actions, cards });
const asRead = (a: StoredAction): ActionReading => ({ verb: a.verb, object: subjectOf(a.object),
  ...(a.verb === "add-counter" || a.verb === "remove-counter" ? { counter: storedCounter(a.object) } : {}), ...(a.amount ? { amount: a.amount } : {}), ...(a.fromZone ? { fromZone: a.fromZone } : {}), ...(a.toZone ? { toZone: a.toZone } : {}), ...(a.optional ? { optional: true } : {}) });

test("families follow the owner's order; an unlisted verb is `other`", () => {
  expect(familyOf("draw")).toBe("draw-search");
  expect(familyOf("deal-damage")).toBe("damage-life");
  expect(familyOf("add-counter")).toBe("counters");
  expect(familyOf("create")).toBe("tokens");
  expect(familyOf("exile")).toBe("zone");
  expect(familyOf("modify-pt")).toBe("other");
});

test("a field the reading changes is a difference; the object's fields are prefixed", () => {
  const stored: StoredAction = { verb: "draw", object: "a card", amount: "1" };
  expect(actionDiff(stored, asRead(stored), subjectOf)).toEqual([]);
  expect(actionDiff(stored, { ...asRead(stored), amount: "2" }, subjectOf)).toEqual(["amount"]);
  expect(actionDiff({ verb: "destroy", object: "target creature" }, { verb: "destroy", object: { ...subjectOf("target creature"), control: "opp" } }, subjectOf)).toEqual(["object.control"]);
});

test("readings align to stored actions by verb, in order", () => {
  expect(align(["search", "put", "tap", "shuffle"], ["search", "put", "shuffle"])).toEqual([[0, 0], [1, 1], [3, 2]]);
  expect(align(["sacrifice", "draw"], ["draw"])).toEqual([[1, 0]]);
});

test("coverage per action, weighted by cards; an unread action keeps today's path; an unaligned reading is `extra`", () => {
  const rows = [
    row("Draw two cards.", [{ verb: "draw", object: "two cards", amount: "2" }], 10),
    row("Destroy target creature. You gain 3 life.", [{ verb: "destroy", object: "target creature" }, { verb: "gain-life", object: "you", amount: "3" }], 4),
    row("Exile target card.", [{ verb: "exile", object: "target card" }], 2),
  ];
  const d = diffActions(rows, (effect) => {
    if (effect.startsWith("Draw")) return [{ verb: "draw", object: subjectOf("two cards"), amount: "2" }];
    if (effect.startsWith("Destroy")) return [{ verb: "gain-life", object: subjectOf("you"), amount: "4" }];
    return [{ verb: "draw" }];
  }, subjectOf);
  expect(d.families["draw-search"]).toEqual({ total: { actions: 1, cards: 10 }, parsed: { actions: 1, cards: 10 }, agree: { actions: 1, cards: 10 } });
  expect(d.families.zone.total).toEqual({ actions: 2, cards: 6 });
  expect(d.families.zone.parsed).toEqual({ actions: 0, cards: 0 });
  expect(d.groups.map((g) => [g.family, g.fields.join(",")])).toEqual([["damage-life", "amount"], ["draw-search", "extra:draw"]]);
  expect(d.nondeterministic).toEqual([]);
});

test("the checked-in census reads, and the stored actions agree with themselves on every action", () => {
  const rows = readActions(gunzipSync(readFileSync(new URL("../../tagger/actions.jsonl.gz", import.meta.url))).toString("utf8"));
  expect(rows.length).toBeGreaterThan(30000);
  const byEffect = new Map<string, ActionRow>();
  const keyed = rows.map((r, i) => { const k = `${i}|${r.effect}`; byEffect.set(k, r); return { ...r, effect: k }; });
  const d = diffActions(keyed, (k) => byEffect.get(k)!.actions.map(asRead), subjectOf);
  for (const f of Object.values(d.families)) expect(f.agree).toEqual(f.total);
}, 60000);
