import { readFileSync } from "node:fs";
import { EFFECT_KINDS, type Verb } from "../schema.js";
import { loadDescriptorOtags, loadFunctionalOtags } from "./functional.js";

/** oTag-native event vocabulary. Deliberately NOT the engine's Verb set: otag events are
 *  coarser, and several (regrowth, return-to-hand) have no honest Verb equivalent. The
 *  mapping to Verb is explicit in OTAG_EVENT_TO_VERB so the lossy step is visible and diffable. */
export const OTAG_EVENTS = [
  "enters", "dies", "leaves", "sacrifice", "cast", "attacks", "blocks",
  "combat-damage", "non-combat-damage", "draw", "discard", "mill",
  "gain-life", "lose-life", "create-token", "counter-added", "proliferate",
  "land-play", "untaps", "taps", "return-to-hand", "return-to-battlefield",
  "cast-from-graveyard", "cast-from-exile", "flicker", "copy", "gain-control",
  "search-library", "add-mana", "exile",
] as const;

export type OtagEvent = (typeof OTAG_EVENTS)[number];

/** Total map from otag events to the engine's Verb. null = no honest equivalent; such
 *  events cannot contribute edges and exist for classifier/weight use only. */
export const OTAG_EVENT_TO_VERB: Readonly<Record<OtagEvent, Verb | null>> = {
  enters: "enters",
  dies: "dies",
  leaves: "leaves",
  sacrifice: "sacrifice",
  cast: "cast",
  attacks: "attacks",
  blocks: null,
  "combat-damage": "combat-damage",
  "non-combat-damage": "non-combat-damage",
  draw: "draw",
  discard: "discard",
  mill: "mill",
  "gain-life": "gain-life",
  "lose-life": "lose-life",
  "create-token": "create-token",
  "counter-added": "counter-added",
  proliferate: "proliferate",
  "land-play": "land-play",
  untaps: "untaps",
  taps: "taps",
  "return-to-hand": null,
  "return-to-battlefield": "enters",
  "cast-from-graveyard": "cast",
  "cast-from-exile": null,
  flicker: "enters",
  copy: null,
  "gain-control": null,
  "search-library": null,
  "add-mana": null,
  exile: null,
};

export type OtagRole = "producer" | "consumer";
export type OtagUse = "edge" | "classifier" | "weight";

export interface SlugSemantics {
  events: Array<{ role: OtagRole; event: OtagEvent }>;
  effectKind: string | null;
  uses: OtagUse[];
  /** Set only when the slug's meaning has no member in EFFECT_KINDS — the proposed new kind
   *  name (e.g. "destroy"). Drives the gap list that feeds the forced-sacrifice change.
   *  Must NOT name a kind that already exists; effectKind must be null alongside it. */
  needsEffectKind?: string;
}

const raw = JSON.parse(
  readFileSync(new URL("./otag-semantics.json", import.meta.url), "utf8"),
) as Record<string, SlugSemantics>;

const EVENTS: ReadonlySet<string> = new Set(OTAG_EVENTS);
const KINDS: ReadonlySet<string> = new Set(EFFECT_KINDS);
const ROLES: ReadonlySet<string> = new Set(["producer", "consumer"]);
const USES: ReadonlySet<string> = new Set(["edge", "classifier", "weight"]);

/**
 * Slug -> semantics, validated on load. Descriptor slugs are synthesised as weight-only
 * rather than carrying JSON entries, since they are near-universal qualifiers with no event.
 *
 * Throws on illegal vocabulary. In particular a non-null effectKind outside EFFECT_KINDS is
 * an error, not a new kind: EFFECT_KINDS lacks sacrifice/destroy/exile/discard, and widening
 * it is a schema change belonging to the forced-sacrifice work, not to this map.
 */
export function loadOtagSemantics(): Map<string, SlugSemantics> {
  const functional = new Set(loadFunctionalOtags());
  const out = new Map<string, SlugSemantics>();

  for (const [slug, s] of Object.entries(raw)) {
    if (!functional.has(slug)) throw new Error(`otag-semantics: "${slug}" is not in the functional list`);
    for (const ev of s.events) {
      if (!EVENTS.has(ev.event)) throw new Error(`otag-semantics: "${slug}" has unknown event "${ev.event}"`);
      if (!ROLES.has(ev.role)) throw new Error(`otag-semantics: "${slug}" has unknown role "${ev.role}"`);
    }
    if (s.effectKind !== null && !KINDS.has(s.effectKind)) {
      throw new Error(`otag-semantics: "${slug}" effectKind "${s.effectKind}" is not in EFFECT_KINDS`);
    }
    if (s.needsEffectKind !== undefined) {
      if (KINDS.has(s.needsEffectKind)) {
        throw new Error(`otag-semantics: "${slug}" proposes "${s.needsEffectKind}" which already exists in EFFECT_KINDS`);
      }
      if (s.effectKind !== null) {
        throw new Error(`otag-semantics: "${slug}" sets both effectKind and needsEffectKind`);
      }
    }
    if (!s.uses.length) throw new Error(`otag-semantics: "${slug}" has no uses`);
    for (const u of s.uses) {
      if (!USES.has(u)) throw new Error(`otag-semantics: "${slug}" has unknown use "${u}"`);
    }
    // "edge" is only meaningful when some event maps to a real Verb; a null-Verb event
    // can never pair, so claiming edge would mislead every downstream consumer.
    if (s.uses.includes("edge") && !s.events.some((e) => OTAG_EVENT_TO_VERB[e.event] !== null)) {
      throw new Error(`otag-semantics: "${slug}" claims edge but no event maps to a Verb`);
    }
    out.set(slug, s);
  }

  for (const d of loadDescriptorOtags()) {
    if (out.has(d)) throw new Error(`otag-semantics: descriptor "${d}" must not have a JSON entry`);
    out.set(d, { events: [], effectKind: null, uses: ["weight"] });
  }
  return out;
}

/** Signal slugs with no semantics entry yet. Empty once Task 5 lands. */
export function unclassifiedSlugs(): string[] {
  const sem = loadOtagSemantics();
  return loadFunctionalOtags().filter((s) => !sem.has(s));
}
