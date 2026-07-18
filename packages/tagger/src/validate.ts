import {
  VERB_VOCAB,
  type Ability,
  type AbilityKind,
  type Control,
  type Effect,
  type GameEvent,
  type SubjectFilter,
  type Verb,
} from "./schema.js";

const KINDS: readonly AbilityKind[] = ["triggered", "activated", "static"];
const CONTROLS: readonly Control[] = ["you", "opp", "any"];
const VERBS = new Set<string>(VERB_VOCAB);

export function parseAbilities(raw: string): Ability[] {
  let root: unknown;
  try {
    root = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Ability JSON parse failed: ${(err as Error).message}`);
  }
  const abilities = (root as { abilities?: unknown }).abilities;
  if (!Array.isArray(abilities)) {
    throw new Error('Ability JSON missing "abilities" array');
  }
  return abilities.map((a, i) => validateAbility(a, i));
}

function validateAbility(a: unknown, i: number): Ability {
  if (typeof a !== "object" || a === null) throw new Error(`ability[${i}] not an object`);
  const o = a as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as AbilityKind)) {
    throw new Error(`ability[${i}] invalid kind: ${String(kind)}`);
  }
  const effect = validateEffect(o.effect, i);
  const out: Ability = { kind: kind as AbilityKind, effect };

  if (kind === "triggered") {
    if (typeof o.trigger !== "object" || o.trigger === null) {
      throw new Error(`ability[${i}] triggered but missing trigger`);
    }
    const t = o.trigger as Record<string, unknown>;
    if (!Array.isArray(t.verbs) || t.verbs.length === 0) {
      throw new Error(`ability[${i}] trigger.verbs must be a non-empty array`);
    }
    const verbs = t.verbs.map((v) => asVerb(v, i));
    out.trigger = { verbs, subject: validateSubject(t.subject, i) };
  }
  if (o.cost !== undefined) {
    if (typeof o.cost !== "string") throw new Error(`ability[${i}] cost must be a string`);
    out.cost = o.cost;
  }
  if (o.emits !== undefined) {
    if (!Array.isArray(o.emits)) throw new Error(`ability[${i}] emits must be an array`);
    out.emits = o.emits.map((e) => validateEvent(e, i));
  }
  return out;
}

function validateEffect(e: unknown, i: number): Effect {
  if (typeof e !== "object" || e === null) throw new Error(`ability[${i}] missing effect`);
  const o = e as Record<string, unknown>;
  if (typeof o.kind !== "string" || o.kind.length === 0) {
    throw new Error(`ability[${i}] effect.kind must be a non-empty string`);
  }
  const out: Effect = { kind: o.kind };
  if (o.subject !== undefined) out.subject = validateSubject(o.subject, i);
  return out;
}

function validateEvent(e: unknown, i: number): GameEvent {
  if (typeof e !== "object" || e === null) throw new Error(`ability[${i}] emit not an object`);
  const o = e as Record<string, unknown>;
  return { verb: asVerb(o.verb, i), subject: validateSubject(o.subject, i) };
}

function validateSubject(s: unknown, i: number): SubjectFilter {
  if (typeof s !== "object" || s === null) throw new Error(`ability[${i}] missing subject`);
  const o = s as Record<string, unknown>;
  // token/control are normalized, never rejected — a local LLM omits or varies them, and
  // dropping the whole card over a missing default loses more than a lenient default costs.
  const out: SubjectFilter = { control: normControl(o.control), token: normToken(o.token) };
  const type = strOrStrArray(o.type);
  if (type !== undefined) out.type = type;
  const subtype = strOrStrArray(o.subtype);
  if (subtype !== undefined) out.subtype = subtype;
  if (Array.isArray(o.colors)) out.colors = o.colors.filter((c): c is string => typeof c === "string");
  if (o.chosenType === true) out.chosenType = true;
  if (typeof o.counter === "string") out.counter = o.counter;
  if (typeof o.zone === "string") out.zone = o.zone;
  return out;
}

/** Normalize control to you/opp/any, mapping common LLM synonyms; default "you". */
function normControl(v: unknown): Control {
  if (typeof v === "string") {
    const s = v.toLowerCase();
    if (CONTROLS.includes(s as Control)) return s as Control;
    if (s.includes("opp") || s.includes("each player") || s.includes("target player")) return "opp";
    if (s.includes("any") || s === "anyone" || s === "target") return "any";
  }
  return "you";
}

/** Normalize token to the tri-state true/false/null; anything unclear → null (any). */
function normToken(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}

/** Accept a single type/subtype string, or a non-empty array of strings (OR). */
function strOrStrArray(v: unknown): string | string[] | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const a = v.filter((x): x is string => typeof x === "string");
    if (a.length > 0) return a;
  }
  return undefined;
}

function asVerb(v: unknown, i: number): Verb {
  if (typeof v !== "string" || !VERBS.has(v)) {
    throw new Error(`ability[${i}] invalid verb: ${String(v)}`);
  }
  return v as Verb;
}
