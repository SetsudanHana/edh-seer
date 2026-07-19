import {
  EFFECT_ALIASES,
  EFFECT_KINDS,
  VERB_ALIASES,
  VERB_VOCAB,
  type Ability,
  type AbilityKind,
  type Control,
  type Effect,
  type EffectKind,
  type GameEvent,
  type SubjectFilter,
  type Verb,
} from "./schema.js";

const KINDS: readonly AbilityKind[] = ["triggered", "activated", "static"];
const CONTROLS: readonly Control[] = ["you", "opp", "any"];
const VERBS = new Set<string>(VERB_VOCAB);
const EFFECTS = new Set<string>(EFFECT_KINDS);

export function parseAbilities(raw: string): Ability[] {
  let root: unknown;
  try {
    root = JSON.parse(extractJsonObject(raw));
  } catch (err) {
    throw new Error(`Ability JSON parse failed: ${(err as Error).message}`);
  }
  const abilities = (root as { abilities?: unknown }).abilities;
  if (!Array.isArray(abilities)) {
    throw new Error('Ability JSON missing "abilities" array');
  }
  // An ability whose effect.kind is unknown after aliasing is dropped (returns null), not thrown:
  // it is almost always a keyword the model mistook for an ability, and one bad label should not
  // sink an otherwise-valid card.
  return abilities.map((a, i) => validateAbility(a, i)).filter((a): a is Ability => a !== null);
}

/** Pull the abilities JSON object out of a raw completion that may be wrapped in a reasoning
 *  block (<think>...</think>), code fences, or prose — the case when format:"json" is off (e.g.
 *  reasoning models) or a chat model adds commentary. Slices the first balanced top-level object. */
export function extractJsonObject(raw: string): string {
  const s = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?/gi, "");
  const start = s.indexOf("{");
  if (start === -1) return s.trim();
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start).trim(); // unbalanced; let JSON.parse surface the error
}

function validateAbility(a: unknown, i: number): Ability | null {
  if (typeof a !== "object" || a === null) throw new Error(`ability[${i}] not an object`);
  const o = a as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== "string" || !KINDS.includes(kind as AbilityKind)) {
    throw new Error(`ability[${i}] invalid kind: ${String(kind)}`);
  }
  const effect = validateEffect(o.effect, i);
  if (effect === null) return null;
  const out: Ability = { kind: kind as AbilityKind, effect };

  if (kind === "triggered") {
    if (typeof o.trigger !== "object" || o.trigger === null) {
      throw new Error(`ability[${i}] triggered but missing trigger`);
    }
    const t = o.trigger as Record<string, unknown>;
    if (!Array.isArray(t.verbs) || t.verbs.length === 0) {
      throw new Error(`ability[${i}] trigger.verbs must be a non-empty array`);
    }
    // Unknown trigger verbs are dropped; if none survive, the trigger is meaningless → drop ability.
    const verbs = t.verbs.map(normVerb).filter((v): v is Verb => v !== null);
    if (verbs.length === 0) return null;
    out.trigger = { verbs, subject: validateSubject(t.subject, i) };
  }
  if (o.cost !== undefined) {
    if (typeof o.cost !== "string") throw new Error(`ability[${i}] cost must be a string`);
    out.cost = o.cost;
  }
  if (o.emits !== undefined) {
    if (!Array.isArray(o.emits)) throw new Error(`ability[${i}] emits must be an array`);
    // Emits are advisory downstream hints; drop any with an unrecognized verb rather than
    // failing the whole card (e.g. "put-on-top", which has no verb equivalent).
    out.emits = o.emits.map((e) => validateEvent(e, i)).filter((e): e is GameEvent => e !== null);
  }
  return out;
}

function validateEffect(e: unknown, i: number): Effect | null {
  if (typeof e !== "object" || e === null) throw new Error(`ability[${i}] missing effect`);
  const o = e as Record<string, unknown>;
  if (typeof o.kind !== "string" || o.kind.length === 0) {
    throw new Error(`ability[${i}] effect.kind must be a non-empty string`);
  }
  const kind = normEffectKind(o.kind);
  if (kind === null) return null; // unknown label after aliasing → drop the ability
  const out: Effect = { kind };
  if (o.subject !== undefined) out.subject = validateSubject(o.subject, i);
  return out;
}

/** Lowercase/trim, apply the alias map, and confirm membership in the closed EFFECT_KINDS set.
 *  Returns null for a label that is neither a known kind nor an alias of one. */
function normEffectKind(raw: string): EffectKind | null {
  const s = raw.trim().toLowerCase();
  if (EFFECTS.has(s)) return s as EffectKind;
  return EFFECT_ALIASES[s] ?? null;
}

function validateEvent(e: unknown, i: number): GameEvent | null {
  if (typeof e !== "object" || e === null) throw new Error(`ability[${i}] emit not an object`);
  const o = e as Record<string, unknown>;
  const verb = normVerb(o.verb);
  if (verb === null) return null;
  return { verb, subject: validateSubject(o.subject, i) };
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

/** Lowercase/trim, apply the alias map, confirm membership. Returns null for an unknown verb. */
function normVerb(v: unknown): Verb | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (VERBS.has(s)) return s as Verb;
  return VERB_ALIASES[s] ?? null;
}
