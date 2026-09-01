import type { GraphNode } from "../types.js";

/** Position means synergy and nothing else now (board-force.ts), so a card's FACETS -- what it is,
 *  what colours it runs, what job it does, what it costs -- are paint over that one geometry. A
 *  paint mode is a pure function from a node's own fields to hues, so switching one is a restyle
 *  and never a re-simulation.
 *
 *  Deliberately NOT a "group cards that share a value" force. That is what rooms were, and a room
 *  force spends the layout on one facet permanently: cards of the same type do not bundle any more,
 *  they are coloured. */
export interface PaintMode {
  id: string;
  label: string;
  /** The values this card carries under this mode, in draw order. A card can carry several (an
   *  Artifact Creature, a Golgari card, a card that both ramps and draws) -- each becomes one arc
   *  on the card's rim, which is where the old room-membership rim went and why it survived the
   *  retirement. Empty means the mode has nothing to say about this card. */
  values(n: GraphNode): string[];
  hue(value: string): string;
  valueLabel(value: string): string;
}

/** The sixth arc when a card carries more than six values. Six is rimArcs' legibility floor (60
 *  degrees is ~10px of stroke at a 14px disc) and a WUBRG card already carries five. Neutral on
 *  purpose -- it means "and more", not a value. */
export const OVERFLOW_HUE = "#6b7280";

/** Which hues a card's rim actually shows, capped at six. Two painters consume the rule: rimArcs
 *  converts these to angles for miniature mode, and GraphView's card mode converts them to
 *  equal-width bars along the card's bottom edge. One cap, one place. */
export function rimHues(hues: readonly string[]): string[] {
  return hues.length > 6 ? [...hues.slice(0, 5), OVERFLOW_HUE] : [...hues];
}

/** The card disc's rim, split into one equal arc per hue given. Takes hues, not values: this is
 *  pure geometry with no business knowing what a paint mode is. Angles are radians from 12
 *  o'clock, clockwise, covering the full circle. */
export function rimArcs(hues: readonly string[]): Array<{ hue: string; from: number; to: number }> {
  const shown = rimHues(hues);
  if (shown.length === 0) return [];
  const step = (Math.PI * 2) / shown.length;
  const start = -Math.PI / 2;
  return shown.map((hue, i) => ({ hue, from: start + i * step, to: start + (i + 1) * step }));
}

/** Dark-surface categorical hues, carried over verbatim from the retired rooms' ROOM_HUE.
 *
 *  These are the result of a farthest-point + local search over an OKLCH grid, scored by worst
 *  colour-vision-deficient deltaE across all 15 pairs among the six non-fallback roles, subject to
 *  a hard normal-vision floor on every pair and >=3:1 contrast against the #14171b surface. They
 *  are stroke colours (a 2.5px rim arc), so the target was WCAG's graphic-object floor, not the
 *  4.5:1 body-text one. Do not reassign or repick without re-running that search -- the full
 *  method is in `2026-08-04-circle-rooms` task-8-report.md. */
export const ROLE_HUE: Record<string, string> = {
  strategy: "#1c8db7",
  wincons: "#b08e1d",
  cardAdvantage: "#5b40f6",
  ramp: "#146d9e",
  lands: "#21a28f",
  interaction: "#277310",
  boardWipes: "#6b89f9",
};

/** The two hues the flow view paints direction with: `down` is what the clicked card FEEDS, `up` is
 *  what feeds IT.
 *
 *  Both are taken from ROLE_HUE above rather than picked fresh. That palette is the output of a
 *  farthest-point search over an OKLCH grid scored by worst colour-vision-deficient deltaE, subject
 *  to a hard 3:1 contrast floor against the #14171b surface -- so these two are already known to
 *  separate for a CVD viewer and to clear the graphic-object contrast floor as strokes. Picking a
 *  fresh pair would mean asserting both properties without re-running that search.
 *
 *  `lands` (teal) and `wincons` (amber) are the pair: both come from the validated seven-hue
 *  palette and read as visibly distinct on a 2.5px rim arc, so the two directions cannot be
 *  confused at a glance -- no ΔE search was run to rank them against the other five pairings.
 *  They do double duty as role hues, which is not a conflict -- the role paint mode and the flow
 *  view never draw the same rim at the same time (GraphView overrides `hues` for cards in the
 *  flow). */
