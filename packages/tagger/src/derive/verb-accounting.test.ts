/** IS EVERY CLAUSE VERB ACCOUNTED FOR? See `verb-accounting.ts` for the three columns. The Baral
 *  shape this catches: a verb that emits nothing and is listed nowhere, so its silence on the
 *  producer side becomes a wrong answer on the consumer side. Runs offline; the OPEN counts are
 *  re-measured by `research/tagger/dropped-action-census.ts`, which reads the same table. */
import { expect, test } from "vitest";
import { TRIGGERS, VERBS } from "../normalize-prompt.js";
import { VERB_VOCAB } from "../schema.js";
import { normalizeTriggerVerb } from "./derive.js";
import { actionEmits } from "./emits.js";
import { ENGINE_TO_TRIGGER, NOT_AN_EVENT, OPEN, TRIGGER_REFUSED } from "./verb-accounting.js";

/** Does the verb emit an event of its OWN on any representative shape? A generic object covers
 *  most verbs; zoned put/return emit `enters`. On the zoned shapes `leaves` is discounted — every
 *  verb that moves a card out of a zone emits it (play, shuffle), and it says nothing about the
 *  verb's own event. Computed, so a new EMITS row is noticed the moment it lands. */
const emitsAnything = (verb: string): boolean =>
  actionEmits({ verb, object: "target creature", amount: "1" }, "").length > 0
  || [
    { verb, object: "a creature card", fromZone: "graveyard", toZone: "battlefield" },
    { verb, object: "your library for a card", fromZone: "library", toZone: "hand" },
  ].some((a) => actionEmits(a, "").some((e) => e.verb !== "leaves"));

const verbs = VERBS.filter((v) => v !== "other" && v !== "none");
const words = new Set(TRIGGERS);

test("every VERB is EMITS, NOT AN EVENT or OPEN — exactly one", () => {
  const problems: string[] = [];
  for (const v of verbs) {
    const emits = emitsAnything(v), open = v in OPEN, notEvent = v in NOT_AN_EVENT;
    if (emits && (open || notEvent)) problems.push(`${v} EMITS now — bank it: remove from ${open ? "OPEN" : "NOT_AN_EVENT"}`);
    if (!emits && !open && !notEvent) problems.push(`${v} emits nothing and is listed nowhere`);
    if (open && notEvent) problems.push(`${v} is in both OPEN and NOT_AN_EVENT`);
  }
  expect(problems).toEqual([]);
  for (const v of [...Object.keys(OPEN), ...Object.keys(NOT_AN_EVENT)]) expect(VERBS, `${v} is not a VERB`).toContain(v);
});

test("every engine event has a consumer word, and every consumer word maps or is refused for a reason", () => {
  for (const v of VERB_VOCAB) {
    const w = ENGINE_TO_TRIGGER[v];
    expect(w, `engine verb ${v} has no TRIGGERS word`).toBeDefined();
    expect(words.has(w!), `${v} -> ${w}, not in TRIGGERS`).toBe(true);
  }
  const unaccounted: string[] = [], banked: string[] = [];
  for (const t of TRIGGERS) {
    if (t === "other" || t === "none") continue;
    const maps = normalizeTriggerVerb(t) !== null || t === "damage-dealt";
    if (!maps && !(t in TRIGGER_REFUSED)) unaccounted.push(t);
    if (maps && t in TRIGGER_REFUSED && t !== "damage-dealt") banked.push(t);
  }
  expect(unaccounted, "TRIGGERS words with no engine verb and no reason").toEqual([]);
  expect(banked, "refused words that now map — remove them from TRIGGER_REFUSED").toEqual([]);
  for (const t of Object.keys(TRIGGER_REFUSED)) expect(words.has(t), `${t} is refused but not in TRIGGERS`).toBe(true);
});

test("the Baral shape is closed: counter-spell emits and countered maps to it", () => {
  expect(emitsAnything("counter-spell")).toBe(true);
  expect(normalizeTriggerVerb("countered")).toBe("counter-spell");
});
