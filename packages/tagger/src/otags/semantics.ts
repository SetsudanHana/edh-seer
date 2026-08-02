import { readFileSync } from "node:fs";
import { EFFECT_KINDS, type Verb } from "../schema.js";
import { loadDescriptorOtags, loadFunctionalOtags } from "./functional.js";

/** oTag-native event vocabulary. Deliberately NOT the engine's Verb set: otag events are
 *  coarser, and several (return-to-hand, gain-control) have no honest Verb equivalent. The
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
/**
 * What a slug is good for. A slug can carry more than one; each has its own test, and the
 * three answer different questions. Apply the tests literally — these were written after the
 * first pass drifted, with `classifier` landing on 82% of slugs and becoming a near-no-op.
 *
 * - **edge** — drives producer/consumer pairing. Test: does the slug name a game event another
 *   card can trigger on? Enforced below: requires an event mapping to a non-null `Verb`.
 *
 * - **classifier** — feeds deck-archetype detection. Test: *if a deck ran eight cards with this
 *   slug, would you know what it is trying to do?* Only DISTINCTIVE evidence qualifies. Cards
 *   every EDH deck plays — removal, ramp, card draw, tutors, protection, keyword grants — carry
 *   no information about strategy, so they are NOT classifiers no matter how functional they
 *   are. `sacrifice-outlet-creature` yes; `removal-creature` (5359 cards) no.
 *
 * - **weight** — archetype-conditional value. Test: *would you score this card differently in
 *   aristocrats than in voltron?* Applies when the same card is worth materially more in one
 *   deck than another: evasion and keyword grants (need a board to matter), the `scales-with-*`
 *   family (scale off a deck-wide quantity), cost reduction, rate engines. A card that is
 *   simply good everywhere — ramp, removal — is not weight either.
 *
 * classifier and weight are independent: `typal-elf` is pure classifier (tells you the deck,
 * but every elf deck values it the same), `evasion` is pure weight (says nothing about the
 * strategy, but swings hard on it), `anthem` is both.
 */
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

/** Known alias pairs: verified in Mongo to tag byte-identical card sets (board-wipe/sweeper
 *  920/920, flashback/castable-from-graveyard 389/389). Classified identically here, so a
 *  consumer counting matching slugs on a card will double-count. Deduping belongs upstream
 *  in functional-otags.json; not fixed here. */

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
    // An empty `uses` is legal and meaningful: a recognised functional card that none of the
    // three consumers reads. Universal staples land here -- removal, ramp, tutors, mana rocks
    // carry no archetype signal (so not classifier) and are good in every deck (so not weight),
    // yet still earn their place in the corpus via effectKind and coverage.
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
