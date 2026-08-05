/** Authored SVG-path glyphs for non-card graph nodes (`event:`, and eventually other kinds).
 *
 *  Card nodes get rendered as art crops (a later task); every other node needs something more
 *  legible than an anonymous dot. Every value here is a plain SVG path-data STRING, not a
 *  `Path2D` -- `Path2D` is a browser/canvas global with no polyfill in this repo's test
 *  environment, so nothing browser-specific gets constructed at import time. The render call
 *  site (Task 5's `GraphView`) does `ctx.stroke(new Path2D(glyphFor(node)))`; that is where the
 *  string turns into a real `Path2D`, once, at stroke time. No DOM, no icon library, no emoji/icon
 *  font (standing DESIGN.md ban) either way. Colour is applied at render time too; this module
 *  only supplies geometry.
 *
 *  Every path is drawn in a 24x24 box, stroke-only, matching the grammar of
 *  `ComboList.tsx`'s `ArrowIcon` (round caps/joins, weight 2, no fill) -- that styling lives on
 *  the canvas context at stroke time, not baked into these strings.
 *
 *  Some glyphs are shared across keys on purpose: `dies`/`enters-graveyard` are the same picture
 *  (a creature dying IS a card hitting the graveyard), and so are the verb/effect-kind pairs that
 *  name the same action twice (`draw`/`draw-card`, `sacrifice`/`forced-sacrifice`, etc). Sharing
 *  is fine; silently falling back for an uncovered key is not -- see the test. */

/** A four-point sparkle, used for `cast`. */
const CAST = "M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8Z";

/** Downward arrow into a baseline -- something joining the battlefield. */
const ENTERS = "M12 3v12m-5-5 5 5 5-5M4 21h16";

/** Upward arrow out of a baseline -- the mirror of ENTERS, something leaving. */
const LEAVES = "M12 21V9m-5 5 5-5 5 5M4 3h16";

/** A headstone: shared by `dies` and `enters-graveyard`, which are the same event from two verbs. */
const GRAVEYARD = "M6 21V10a6 6 0 0 1 12 0v11M3 21h18";

/** A headstone with a card rising back out of it -- recursion, the reverse of GRAVEYARD. */
const GRAVEYARD_RECURSION = "M6 21V13a6 6 0 0 1 12 0v8M3 21h18M12 10V4m-3 3 3-3 3 3";

/** A diagonal thrust -- motion toward a target. */
const ATTACKS = "M4 20 20 4M13 4h7v7";

/** A blade catching an impact at its tip -- damage actually connecting, distinct from ATTACKS'
 *  plain motion. */
const COMBAT_DAMAGE = "M5 19 15 9M15 9l2-4M15 9l4 2M15 9l1-3.2M15 9l3.2-1";

/** A generic starburst -- damage/lifeloss with no combat attached. */
const BURST = "M12 2v20M4.9 4.9 19.1 19.1M19.1 4.9 4.9 19.1M2 12h20";

/** Clockwise rotate arrow -- a permanent turning sideways. */
const TAPS = "M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5";

/** Counter-clockwise rotate arrow -- the mirror of TAPS. */
const UNTAPS = "M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5";

/** A card moving toward the viewer -- shared by `draw` and `draw-card`. */
const DRAW = "M4 6h9v14H4zM17 13l4-4m0 0-4-4m4 4h-8";

/** A card with a downward arrow -- hand to graveyard. */
const DISCARD = "M3 3h11v18H3zM20 8v9m-3-3 3 3 3-3";

/** Two stacked cards with a downward arrow -- library to graveyard, several at once. */
const MILL = "M4 3h9v6H4zM4 11h9v6H4zM20 9v10m-3-3 3 3 3-3";

/** A heart with a plus -- shared by `gain-life` and `lifegain`. */
const LIFEGAIN =
  "M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9zM12 9v4m-2-2h4";

/** A heart with a minus -- the loss mirror of LIFEGAIN. */
const LOSE_LIFE =
  "M12 21s-7-4.5-9.5-9A5.5 5.5 0 0 1 12 6a5.5 5.5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9zM9 11h6";

/** A dagger over an altar -- shared by `sacrifice` and `forced-sacrifice`. */
const SACRIFICE = "M12 2v14M9 5l3-3 3 3M8 20h8M10 20v-4h4v4";

/** A card with a plus -- something new entering play; shared by `create-token` and
 *  `token-generation`, which name the same action from two vocabularies. */
const CREATE_TOKEN = "M4 4h16v16H4zM12 9v6m-3-3h6";

/** A plus inside a circle -- shared by `counter-added` and `counter-placement`. */
const COUNTER = "M12 3a9 9 0 1 0 .001 0zM12 8v8m-4-4h8";

/** A simple landscape -- playing a land. */
const LAND_PLAY = "M3 19 9 9l4 5 3-4 5 9zM3 19h18";

/** Several small plus-ticks scattered -- adding one more counter to everything that already
 *  has one, rather than one plus in one place. */