export const FLOW_HUE = { up: ROLE_HUE.lands, down: ROLE_HUE.wincons } as const;

/** HUE CARRIES THE MECHANISM INSIDE A FLOW, and direction moves to the dash.
 *
 *  Owner, 2026-08-27, looking at a selected token's flow: "cool that I can see all the events
 *  flowing, but even as an experienced Magic player this tells me nothing, I cannot distinguish
 *  them." Forty edges lit in TWO colours, and those two encoded only up/down — so every mechanism
 *  in the flow looked alike and the board read as "everything connects to everything".
 *
 *  A CATEGORICAL PALETTE WORKS HERE AND DOES NOT WORK GLOBALLY, which is the measurement that
 *  decides it. The corpus has ~20 event verbs and a categorical scale holds 6-8 before the colours
 *  stop being tellable apart — so a deck-wide hue-per-event really would be a rainbow. But inside
 *  ONE card's flow, measured over four decks: **p50 2-7 distinct events, p90 3-9, max 9.** The
 *  typical flow needs two to seven hues, which is exactly what a validated palette can give.
 *
 *  THE SAME SEVEN, NOT A FRESH PICK. `ROLE_HUE` is the output of a farthest-point search over an
 *  OKLCH grid scored by worst colour-vision-deficient deltaE, under a hard 3:1 contrast floor
 *  against the surface — so these are already known to separate for a CVD viewer and to clear the
 *  contrast floor as strokes. Choosing new hues would mean asserting both properties without
 *  re-running that search. The first two are `FLOW_HUE`'s own pair, so the common two-event flow
 *  looks like it always did.
 *
 *  BEYOND SEVEN IS NEUTRAL AND SAID SO. The p90 flow on the busiest deck carries nine, and a hue
 *  nobody can name is worse than an admitted "everything else" — the legend labels the remainder
 *  rather than minting two more colours the eye cannot separate. */
export const FLOW_EVENT_HUES: readonly string[] = [
  ROLE_HUE.lands, ROLE_HUE.wincons, ROLE_HUE.cardAdvantage, ROLE_HUE.interaction,
  ROLE_HUE.boardWipes, ROLE_HUE.strategy, ROLE_HUE.ramp,
];

/** The crawling dash on a flow edge: `on`/`off` in SCREEN pixels, `speed` in screen pixels per
 *  second. Direction is carried by the motion, so these three numbers are the whole encoding --
 *  they live here, beside the hues, so tuning never touches the paint loop. Starting values were
 *  set on the running board (see the design doc's §4). */
export const FLOW_DASH = { on: 6, off: 6, speed: 30 } as const;

/** The engine's build categories, grouped into the six functional roles a deck is read by, plus
 *  the `strategy` fallback for a card with no role at all. Carried over from the retired ROOMS:
 *  the grouping is what makes "removal" and "counterspells" one answer-shaped fact rather than two
 *  hues a reader has to reconcile. Order is the order the legend lists them in. */
export const ROLE_GROUPS: { id: string; label: string; categories: string[] }[] = [
  { id: "wincons", label: "Win conditions", categories: ["burn", "tutor"] },
  { id: "cardAdvantage", label: "Card advantage", categories: ["draw", "cardSelection", "impulseDraw"] },
  { id: "ramp", label: "Ramp", categories: ["ramp"] },
  { id: "lands", label: "Lands", categories: ["lands"] },
  { id: "interaction", label: "Interaction", categories: ["targetedRemoval", "stackInteraction", "protection", "stax"] },
  { id: "boardWipes", label: "Board wipes", categories: ["boardWipe"] },
  { id: "strategy", label: "Strategy", categories: [] },
];

