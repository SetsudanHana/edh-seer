import { expect, test } from "vitest";
import { parseAbilities, extractJsonObject } from "./validate.js";
import { VERB_VOCAB, EFFECT_KINDS } from "./schema.js";

test("extracts the abilities object from think-wrapped, fenced, prose output", () => {
  const raw =
    'Sure! <think>this card has one static ability</think>\nHere it is:\n```json\n{ "abilities": [] }\n```\nDone.';
  expect(extractJsonObject(raw)).toBe('{ "abilities": [] }');
});

test("parseAbilities tolerates a reasoning-model wrapper around the JSON", () => {
  const raw =
    '<think>trigger on dies, drain</think>{"abilities":[{"kind":"triggered","trigger":{"verbs":["dies"],"subject":{"type":"creature","control":"you","token":null}},"effect":{"kind":"drain"}}]}';
  const [a] = parseAbilities(raw);
  expect(a.kind).toBe("triggered");
  expect(a.effect.kind).toBe("drain");
});

test("parses a valid triggered ability", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { subtype: "wizard", control: "you", token: false } },
        effect: { kind: "token-generation" },
      },
    ],
  });
  const abilities = parseAbilities(raw);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].kind).toBe("triggered");
  expect(abilities[0].trigger!.verbs).toEqual(["enters"]);
});

test("empty abilities is valid", () => {
  expect(parseAbilities('{"abilities":[]}')).toEqual([]);
});

test("keeps a pure-lifegain effect.kind (Essence Warden: gain life on creature ETB)", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } },
        effect: { kind: "lifegain", subject: { control: "you", token: null } },
        emits: [{ verb: "gain-life", subject: { control: "you", token: null } }],
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.kind).toBe("lifegain");
  expect(a.emits).toContainEqual({ verb: "gain-life", subject: { control: "you", token: null } });
});

test("throws on non-JSON", () => {
  expect(() => parseAbilities("not json")).toThrow(/parse/i);
});

test("drops a triggered ability whose only trigger verb is unrecognized", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "triggered", trigger: { verbs: ["explodes"], subject: { control: "you", token: null } }, effect: { kind: "damage" } }],
  });
  expect(parseAbilities(raw)).toEqual([]);
});

test("aliases a near-miss verb (die -> dies) in a trigger", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "triggered", trigger: { verbs: ["die"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "drain" } }],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.verbs).toEqual(["dies"]);
});

test("drops an emit with an unrecognized verb, keeps the ability and valid emits", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
        effect: { kind: "top-manipulation" },
        emits: [
          { verb: "put-on-top", subject: { control: "you", token: null } },
          { verb: "draw", subject: { control: "you", token: null } },
        ],
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.emits).toEqual([{ verb: "draw", subject: { control: "you", token: null } }]);
});

test("aliases a near-miss effect.kind to its canonical label", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "activated", cost: "Sacrifice a creature", effect: { kind: "counter-added" } }],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.kind).toBe("counter-placement");
});

test("drops an ability whose effect.kind is unknown after aliasing, keeps valid ones", () => {
  const raw = JSON.stringify({
    abilities: [
      { kind: "static", effect: { kind: "trample" } }, // keyword mistaken for an ability
      { kind: "static", effect: { kind: "token-doubling" } },
    ],
  });
  const abilities = parseAbilities(raw);
  expect(abilities).toHaveLength(1);
  expect(abilities[0].effect.kind).toBe("token-doubling");
});

test("normalizes missing/unknown control and token instead of throwing", () => {
  // LLM omits token and uses an unknown control word.
  const raw = JSON.stringify({
    abilities: [{ kind: "static", effect: { kind: "lord", subject: { subtype: "wizard", control: "mine" } } }],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.subject!.control).toBe("you"); // unknown -> default you
  expect(a.effect.subject!.token).toBe(null); // missing -> null (any)
});

test("maps opponent synonyms to opp and coerces stray token to null", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["dies"], subject: { type: "creature", control: "each opponent", token: "null" } },
        effect: { kind: "drain" },
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.subject.control).toBe("opp");
  expect(a.trigger!.subject.token).toBe(null);
});

test("throws when triggered ability lacks a trigger", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "triggered", effect: { kind: "damage" } }] });
  expect(() => parseAbilities(raw)).toThrow(/trigger/i);
});

test("reclassifies non-card-type values from type into subtype (tribal-spell subjects)", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: { type: ["faerie", "wizard"], control: "you", token: null } },
        effect: { kind: "copy-spell" },
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.subject.type).toBeUndefined();
  expect(a.trigger!.subject.subtype).toEqual(["faerie", "wizard"]);
});

test("keeps real card types in type, moves only the stray subtype", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: { type: ["creature", "goblin"], control: "you", token: null } },
        effect: { kind: "damage" },
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.subject.type).toBe("creature"); // single real type collapses to string
  expect(a.trigger!.subject.subtype).toBe("goblin");
});

test("accepts a flicker effect that emits an enters event", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["enters"], subject: { control: "you", token: null } },
        effect: { kind: "flicker", subject: { type: "creature", control: "you", token: null } },
        emits: [{ verb: "enters", subject: { type: "creature", control: "you", token: null } }],
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.kind).toBe("flicker");
  expect(a.emits).toEqual([{ verb: "enters", subject: { type: "creature", control: "you", token: null } }]);
});

test("aliases blink to flicker", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null } }, effect: { kind: "blink" } }],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.kind).toBe("flicker");
});

