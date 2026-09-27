/** CARD QUALITY PER ROLE (spec docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md;
 *  owner 2026-09-27): how well a card does ONE job -- Swords to Plowshares as removal, never "Swords"
 *  overall. Ingredients are read off data derive already wrote; one that cannot be read is MISSING
 *  (absent), never 0, because a silent wrong answer is worse than a missing one. */
import type { Ability, SubjectFilter } from "@edh-seer/tagger";
import { BUILD_CATEGORIES, detectBuildCategories, type BuildCategory } from "./build.js";
import { bestPerFamily, ratesOf, spanOf, type RateFamily, type RateSpan } from "./rate.js";
import { ratePercentile } from "./rate-stats.js";
import type { DeckCard } from "./types.js";

export type Role = Exclude<BuildCategory, "lands">;
export const ROLES: readonly Role[] = BUILD_CATEGORIES.filter((c): c is Role => c !== "lands");
export type Ingredient = "manaValue" | "rateFloor" | "rateCeiling" | "frequency" | "timing" | "breadth"
  | "permanence" | "oneSided" | "drawback" | "extraValue" | "restriction";
export type Ingredients = Partial<Record<Ingredient, number>>;

export function rolesOfCard(d: DeckCard): Role[] {
  const cats = detectBuildCategories([d]);
  return ROLES.filter((r) => cats.get(r)?.has(d.card.name));
}

/** WHICH ABILITY DOES THE JOB: the effect kinds and emit verbs each role is recognised by. */
const ROLE_KINDS: Record<Role, { kinds?: readonly string[]; verbs?: readonly string[] }> = {
  ramp: { kinds: ["mana-generation", "search"] },
  draw: { kinds: ["draw-card"] },
  cardSelection: { verbs: ["scry", "surveil"], kinds: ["top-set"] },
  impulseDraw: { kinds: ["impulse-draw"], verbs: ["exiled"] },
  targetedRemoval: { verbs: ["dies", "exiled", "leaves"] },
  stackInteraction: { verbs: ["counter-spell"] },
  boardWipe: { verbs: ["dies", "exiled", "leaves"] },
  burn: { kinds: ["damage"], verbs: ["non-combat-damage"] },
  stax: { kinds: ["tax", "cant"] },
  protection: { kinds: ["keyword-grant"] },
  tutor: { kinds: ["search"] },
  graveyardHate: { verbs: ["exiled"] },
};

export function roleAbilities(d: DeckCard, role: Role): Ability[] {
  if (!rolesOfCard(d).includes(role)) return [];
  const want = ROLE_KINDS[role];
  return (d.tags?.abilities ?? []).filter((a) =>
    (want.kinds?.includes(a.effect.kind) ?? false)
    || (a.emits ?? []).some((e) => want.verbs?.includes(e.verb) ?? false));
}

/** Once 0 < per cycle 1 < per turn 2 < unbounded trigger 3 < at will 4 (owner ladder, 2026-09-23). */
function frequencyOf(a: Ability): number {
  if (a.kind === "activated") return a.repeats === "once" ? 0 : 4;
  if (a.repeats === "per-cycle") return 1;
  if (a.repeats === "per-turn") return 2;
  if (a.repeats === "repeatable" || a.repeats === "continuous") return 3;
  return 0;
}

/** Sorcery 0 < a creature's ETB 1 < instant / flash / activate any time 2 (the owner's "timing"). */
function timingOf(d: DeckCard, a: Ability): number | undefined {
  const chars = d.tags?.characteristics;
  const types = ((a.face !== undefined ? chars?.faces?.[a.face]?.types : chars?.types) ?? []).map((t) => t.toLowerCase());
  const keywords = (chars?.keywords ?? []).map((k) => k.toLowerCase());
  if (a.kind === "activated") return 2;
  if (types.includes("instant") || keywords.includes("flash")) return 2;
  if (a.kind === "triggered" && types.includes("creature")) return 1;
  if (types.includes("sorcery") || a.kind === "on-cast") return 0;
  if (a.kind === "static" || a.kind === "triggered") return 1;
  return undefined;
}

const ANSWERS: ReadonlySet<Role> = new Set(["targetedRemoval", "stackInteraction", "boardWipe"]);
const list = (v: string | string[] | undefined): string[] => (Array.isArray(v) ? v : v ? [v] : []).map((x) => x.toLowerCase());

/** How much the subject admits. Restrictions (a stat, a colour, a named subtype) narrow it. */
function breadthOf(s: SubjectFilter): number {
  const restricted = (s.stats?.length ?? 0) > 0 || s.colors !== undefined || s.subtype !== undefined;
  const types = list(s.type);
  if (types.length === 0 || types.includes("permanent") || types.includes("spell")) return restricted ? 2 : 3;
  if (types.length > 1 || list(s.notType).includes("land")) return restricted ? 1 : 2;
  return restricted ? 0 : 1;
}