const ROLE_OF_CATEGORY = new Map<string, string>(
  ROLE_GROUPS.flatMap((g) => g.categories.map((c) => [c, g.id] as const)),
);
const ROLE_LABEL = new Map(ROLE_GROUPS.map((g) => [g.id, g.label]));

/** Plain-language names for the categories whose engine key is jargon. "Card selection" means
 *  scry/surveil/look-at-the-top-N -- digging without drawing -- while "impulse draw" is the exiled
 *  cards you may cast, usually only this turn (I5, 2026-08-25: the two were one category, and the
 *  selection pattern's own third alternative was the impulse template). "Stack
 *  interaction" is one letter from "stax" while meaning something unrelated. Shown on hover.
 *  "Stax", "tutor" and "ramp" are Magic slang, not English words, so they get entries too.
 *  "Protection", "draw" and "lands" are left untranslated: they already describe themselves
 *  correctly to a non-Magic player. */
const PLAIN: Record<string, string> = {
  cardSelection: "digging",
  impulseDraw: "cast from exile",
  stackInteraction: "counterspells",
  targetedRemoval: "removal",
  boardWipe: "board wipe",
  burn: "burn & drain",
  stax: "taxes & locks",
  tutor: "deck search",
  ramp: "extra mana",
};

export function subcategoryLabel(category: string): string {
  return PLAIN[category] ?? category;
}

/** Card types, in the order the palette assigns hues. The list is closed (Magic prints new types
 *  about once a decade) so a fixed table beats hue-by-frequency: a creature is the same colour in
 *  every deck, which a by-count assignment could not promise. Anything unlisted -- `kindred`, or a
 *  type printed after this was written -- falls through to OVERFLOW_HUE rather than shifting every
 *  other type's colour. */
export const TYPE_HUE: Record<string, string> = {
  creature: "#277310",
  land: "#21a28f",
  artifact: "#8d949f",
  enchantment: "#1c8db7",
  instant: "#5b40f6",
  sorcery: "#6b89f9",
  planeswalker: "#b08e1d",
  battle: "#a3446e",
};

/** THE DONUT'S OWN STEPS, and it is not `TYPE_HUE`. That table is correct for the board, where a
 *  node carries card art, a label and a position, and colour is one cue among four. A donut has
 *  colour and nothing else, and `TYPE_HUE` fails three checks as a donut palette when run through
 *  the categorical validator against this app's dark surface: `artifact #8d949f` has chroma 0.018
 *  and reads grey; artifact against land is dE 2.6 for a deuteranope; enchantment against land is
 *  dE 10.1 for NORMAL colour vision, which is below the floor where a full-colour reader can tell
 *  a pair apart.
 *
 *  Dropping land removes both land pairs (it is not a slice -- see `deck-shape.ts`), and artifact
 *  is re-stepped to a rose that clears every check. Verified all-pairs, dark, surface #16111f:
 *  lightness band, chroma floor, CVD separation (worst 11.6 protan), normal-vision floor (worst
 *  18.3) and contrast all PASS.
 *
 *  CEILING: this leaves `artifact` two colours in one product -- rose here, grey on the board.
 *  Re-stepping `TYPE_HUE` globally would fix the board's own failing pairs too, and is the better
 *  end state, but it changes how every existing graph looks and is the owner's call. */
export const DONUT_HUE: Record<string, string> = {
  creature: "#277310",
  planeswalker: "#b08e1d",
  artifact: "#c05a72",
  enchantment: "#1c8db7",
  spells: "#5b40f6",
};

/** WUBRG, by the game's own convention rather than by the palette search above: a blue card has to
 *  read as blue. Black is the one that cannot be literal -- a black disc on a #14171b surface is
 *  invisible -- so it takes the purple-grey that Magic's own dark-mode UIs use. `C` is colourless,
 *  a real value and not an absence: a deck's artifacts are a thing to see. */
export const IDENTITY_HUE: Record<string, string> = {
  W: "#e9e0c6",
  U: "#3d7ed6",
  B: "#9b7fa8",
  R: "#d4573a",
  G: "#3f9e5c",
  C: "#8d949f",
};

const IDENTITY_LABEL: Record<string, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green", C: "Colourless",
};

