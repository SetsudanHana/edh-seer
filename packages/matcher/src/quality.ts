/** CARD QUALITY PER ROLE (spec docs/superpowers/specs/2026-09-27-card-quality-per-role-design.md;
 *  owner 2026-09-27): how well a card does ONE job -- Swords to Plowshares as removal, never "Swords"
 *  overall. Ingredients are read off data derive already wrote; one that cannot be read is MISSING
 *  (absent), never 0, because a silent wrong answer is worse than a missing one. */
import type { Ability } from "@edh-seer/tagger";
import { BUILD_CATEGORIES, detectBuildCategories, type BuildCategory } from "./build.js";
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
  return out;
}