/** Exile 3 > dies (destroy / sacrifice) 2 > leaves to hand 1. */
function permanenceOf(a: Ability): number | undefined {
  const verbs = (a.emits ?? []).map((e) => e.verb);
  if (verbs.includes("exiled")) return 3;
  if (verbs.includes("dies")) return 2;
  if (verbs.includes("leaves")) return 1;
  return undefined;
}

/** The yield roles and the rate families that measure them (rate.ts). */
const YIELD: Partial<Record<Role, readonly RateFamily[]>> = {
  ramp: ["mana", "search"], draw: ["cards"], tutor: ["search"], burn: ["damage"],
};
/** The same rate read at its ceiling: a trigger's floor is 0 by the interval ruling, its ceiling is what it can do. */
const ceilingSpan = (s: RateSpan): RateSpan => [s[2] ?? s[0], s[3], s[2] ?? s[0], s[3]];

/** A GIFT TO THE OPPONENT or a cost to you: the victim's token (Beast Within), life (Swords), land
 *  (Path), or your own life. */
function isDrawback(e: { verb: string; subject: { control?: string } }): boolean {
  if (e.subject.control === "opp") return e.verb === "create-token" || e.verb === "gain-life" || e.verb === "search";
  return e.verb === "lose-life" && e.subject.control === "you";
}

export function ingredients(d: DeckCard, role: Role): Ingredients {
  const abilities = roleAbilities(d, role);
  if (abilities.length === 0) return {};
  const out: Ingredients = {};
  // THE ROLE ABILITY'S OWN FACE decides: a modal spell // land is a spell for its role, and the land
  // back must not erase its mana value.
  const face = abilities.find((a) => a.face !== undefined)?.face;
  const faceTypes = (face !== undefined ? d.tags?.characteristics.faces?.[face]?.types : d.tags?.characteristics.types) ?? [];
  const mv = d.tags?.characteristics.cmc ?? d.card.manaValue;
  if (typeof mv === "number" && !faceTypes.map((t) => t.toLowerCase()).every((t) => t === "land")) out.manaValue = mv;
  const timings = abilities.map((a) => timingOf(d, a)).filter((t): t is number => t !== undefined);
  if (timings.length > 0) out.timing = Math.max(...timings);
  out.frequency = Math.max(...abilities.map(frequencyOf));
  const families = YIELD[role];
  if (families) {
    const best = bestPerFamily(ratesOf(d)).filter((r) => families.includes(r.family));
    const floors = best.map((r) => ratePercentile(spanOf(r), r.family)).filter((p): p is number => p !== undefined);
    const ceilings = best.map((r) => ratePercentile(ceilingSpan(spanOf(r)), r.family)).filter((p): p is number => p !== undefined);
    if (floors.length > 0) out.rateFloor = Math.round(100 * Math.max(...floors));
    if (ceilings.length > 0) out.rateCeiling = Math.round(100 * Math.max(...ceilings));
  }
  const all = d.tags?.abilities ?? [];
  out.drawback = all.some((a) => (a.emits ?? []).some(isDrawback)) ? 1 : 0;
  // A SECOND ABILITY WITH ITS OWN EFFECT, not a gift to the opponent (Swords' lifegain is the victim's).
  const others = all.filter((a) => !abilities.includes(a) && a.effect.kind !== ""
    && !(a.emits ?? []).some((e) => e.subject.control === "opp"));
  const types = (d.tags?.characteristics.types ?? []).map((t) => t.toLowerCase());
  out.extraValue = (types.includes("creature") ? 1 : 0) + (others.length > 0 ? 1 : 0);
  if (role === "ramp") out.restriction = /can.t be spent|spend this mana only/i.test(d.card.oracleText ?? "") ? 1 : 0;
  if (ANSWERS.has(role)) {
    const subjects = abilities.flatMap((a) => (a.emits ?? []).filter((e) => e.subject.control !== "you").map((e) => e.subject));
    if (subjects.length > 0) out.breadth = Math.max(...subjects.map(breadthOf));
    const perm = abilities.map(permanenceOf).filter((p): p is number => p !== undefined);
    if (perm.length > 0 && role !== "stackInteraction") out.permanence = Math.max(...perm);
    // CEILING: an overloaded or otherwise alternate one-sided mode (Cyclonic Rift) is not derived, so
    // such a card reads as its targeted half; upgrade path: derive the overload as its own ability.
    if (role === "boardWipe") {
      const all = abilities.flatMap((a) => a.emits ?? []).filter((e) => e.subject.scope === "all");
      if (all.length > 0) out.oneSided = all.every((e) => e.subject.control === "opp") ? 1 : 0;
    }
  }
  return out;
}