/** Mana value is ORDERED, so it gets a sequential ramp and not a categorical palette -- the eye
 *  should read "more" going one way. Monotone in lightness so it survives greyscale and colour
 *  blindness alike. Index is the bucket, 0..7. */
export const CMC_RAMP = [
  "#cfe8f5", "#a5d3ec", "#7bbde2", "#5b9fd4", "#4b7fc4", "#4a5db3", "#48409e", "#3f2c7d",
];

/** 7+ is a bucket, not a value: a deck's 9-drop and its 12-drop are the same fact about the curve,
 *  and the ramp has to end somewhere. */
export function cmcBucket(cmc: number): string {
  return cmc >= 7 ? "7+" : String(Math.max(0, Math.trunc(cmc)));
}

export function cmcRamp(cmc: number): string {
  return CMC_RAMP[Math.min(CMC_RAMP.length - 1, Math.max(0, Math.trunc(cmc)))];
}

export const PAINT_MODES: PaintMode[] = [
  {
    id: "type", label: "Type",
    values: (n) => n.types ?? [],
    hue: (v) => TYPE_HUE[v] ?? OVERFLOW_HUE,
    valueLabel: (v) => v,
  },
  {
    id: "identity", label: "Identity",
    // A colourless card is `C`, not nothing -- otherwise every artifact and every basic-less land
    // silently drops out of the legend it is a real member of.
    values: (n) => (n.colors?.length ? n.colors : ["C"]),
    hue: (v) => IDENTITY_HUE[v] ?? OVERFLOW_HUE,
    valueLabel: (v) => IDENTITY_LABEL[v] ?? v,
  },
  {
    id: "role", label: "Role",
    // Roles are the engine's build categories; they group into the six functional roles plus the
    // `strategy` fallback, exactly as the retired role rooms did.
    values: (n) => {
      const hit: string[] = [];
      for (const role of n.roles ?? []) {
        const group = ROLE_OF_CATEGORY.get(role);
        if (group && !hit.includes(group)) hit.push(group);
      }
      return hit.length > 0 ? hit : ["strategy"];
    },
    hue: (v) => ROLE_HUE[v] ?? OVERFLOW_HUE,
    valueLabel: (v) => ROLE_LABEL.get(v) ?? v,
  },
  {
    id: "manaValue", label: "Mana value",
    values: (n) => [cmcBucket(n.cmc ?? 0)],
    hue: (v) => cmcRamp(v === "7+" ? 7 : Number(v)),
    valueLabel: (v) => v,
  },
];

/** The hues one card shows under one mode, capped and ready to paint. */
export function paintHues(mode: PaintMode, n: GraphNode): string[] {
  return rimHues(mode.values(n).map((v) => mode.hue(v)));
}

export interface LegendRow { value: string; label: string; hue: string; count: number }

/** What the colours mean, for the deck in front of you: one row per value actually present,
 *  counting COPIES rather than distinct names (a 24-Mountain deck's Lands row reads 24, which is
 *  the number a build target would be compared against).
 *
 *  Ordered by count descending, ties broken on the value, EXCEPT for modes whose values have a
 *  natural order of their own -- role has a declared order and mana value is a number line, and
 *  sorting either by popularity would make the legend jump between decks. */
export function paintLegend(mode: PaintMode, nodes: readonly GraphNode[]): LegendRow[] {
  const count = new Map<string, number>();
  for (const n of nodes) {
    for (const v of mode.values(n)) count.set(v, (count.get(v) ?? 0) + (n.copies ?? 1));
  }
  const rows = [...count].map(([value, c]) => ({
    value, label: mode.valueLabel(value), hue: mode.hue(value), count: c,
  }));
  if (mode.id === "role") {
    const order = ROLE_GROUPS.map((g) => g.id);
    return rows.sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value));
  }
  if (mode.id === "manaValue") {
    const n = (v: string) => (v === "7+" ? 7 : Number(v));
    return rows.sort((a, b) => n(a.value) - n(b.value));
  }
  return rows.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}
