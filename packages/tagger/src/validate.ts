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
  if (typeof o.control !== "string" || !CONTROLS.includes(o.control as Control)) {
    throw new Error(`ability[${i}] invalid subject.control: ${String(o.control)}`);
  }
  if (!(o.token === true || o.token === false || o.token === null)) {
    throw new Error(`ability[${i}] subject.token must be true, false, or null`);
  }
  const out: SubjectFilter = { control: o.control as Control, token: o.token as boolean | null };
  if (typeof o.type === "string") out.type = o.type;
  if (typeof o.subtype === "string") out.subtype = o.subtype;
  if (Array.isArray(o.colors)) out.colors = o.colors.filter((c): c is string => typeof c === "string");
  if (o.chosenType === true) out.chosenType = true;
  return out;
}

function asVerb(v: unknown, i: number): Verb {
  if (typeof v !== "string" || !VERBS.has(v)) {
    throw new Error(`ability[${i}] invalid verb: ${String(v)}`);
  }
  return v as Verb;
}