test("accepts an untap effect and the untaps verb, aliasing untap -> untaps", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "activated",
        cost: "{T}",
        effect: { kind: "untap", subject: { type: "permanent", control: "you", token: null } },
        emits: [{ verb: "untap", subject: { type: "permanent", control: "you", token: null } }],
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.kind).toBe("untap");
  expect(a.emits).toEqual([{ verb: "untaps", subject: { type: "permanent", control: "you", token: null } }]);
});

test("accepts an animate effect with no emit", () => {
  const raw = JSON.stringify({
    abilities: [{ kind: "activated", cost: "{3}{W}{U}", effect: { kind: "animate", subject: { type: "land", control: "you", token: null } } }],
  });
  const [a] = parseAbilities(raw);
  expect(a.effect.kind).toBe("animate");
  expect(a.emits).toBeUndefined();
});

test("accepts array-valued type/subtype (OR)", () => {
  const raw = JSON.stringify({
    abilities: [
      {
        kind: "triggered",
        trigger: { verbs: ["cast"], subject: { type: ["instant", "sorcery"], control: "you", token: false } },
        effect: { kind: "player-damage", subject: { subtype: ["faerie", "wizard"], control: "you", token: null } },
      },
    ],
  });
  const [a] = parseAbilities(raw);
  expect(a.trigger!.subject.type).toEqual(["instant", "sorcery"]);
  expect(a.effect.subject!.subtype).toEqual(["faerie", "wizard"]);
});

// parseAbilities is already imported at the top of validate.test.ts — do not re-import.
// It takes a JSON STRING of shape { "abilities": [ ... ] } and returns Ability[].
const parse = (abilities: unknown[]) => parseAbilities(JSON.stringify({ abilities }));

test("effect.scaling: known base passes through", () => {
  const out = parse([
    { kind: "triggered", trigger: { verbs: ["dies"], subject: { control: "you", token: null } },
      effect: { kind: "drain", scaling: "per-creature" } },
  ]);
  expect(out[0].effect.scaling).toBe("per-creature");
});

test("effect.scaling: alias normalizes; unknown falls back to fixed; absent stays unset", () => {
  const aliased = parse([{ kind: "static", effect: { kind: "drain", scaling: "devotion" } }]);
  expect(aliased[0].effect.scaling).toBe("per-permanent");

  const unknown = parse([{ kind: "static", effect: { kind: "drain", scaling: "banana" } }]);
  expect(unknown[0].effect.scaling).toBe("fixed");

  const absent = parse([{ kind: "static", effect: { kind: "drain" } }]);
  expect(absent[0].effect.scaling).toBeUndefined();
});

test("parses an on-cast ability (producer-only, effect + emits, no trigger)", () => {
  const [a] = parseAbilities(JSON.stringify({
    abilities: [{
      kind: "on-cast",
      effect: { kind: "top-manipulation", subject: { control: "opp", token: null } },
      emits: [{ verb: "mill", subject: { control: "opp", token: null } }],
    }],
  }));
  expect(a.kind).toBe("on-cast");
  expect(a.trigger).toBeUndefined();
  expect(a.emits).toHaveLength(1);
});

test("an on-cast ability drops a stray trigger (must be producer-only)", () => {
  const [a] = parseAbilities(JSON.stringify({
    abilities: [{
      kind: "on-cast",
      trigger: { verbs: ["cast"], subject: { control: "you" } },
      effect: { kind: "draw-card" },
    }],
  }));
  expect(a.kind).toBe("on-cast");
  expect(a.trigger).toBeUndefined();
});

test("VERB_VOCAB includes the leaves zone-transition verb", () => {
  expect(VERB_VOCAB).toContain("leaves");
});

test("proliferate is a verb and an effect kind", () => {
  expect(VERB_VOCAB).toContain("proliferate");
  expect(EFFECT_KINDS as readonly string[]).toContain("proliferate");
});

test("validateSubject keeps a well-formed value StatPredicate", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null, stats: [{ metric: "power", op: "lte", value: 2 }] } }, effect: { kind: "draw-card" } }] });
  const out = parseAbilities(raw);
  expect(out[0].trigger!.subject.stats).toEqual([{ metric: "power", op: "lte", value: 2 }]);
});

test("validateSubject keeps a well-formed relational StatPredicate", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "static", effect: { kind: "damage-multiplier", subject: { type: "creature", control: "you", token: null, stats: [{ metric: "toughness", op: "gte", vs: "power" }] } } }] });
  const out = parseAbilities(raw);
  expect(out[0].effect.subject!.stats).toEqual([{ metric: "toughness", op: "gte", vs: "power" }]);
});

test("validateSubject drops a StatPredicate with neither value nor vs, and unknown metric/op", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { control: "you", token: null, stats: [{ metric: "power", op: "lte" }, { metric: "speed", op: "lte", value: 1 }, { metric: "power", op: "under", value: 1 }] } }, effect: { kind: "draw-card" } }] });
  const out = parseAbilities(raw);
  expect(out[0].trigger!.subject.stats).toBeUndefined(); // all three dropped → no stats field
});

test("validateSubject leaves stats absent when not provided (no regression)", () => {
  const raw = JSON.stringify({ abilities: [{ kind: "triggered", trigger: { verbs: ["enters"], subject: { type: "creature", control: "you", token: null } }, effect: { kind: "draw-card" } }] });
  const out = parseAbilities(raw);
  expect(out[0].trigger!.subject.stats).toBeUndefined();
});