const PROLIFERATE = "M6 8v4m-2-2h4M14 14v4m-2-2h4M18 6v4m-2-2h4";

/** A dumbbell -- a stat boost. */
const PUMP = "M4 12h16M4 9v6M20 9v6M7 7v10M17 7v10";

/** A cut gem -- mana coming from nowhere. */
const MANA_GENERATION = "M12 2 4 9l8 13 8-13z M4 9h16";

/** An open box with a swapped top item -- rearranging what a library reveals from the top. */
const TOP_MANIPULATION =
  "M5 8h14v12H5zM8 8V5a3 3 0 0 1 3-3h2a3 3 0 0 1 3 3v3M12 12v4m-2-2 2-2 2 2";

/** A coin with an up arrow -- a cost going up. */
const TAX = "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 17V9m-3 3 3-3 3 3";

/** A coin with a down arrow -- the mirror of TAX, a cost going down. */
const COST_REDUCTION = "M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 7v8m-3-3 3 3 3-3";

/** A sun rising over a horizon -- the beginning of a turn's upkeep step. */
const UPKEEP = "M12 3v4m-7 5h14M6 21a6 6 0 0 1 12 0";

/** Two crossed blades -- the beginning of combat, distinct from ATTACKS' single directed thrust. */
const BEGIN_COMBAT = "M4 4l16 16M20 4 4 20";

/** A crescent moon -- the end step, the mirror of UPKEEP's sunrise. */
const END_STEP = "M15 3a9 9 0 1 0 0 18 7 7 0 0 1 0-18z";

/** A generic ring: the fallback for any tag prefix this module doesn't recognize. Deliberately
 *  a plain circle with no interior mark, so it can never be confused with COUNTER (circle+plus)
 *  or any other authored glyph. */
export const FALLBACK = "M12 3a9 9 0 1 0 .01 0z";

/** All 35 required glyphs: the 23 `VERB_VOCAB` members (`@mtg/tagger`) plus the top-12 effect
 *  kinds by corpus occurrence. Keyed by the string that appears as the tag prefix on an `event:`
 *  node id (see `glyphFor`), not by any display name. Values are SVG path-data strings -- pass
 *  one to `new Path2D(...)` at the canvas call site to get something `ctx.stroke()` can draw. */
export const GLYPH: Record<string, string> = {
  // VERB_VOCAB (23)
  enters: ENTERS,
  "enters-graveyard": GRAVEYARD,
  dies: GRAVEYARD,
  leaves: LEAVES,
  cast: CAST,
  attacks: ATTACKS,
  taps: TAPS,
  "non-combat-damage": BURST,
  "combat-damage": COMBAT_DAMAGE,
  draw: DRAW,
  discard: DISCARD,
  mill: MILL,
  "gain-life": LIFEGAIN,
  "lose-life": LOSE_LIFE,
  sacrifice: SACRIFICE,
  "create-token": CREATE_TOKEN,
  "counter-added": COUNTER,
  "land-play": LAND_PLAY,
  untaps: UNTAPS,
  proliferate: PROLIFERATE,
  upkeep: UPKEEP,
  "begin-combat": BEGIN_COMBAT,
  "end-step": END_STEP,

  // top-12 effect kinds by corpus occurrence
  pump: PUMP,
  "token-generation": CREATE_TOKEN,
  "draw-card": DRAW,
  "counter-placement": COUNTER,
  "mana-generation": MANA_GENERATION,
  "graveyard-recursion": GRAVEYARD_RECURSION,
  "top-manipulation": TOP_MANIPULATION,
  damage: BURST,
  "forced-sacrifice": SACRIFICE,
  lifegain: LIFEGAIN,
  tax: TAX,
  "cost-reduction": COST_REDUCTION,
};

/** Resolve an `event:` node to its glyph's SVG path-data string, by tag prefix. Event tags come
 *  in two shapes (see `packages/matcher/src/edges.ts` and `zones.ts`):
 *   - `<verb>:<subject>` for trigger/emit edges, e.g. `enters:creature`, `dies:any` -- the prefix
 *     IS the `VERB_VOCAB` member and is looked up directly.
 *   - `static:<effectKind>` for static-ability edges, e.g. `static:pump` -- the prefix is the
 *     literal string "static" and the effect kind is the second segment.
 *  `graveyard-recursion:<subject>` is the one effect kind that appears bare (matcher's reanimator-
 *  consumer edge), so it's already handled by the first case.
 *
 *  Only `node.id` is used -- the narrowest shape this needs, so it works against any node-like
 *  object the client holds (the wire `GraphNode` from `@mtg/matcher`, a test fixture, etc).
 *
 *  Returns a path string, not a `Path2D` -- construct one with `new Path2D(glyphFor(node))` at
 *  the canvas call site. */
export function glyphFor(node: { id: string }): string {
  const tag = node.id.startsWith("event:") ? node.id.slice("event:".length) : node.id;
  const [prefix, second] = tag.split(":");
  const key = prefix === "static" ? (second ?? "") : (prefix ?? "");
  return GLYPH[key] ?? FALLBACK;
}
