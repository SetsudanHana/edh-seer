import { expect, test } from "vitest";
import { parseAbilities, extractJsonObject } from "./validate.js";

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
