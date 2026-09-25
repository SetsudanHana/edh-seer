/** THE BOARD'S PAINT PASS: one frame of the synergy graph onto its canvas.
 *
 *  Split out of `GraphView`'s layout effect (2026-09-25), where it was the `draw` closure -- 780 of
 *  that effect's 1,442 lines. It is the same routine: `GraphView` still owns the simulation, the
 *  camera, the gestures and the frame loop, and calls this once per frame with everything it reads.
 *  It writes nothing it is given; its only output is the canvas.
 *
 *  THE INPUT IS BUILT PER CALL, NOT ONCE. `dim` is reassigned on every resize and the refs are read
 *  for their current value, so the caller passes them at the moment of the frame -- exactly what the
 *  closure it replaced saw. */
import { litUndrawn } from "./board-edges.js";
import { type ArtLoader } from "./art-loader.js";
import { CARD_MODE_Z, cardImageUrl, isOnScreen, renderModeFor, shouldPrefetchCard } from "./card-node.js";
import { FLOW_DASH, FLOW_HUE, OVERFLOW_HUE, rimArcs } from "./presets.js";
import { type Flow, type FlowEdge } from "./flow.js";
import { mechanismKey } from "../lib/demand-sentence.js";
import { ART_RADIUS, CARD_H, CARD_W, nodeRadius, type Sim, type SimLink } from "./board-force.js";
import { labelCandidates, labelPriority, placeLabels } from "./labels.js";
import { HATCH } from "../lib/unread.js";

/** mana-font's `ms-ability-companion` glyph, read out of `mana.min.css` (v1.18.0) on 2026-09-22. */
const COMPANION_GLYPH = "\ue97b";

const TAU = Math.PI * 2;

/** Height, in world units, of a paint-hue bar along a card-mode card's bottom edge. The card-mode
 *  answer to a rim arc: a 5:7 rectangle has no rim to stroke arcs onto. */
const BAR_H = 3;

/** Stroke width, in world units, of the weakest and the strongest edge on the board. Weight is
 *  already spent on DISTANCE (linkDistanceFor), so this is redundancy rather than the only signal
 *  -- which is what makes a narrow range right: it has to survive a 95-node board without turning
 *  the middle into a solid sheet. */
const EDGE_W_MIN = 0.4;
const EDGE_W_MAX = 2.2;

/** Opacity of the weakest and the strongest edge. THE THIRD CHANNEL WEIGHT WAS NOT SPENDING: it
 *  already buys distance (linkDistanceFor) and width (above), while every edge on the board was
 *  painted at full opacity in a border colour -- so the mesh read as uniform grey noise and the
 *  strong relationships, which are the product, were indistinguishable from the incidental ones.
 *  A narrow floor rather than 0: a weak edge is still a real claim and must not vanish. */
const EDGE_A_MIN = 0.14;
const EDGE_A_MAX = 0.72;

/** HOVER IS A ONE-HOP PREVIEW OF THE FLOW (roadmap H8). Clicking a card was the ONLY way to see
 *  what it relates to, which is a fine report and a poor deckbuilding surface -- a player sweeping
 *  the board should be able to read a card's relations without committing to a selection. Gentler
 *  than the flow's 0.15 on purpose: a hover is a glance, so the rest of the deck stays legible
 *  behind it rather than going out. A multiplier on the edge's own weight-driven alpha, so the
 *  strong/weak reading H2 added survives the dim. */
const HOVER_EDGE_DIM = 0.3;
const HOVER_NODE_DIM = 0.45;

/** A card with `deg === 0` sits on the board by repulsion and centre-pull alone -- its POSITION
 *  carries no synergy information. A blind judge, shown a correctly fitted and labelled board,
 *  named two edgeless lands as the deck's most strongly related pair: their arbitrary proximity
 *  plus a matching paint-mode ring colour read as a relationship (task-12 brief). These knock
 *  every cue an edgeless card would otherwise share with a connected one -- size, opacity, AND
 *  colour, not opacity alone -- so proximity by itself can no longer read as synergy. Paint only:
 *  the node stays in the force simulation at its full-weight position; only how it is drawn here
 *  changes. */
const EDGELESS_ALPHA = 0.4;
const EDGELESS_RADIUS_SCALE = 0.55;

/** Screen px a card-name label renders at, held constant across zoom -- world-unit font size is
 *  `LABEL_PX / cam.z`, same trick as the ×copies badge a few lines below. The formula was never the
 *  defect (see labels.ts); what got labels deleted was letting the measured box feed back into
 *  layout. It never does here: this constant reaches only the label pass at the end of draw(). */
export const LABEL_PX = 11;

/** Breathing room around a label's COLLISION box, in screen px. `placeLabels` rejects an exact
 *  overlap, so two names could sit a pixel apart and read as one run of text — which is what the
 *  central cluster looked like at default zoom. Applied to the collision box only; the text is
 *  still drawn at the node. */
const LABEL_GAP = 4;
/** Below this zoom, most of the board is too small on screen for a name to mean anything -- only a
 *  commander or whatever's under the pointer still gets one. */
const LABEL_ZOOM_FLOOR = 0.6;

/** How much of the board is culled from label eligibility at board zoom, by weighted degree.
 *
 *  0.25 — the weakest quarter of the cards carry no name unless they are a commander or under the
 *  pointer. Measured (see `labelCandidates`): it takes a 130-node board from 61 placed labels to
 *  32, and 0.5 would take it to 14, which is a board that names almost nothing. The complaint this
 *  answers is the owner's "cluttered", which had a metric for its edges and none at all for its
 *  text. */
const LABEL_DEGREE_QUANTILE = 0.25;

export type Point = { x: number; y: number };

/** Stroke width for one edge, scaled by weight against the deck's own maximum -- the same
 *  normalisation linkDistanceFor uses, and for the same reason: the weight scale is unbounded. */
export function edgeWidth(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return EDGE_W_MIN;
  const t = Math.min(1, Math.max(0, weight / maxWeight));
  return EDGE_W_MIN + t * (EDGE_W_MAX - EDGE_W_MIN);
}

/** Opacity for one edge, on the same deck-relative normalisation `edgeWidth` uses. Width alone
 *  cannot separate 300 edges -- at these zooms the difference between 0.4 and 2.2 world units is
 *  under two device pixels -- so the strong third of a deck's relationships now also reads darker
 *  than the incidental two-thirds. */
export function edgeAlpha(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return EDGE_A_MIN;
  const t = Math.min(1, Math.max(0, weight / maxWeight));
  return EDGE_A_MIN + t * (EDGE_A_MAX - EDGE_A_MIN);
}

/** A label box's left edge, moved just enough to keep the whole box on a canvas `canvasW` wide. A
 *  box wider than the canvas starts at 0. */
export function clampLabelX(x: number, w: number, canvasW: number): number {
  return Math.max(0, Math.min(x, canvasW - w));
}

/** The theme colours the board paints with, read from CSS custom properties once per layout. */
export interface PaintColors {
  accent: string; fg: string; muted: string; sep: string; edge: string; surface: string; bg: string;
}

/** A value the component owns and updates between frames; the paint pass only reads it. */
type Live<T> = { readonly current: T };

/** Everything one frame reads. */
export interface BoardPaint {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  paintColors: PaintColors;
  dim: { w: number; h: number; dpr: number };
  bare: boolean;
  pinnedNames: ReadonlySet<string>;
  alwaysLabelled: () => Set<string>;
  neighborsOf: Map<string, string[]>;
  nodes: Sim[];
  byId: Map<string, Sim>;
  links: SimLink[];
  undrawnLinks: SimLink[];
  tagsByPair: Map<string, string[]>;
  weightedDegree: Map<string, number>;
  maxWeight: number;
  facePairLinks: SimLink[];
  cam: { x: number; y: number; z: number };
  artLoader: ArtLoader;
  hoveredIdRef: Live<string | null>;
  huesRef: Live<Map<string, string[]>>;
  guidedRef: Live<boolean>;
  keyCardIdsRef: Live<ReadonlySet<string>>;
  companionsRef: Live<Set<string>>;
  unreadRef: Live<Set<string>>;
  spotlightRef: Live<boolean>;
  matchesRef: Live<Set<string> | null>;
  edgeHasEventRef: Live<(e: { tags: string[] }) => boolean>;
  flowHueRef: Live<Map<string, string>>;
  flowFocusRef: Live<string | null>;
  flowRef: Live<Flow | null>;
}

export function paintBoard(b: BoardPaint): void {
  const {
    canvas, ctx, paintColors, dim, bare, pinnedNames, alwaysLabelled, neighborsOf,
    nodes, byId, links, undrawnLinks, tagsByPair, weightedDegree, maxWeight, facePairLinks,
    cam, artLoader, hoveredIdRef, huesRef, guidedRef, keyCardIdsRef, companionsRef, unreadRef,
    spotlightRef, matchesRef, edgeHasEventRef, flowHueRef, flowFocusRef, flowRef,
  } = b;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = paintColors.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // cam.x/y are d3-zoom's own translate, top-left-anchored -- the SAME convention
  // `pointer(event)` (and therefore every anchor computation d3-zoom does internally) uses.
  // This used to add dim.w/2 + dim.h/2 here to draw a centre-anchored board, which put the
  // renderer's origin at the canvas CENTRE while d3-zoom kept anchoring wheel/drag at the
  // TOP-LEFT -- the two disagreed by exactly half the canvas, so every zoom recentred a
  // quarter-viewport away from the cursor. Centring now happens once, at the initial seed
  // transform below, by baking dim.w/2 + dim.h/2 into cam.x/y themselves.
  ctx.setTransform(cam.z * dim.dpr, 0, 0, cam.z * dim.dpr, cam.x * dim.dpr, cam.y * dim.dpr);

  // One stroke per edge rather than one path for all of them: width carries weight now, and a
  // single batched path can only have one width. ~200 edges a frame.
  const activeFlow = flowRef.current;
  // Built once per draw, not per edge: an O(links) `.find` over `activeFlow.edges` inside the
  // loop below was O(links x flowEdges) every frame. Keyed `from>to` -- flow edges are already
  // direction-pure, so there is never a `to>from` collision to worry about.
  const flowEdgeByPair = new Map<string, FlowEdge>();
  if (activeFlow) {
    for (const fe of activeFlow.edges) flowEdgeByPair.set(`${fe.from}>${fe.to}`, fe);
  }
  // CLICKING ONE FACE SELECTS THE CARD, SO BOTH FACES ANSWER. A face is its own node, so a
  // selection lit that node's flow and dimmed the card's OTHER half to 0.15 along with the rest
  // of the board -- owner, testing a Jodah deck: "if I click on one side only that side
  // highlights not both of them". The two faces have no edge between them and must not get one
  // (a permanent is one face at a time, CR 712.8d-f), so the sibling is not in the flow and is not
  // being claimed to be: it stays at full strength and its shared rim turns ACCENT, which says
  // "this is the card you clicked" rather than "this participates in the flow".
  // Empty for a single-faced selection, which is every selection on most boards.
  // Every selected card's own name, so the sibling-face rule holds for each of them once
  // selection became a set rather than one id.
  const rootCardNames = new Set<string>();
  if (activeFlow) {
    for (const id of activeFlow.roots) {
      const name = byId.get(id)?.cardName;
      if (name !== undefined) rootCardNames.add(name);
    }
  }
  const sameCardIds = rootCardNames.size > 0
    ? new Set(nodes.filter((n) => n.cardName !== undefined && rootCardNames.has(n.cardName)).map((n) => n.id))
    : null;
  // Direction as motion: flow edges are dashed, and the pattern crawls from producer to
  // consumer. Read ONCE per frame, not per edge -- every edge in a frame must share a phase or
  // the flow reads as noise instead of as one current.
  //
  // Wall-clock, not a frame counter: a per-frame increment would crawl twice as fast on a 120Hz
  // display as on a 60Hz one. Modulo one dash cycle keeps the number small and changes nothing
  // visible -- the pattern repeats every `on + off` pixels by definition.
  //
  // prefers-reduced-motion freezes the phase at 0. The dashes stay (a static dash is harmless)
  // but they carry no direction, so those readers fall back to the flow legend's wording. That
  // gap is recorded in the design doc; closing it means arrowheads, which are a separate item.
  // Hoisted above the EDGE pass -- it used to be built inside the label pass, which is the last
  // thing draw() does. Both passes read the same set now, so a hovered card's edges, its
  // partners and their labels cannot disagree about what "one hop" means.
  const hoveredId = hoveredIdRef.current;
  const hoveredSet = hoveredId
    ? new Set([hoveredId, ...(neighborsOf.get(hoveredId) ?? [])])
    : new Set<string>();
  // A CLICK OUTRANKS A HOVER, ALWAYS. The flow is what the reader deliberately asked for; the
  // hover is where their pointer happens to be. Running both at once would dim the flow's own
  // cards whenever the pointer sat over an unrelated one.
  const hoverActive = hoveredId !== null && !activeFlow;
  const stillMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const dashCycle = FLOW_DASH.on + FLOW_DASH.off;
  const crawl = stillMotion ? 0 : (performance.now() / 1000 * FLOW_DASH.speed) % dashCycle;
  // A FOCUSED CARD PAINTS EVERY EDGE IT HAS, drawn or not. The flow and the hover set are both
  // computed over the whole graph, so without this a partner lit with no line to it -- the
  // dock said 38 synergies and the board showed 4 of them. Resting board: `links` only.
  const paintLinks = activeFlow || hoverActive
    ? [...links, ...litUndrawn(undrawnLinks, hoverActive ? hoveredId : null, flowEdgeByPair)]
    : links;
  for (const l of paintLinks) {
    const fe = flowEdgeByPair.get(`${l.source.id}>${l.target.id}`);
    // An edge in the flow takes its direction's hue at full opacity; everything else keeps the
    // neutral stroke and drops to the dim alpha, so the flow reads against the rest of the deck.
    // Outside a flow, opacity carries WEIGHT (edgeAlpha) -- the flat 0.15 stays for the dimmed
    // background because a dimmed edge is scenery, and re-ranking scenery by weight would make
    // the strongest UNSELECTED edge compete with the flow the reader asked for.
    // A hovered card's own edges take the flow's direction hues -- the same two colours the
    // legend already names, so hover and click say the same thing in the same language.
    const hoverDir = hoverActive && l.source.id === hoveredId ? "down"
      : hoverActive && l.target.id === hoveredId ? "up"
      : null;
    // AN EDGE THAT DOES NOT CARRY THE TRACED EVENT IS SCENERY, and it outranks every other
    // alpha rule here: the reader named one mechanism, so nothing else on the board may present
    // itself as the answer — not a hover, and not the direction hues of a flow that walked only
    // matching edges anyway. Dimmed rather than hidden, the same grammar the search uses, so the
    // deck keeps its shape and the traced chain reads AGAINST it rather than in a vacuum.
    const edgeTags = tagsByPair.get(`${l.source.id}>${l.target.id}`) ?? [];
    const offEvent = !edgeHasEventRef.current({ tags: edgeTags });
    // WHICH MECHANISM THIS EDGE IS, and whether the reader has isolated a different one. Hue
    // used to mean up/down and nothing else, so a forty-edge flow was one mesh; it means the
    // EVENT now, and direction moved to the dash crawl below.
    const edgeVerbs = edgeTags.map(mechanismKey);
    const focus = flowFocusRef.current;
    // AN ISOLATED MECHANISM PAINTS IN ITS OWN HUE, even on an edge that carries another one
    // first. 29 of the Jodah deck's 335 edges span more than one verb (8.7%), so without this
    // an edge kept by `offFocus` below could stay lit in a DIFFERENT mechanism's colour --
    // the reader isolates "Attacking" and sees a green line, which is the exact confusion the
    // hue change exists to remove. Ranked order still decides an unfocused edge.
    const flowVerb = fe
      ? (focus !== null && edgeVerbs.includes(focus) ? focus : edgeVerbs.find((v) => flowHueRef.current.has(v)))
      : undefined;
    const offFocus = fe !== undefined && focus !== null && !edgeVerbs.includes(focus);
    ctx.globalAlpha = offEvent ? 0.06
      : offFocus ? 0.12
      : fe ? 1
      : activeFlow ? 0.15
      : hoverDir ? 1
      : hoverActive ? edgeAlpha(l.weight, maxWeight) * HOVER_EDGE_DIM
      : edgeAlpha(l.weight, maxWeight);
    ctx.strokeStyle = offEvent || offFocus ? paintColors.edge
      // The event's hue, falling back to the direction pair only when this edge carries no verb
      // the legend named -- which is the >7-event tail the legend calls "everything else".
      : fe ? (flowVerb ? flowHueRef.current.get(flowVerb)! : OVERFLOW_HUE)
      : hoverDir ? FLOW_HUE[hoverDir]
      : paintColors.edge;
    ctx.lineWidth = edgeWidth(l.weight, maxWeight) / cam.z;
    // Sticky context state: the else branch is not optional. Without it the pattern set by the
    // last flow edge would dash every rim, border and card frame drawn after this loop.
    if (fe && !offEvent && !offFocus) {
      ctx.setLineDash([FLOW_DASH.on / cam.z, FLOW_DASH.off / cam.z]);
      // DIRECTION IS THE CRAWL NOW THAT HUE CARRIES THE MECHANISM: colour says which event,
      // motion says which way. `FLOW_DASH`'s own comment already called the motion the encoding
      // -- it just was not being used as one.
      //
      // ALWAYS TOWARD THE TARGET, AND `fe.dir` IS DELIBERATELY NOT CONSULTED. It shipped as
      // `dir === "down" ? -crawl : crawl`, which makes the dashes radiate AWAY from the clicked
      // card in both fans -- while the arrowhead below is drawn at `l.target` in both fans. On
      // every UPSTREAM edge the two encodings therefore pointed opposite ways. `dir` records
      // which WALK found the edge, not which way the event travels; the event always goes
      // `from -> to`, the line is always drawn source-to-target, so one constant sign is the
      // only reading that agrees with the arrowhead and with the graph. Caught on the Jodah
      // deck 2026-08-27. What is lost is the "radiating outward" reading, which the arrowhead's
      // orientation relative to the clicked card already states.
      ctx.lineDashOffset = -crawl / cam.z;
    } else if (l.enabledBy && !offEvent && !offFocus) {
      // THE STATE MADE THIS EDGE (roadmap W18): dashed in the accent, no crawl -- it is a
      // fact about the setting, not an event flowing.
      ctx.setLineDash([6 / cam.z, 4 / cam.z]);
      ctx.lineDashOffset = 0;
      ctx.strokeStyle = paintColors.accent ?? ctx.strokeStyle;
    } else {
      ctx.setLineDash([]);
    }
    // TRIMMED TO THE RIM, NOT DRAWN TO THE CENTRE. A centre-to-centre line runs UNDER both
    // discs, and once the discs carry card art the line reads as sliding beneath the card and
    // out the other side — owner-reported, 2026-08-27. It also makes an edge that merely PASSES
    // a third card look like it terminates there. Ending the stroke at the rim leaves the
    // relationship legible and the disc unbroken.
    //
    // ART_RADIUS is the disc, which is what the miniature and dot modes draw. CARD mode draws a
    // larger rectangle, so a line still enters the card frame there — that view is one card
    // filling the screen with its neighbours off it, so the case is cosmetic rather than the one
    // reported. Stated rather than silently approximated.
    const ex = l.target.x - l.source.x;
    const ey = l.target.y - l.source.y;
    const elen = Math.hypot(ex, ey);
    // Two overlapping discs have no visible span between them; drawing anyway would paint a
    // backwards stub poking out of both.
    if (elen <= ART_RADIUS * 2) continue;
    const tx = ex / elen;
    const ty = ey / elen;
    ctx.beginPath();
    ctx.moveTo(l.source.x + tx * ART_RADIUS, l.source.y + ty * ART_RADIUS);
    ctx.lineTo(l.target.x - tx * ART_RADIUS, l.target.y - ty * ART_RADIUS);
    ctx.stroke();
    // DIRECTION MUST SURVIVE A STILL FRAME. Hue carries the MECHANISM now, so the crawl became
    // the only direction channel -- and `stillMotion` zeroes the crawl under
    // `prefers-reduced-motion`, which left those readers with no direction encoding at all. It
    // is also invisible in a screenshot, and the task-5 brief already recorded a blind judge
    // unable to tell producer from consumer from the hues alone.
    //
    // An arrowhead is the conventional answer for a directed graph and is static by
    // construction. Drawn only on a flow edge: the resting board is undirected to the eye and
    // ninety arrowheads would be noise on top of the mesh this whole change exists to thin.
    if (fe && !offEvent && !offFocus) {
      const hx = l.target.x - tx * ART_RADIUS;
      const hy = l.target.y - ty * ART_RADIUS;
      // FILLED AND BIGGER, BECAUSE THE STROKED ONE DID NOT DO ITS JOB. It shipped as a 5px
      // three-point STROKE at the edge's own 1-2px line width, which is a chevron a reader has
      // to already be looking for. The tuner review -- given a still, which is exactly the case
      // this mark exists for -- reported "I cannot resolve an arrowhead on any of the ~30
      // painted dashes", and lost the task it needed direction for. A filled triangle at 8px
      // reads as a solid shape rather than three thin lines, and its area does not depend on
      // the edge's weight.
      const head = 8 / cam.z;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(hx - tx * head - ty * head * 0.5, hy - ty * head + tx * head * 0.5);
      ctx.lineTo(hx, hy);
      ctx.lineTo(hx - tx * head + ty * head * 0.5, hy - ty * head - tx * head * 0.5);
      ctx.closePath();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  // THE TETHER: A HAIRLINE BETWEEN THE TWO FACES OF ONE CARD, AND IT IS NOT AN EDGE.
  //
  // Adjacency plus the shared rim was not enough on a board holding ten flip cards (owner,
  // 2026-08-28): a rim says "this node is half of something" and leaves the reader to guess
  // WHICH other node. The tether says it outright.
  //
  // It states exactly what the rim states -- one physical card, two printed faces -- so it must
  // not be mistakeable for a synergy edge, and it is separated from one on every channel an
  // edge uses: no arrowhead (a face is not a producer of its other face), never a flow hue, no
  // weight and so no width, a hairline at 1px against an edge's 1-2px, DASHED with the rim's own
  // `[6,2]` pattern rather than an edge's crawl, and drawn in `--separator` rather than any
  // colour the legend assigns a meaning to. It reaches no count: it is not in `links`, so the
  // legend, `__graphProbe`, the flow walk and the hover set are all blind to it, exactly as
  // before.
  //
  // Drawn HERE, in the edge pass, so the node discs paint over both ends a moment later -- the
  // same reason the edge pass trims to the rim, one mechanism cheaper.
  if (facePairLinks.length > 0) {
    ctx.save();
    // DOTTED, NOT DASHED, AND THE DIFFERENCE IS THE POINT. The rim's `[6,2]` is a MARK on a
    // node and can afford to be seen; the tether crosses open board between two nodes, where the
    // same pattern read as a line someone drew for a reason. `[1,4]` is mostly gap -- a trail of
    // dots that resolves into "these two belong together" when you look at it and disappears
    // into the background when you are reading the mesh. Owner, 2026-08-28: "make the tether
    // more subtle."
    ctx.setLineDash([1 / cam.z, 4 / cam.z]);
    ctx.lineWidth = 1 / cam.z;
    for (const l of facePairLinks) {
      // ACCENT WHEN THE CARD IS SELECTED, matching the rim it belongs to, and dimmed with the
      // rest of the board when a flow is running elsewhere. `sameCardIds` holds both faces of
      // the clicked card, so one test covers the pair.
      //
      // `muted` and not `sep`: --separator is #1d2126, which is a hairline nobody can see on
      // this background, and not `edge`, which is the colour an actual relationship is drawn in.
      // Half alpha at rest keeps it under the mesh rather than competing with it.
      const selected = sameCardIds?.has(l.source.id) === true;
      // 0.28 at rest, against an edge's own alpha floor: the tether must be findable when
      // looked for and invisible when not. Selected, it goes to 0.85 rather than 1 -- it is
      // still not a relationship, and the accent rim is what carries the selection.
      ctx.globalAlpha = selected ? 0.85 : activeFlow ? 0.12 : 0.28;
      ctx.strokeStyle = selected ? paintColors.accent : paintColors.muted;
      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // A search dims what does not match rather than hiding it, so the deck keeps its shape and
  // you can see WHERE the match sits. `matchIds` null means no active search: dim nothing.
  // Read through the ref (see matchesRef above), never `matches` directly -- this closure is
  // rebuilt only when the effect re-runs, and the effect must not re-run on every keystroke.
  const matchIds = matchesRef.current;
  const mode = renderModeFor(cam.z);
  const cardW = CARD_W, cardH = CARD_H;
  // Cards drawn as a loading/no-art placeholder this frame. Card mode suppresses name labels,
  // because the card's own art prints the name — but a placeholder is a blank coloured
  // rectangle, so those keep theirs or nothing on screen names them. Collected here rather than
  // recomputed in the label pass so "did this node draw art?" has ONE answer per frame.
  const placeholderIds = new Set<string>();
  for (const n of nodes) {
    // See EDGELESS_ALPHA's comment. Two things narrow when the demotion actually applies:
    // a search match wins over it (if the user went looking for this exact card, it must show
    // at full strength even though it's edgeless), and CARD mode is left alone -- that view
    // only happens zoomed in on one card at a time, where there is no neighbouring dot to
    // mistake it for a relationship with; the proximity misread this exists to prevent is a
    // miniature-mode phenomenon.
    const searchDim = matchIds && !matchIds.has(n.id);
    const searchHit = matchIds && matchIds.has(n.id);
    const demote = n.deg === 0 && mode !== "card" && !searchHit;
    // FLOW OVERRIDES THE RIM, BUT ONLY ON CARDS IN THE FLOW (owner's call). Computed here,
    // ahead of the alpha decision, so a card outside the flow dims as a whole -- art included,
    // not just its rim -- rather than the art staying bright while only the ring goes faint.
    const flowNode = activeFlow?.nodes.get(n.id);
    const isRoot = activeFlow?.roots.has(n.id) === true;
    // The clicked card's OTHER printed face. Not in the flow and not claimed to be — see
    // `sameCardIds` above.
    const sameCardAsRoot = sameCardIds?.has(n.id) === true;
    // A SEARCH HIT OUTRANKS THE FLOW DIM (roadmap H3). `searchHit` guarded only `demote`, so a
    // card the user went looking for, sitting outside the selected card's flow, fell into the
    // flow branch and dimmed to 0.15 -- accent ring included, since the ring below is drawn
    // under this same alpha. The board then reported "2 MATCHES" and showed the reader nothing.
    // Precedence, in words: a non-match under an active search is scenery; a MATCH is what was
    // asked for and is never dimmed by anything; only then does the flow decide.
    ctx.globalAlpha = searchDim ? 0.15
      : searchHit ? 1
      : activeFlow && !flowNode && !isRoot && !sameCardAsRoot ? 0.15
      : hoverActive && !hoveredSet.has(n.id) ? HOVER_NODE_DIM
      : demote ? EDGELESS_ALPHA : 1;
    // The draw-time radius for this node's circle/rim/clip -- ART_RADIUS everywhere except a
    // demoted edgeless card, which draws visibly smaller as well as fainter.
    // pickAt still hit-tests at the FULL radius: board-force.ts's nodeRadius comment says every
    // consumer reads one function so painted and simulated size cannot drift, and this is a
    // knowing, one-way exception. A demoted card's click target stays the size of the card it
    // is, which is a bigger target than its dot -- the failure mode that would matter (a dead
    // zone under a visible card) cannot happen this way round.
    const r = demote ? ART_RADIUS * EDGELESS_RADIUS_SCALE : ART_RADIUS;

    // Render is a function of the camera, not a stored mode (card-node.ts's doc comment) --
    // reading cam.z here means the scroll wheel and the mode buttons can never disagree
    // about what's on screen. Card mode's source is a DIFFERENT cache key (cardImageUrl
    // rewrites the path segment to a bigger size), so switching modes cold is a real fetch,
    // not just a bigger draw of what miniature mode already had loaded.
    const src = mode === "card" && n.artCrop ? cardImageUrl(n.artCrop) : n.artCrop;
    // WARM THE FULL IMAGE OF WHAT IS ON SCREEN while zooming in, not just what is hovered.
    //
    // The report-level warm-up fetches `art_crop` (the disc); card mode draws `/normal/` (the
    // whole card). Those are DIFFERENT URLs, so a warm board still had no card image at all and
    // zooming in started the fetch from cold — reported after the first attempt at this. Hover
    // alone could not cover it: a wheel zoom need not move the pointer, so `pointermove` may
    // never fire, and when it does it fires on arrival with no lead time.
    //
    // Bounded to the viewport, which is what makes this affordable: warming all 95 is the
    // ~7.5MB that got the cropped-disc approach rejected, while at PREFETCH_Z the screen holds
    // a couple of dozen cards and fewer the further in you go. Not urgent — this is speculative,
    // and the card actually being drawn in card mode below jumps ahead of it.
    if (mode !== "card" && n.artCrop && shouldPrefetchCard(cam.z)
      && isOnScreen(n, cam, dim, ART_RADIUS * cam.z)) {
      // A URL off our own host is not warmed, for the same reason it is not drawn: the guard in
      // `cardImageUrl` is what keeps every image request in this app pointed at Scryfall.
      const warm = cardImageUrl(n.artCrop);
      if (warm !== null) artLoader.request(warm);
    }
    const img = src ? artLoader.get(src) : undefined;
    // A node stands for every copy of its card. Draw the stack behind the art so nine
    // Relentless Rats do not read as one Rat, and badge the count.
    const copies = n.copies ?? 1;
    if (copies > 1) {
      ctx.strokeStyle = paintColors.sep;
      ctx.lineWidth = 1 / cam.z;
      for (const offset of [4, 2]) {
        if (mode === "card") {
          ctx.strokeRect(n.x - cardW / 2 + offset, n.y - cardH / 2 - offset, cardW, cardH);
        } else {
          ctx.beginPath();
          ctx.arc(n.x + offset, n.y - offset, r, 0, TAU);
          ctx.stroke();
        }
      }
    }

    // An edgeless card never carries its paint-mode colour -- suppressing the hue is what
    // kills the "matching ring colour" cue the judge actually used, not just fading it. This
    // reuses the SAME fallback rendering the code below already has for a card with no value
    // under the current facet (a plain muted-border ring/box, no fill), rather than inventing
    // a second "nothing to show" path.
    const hues = demote ? [] : (huesRef.current.get(n.id) ?? []);

    // Everything else keeps its paint-mode rim, dimmed: the paint mode answers "what are these
    // cards", and a click asking "what does this feed" is no reason to stop answering that
    // everywhere else. `hues` feeds BOTH the rim arcs and card mode's bottom bars, so overriding
    // it here is the single insertion point for the whole node paint. (`flowNode`/`isRoot` were
    // computed earlier, alongside the alpha decision -- see above.)
    const flowHues = flowNode
      ? [
          ...(flowNode.upstreamDepth !== undefined ? [FLOW_HUE.up] : []),
          ...(flowNode.downstreamDepth !== undefined ? [FLOW_HUE.down] : []),
        ]
      : [];
    const paintHuesForNode = flowNode ? flowHues : hues;

    if (mode === "card" && img instanceof HTMLImageElement && img.naturalWidth > 0) {
      // The full card, not a cover-fit crop: a 5:7 box centred on the node. Card mode only
      // happens zoomed in, where neighbours are hundreds of screen px apart.
      ctx.drawImage(img, n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
    } else if (img instanceof HTMLImageElement && img.naturalWidth > 0 && img.naturalHeight > 0) {
      // Scryfall's art_crop is landscape (~626x457); the 5-arg drawImage would squash it into
      // this square node. Cover-fit instead: crop a centred square out of the source (the
      // shorter side) and draw that into the node -- same trick as CSS `object-fit: cover`.
      // Guard the source dims: a truthy naturalWidth/Height of 0 (or NaN) would hand drawImage
      // a zero-size source rect, which throws and would kill the whole animation loop.
      const sw = img.naturalWidth, sh = img.naturalHeight, s = Math.min(sw, sh);
      ctx.save();
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.clip();
      ctx.drawImage(img, (sw - s) / 2, (sh - s) / 2, s, s,
        n.x - r, n.y - r, r * 2, r * 2);
      ctx.restore();
    } else {
      // Covers both "no art at all" and "card mode wants an image that hasn't loaded yet" -- a
      // blank node is worse than a small one, so this always requests `src` (whichever size the
      // current mode wants) and draws a placeholder rather than nothing. The FILL is the point:
      // it is the only thing on screen at the moment the user is zoomed in and looking at
      // nothing else, so it has to read as a solid loading signal. Filled in the card's own
      // paint hue, so a deck whose art has not landed is still readable by facet.
      // URGENT in card mode: only a handful of cards are on screen there and one of them is the
      // card the user zoomed in to read, so it must not queue behind the other 90 discs.
      // AND URGENT FOR A LIT CARD ON SCREEN. The disc queue runs in node order at Scryfall's
      // spacing, ~7 s for a deck, so the commander and partners the board opens framed on could
      // be the last discs to get art (2026-09-25 review: flat discs a second in, some still flat
      // at five). The flow is a handful of cards, so jumping it ahead costs the rest little.
      const litHere = activeFlow !== null && (activeFlow.nodes.has(n.id) || activeFlow.roots.has(n.id))
        && isOnScreen(n, cam, dim, ART_RADIUS * cam.z);
      if (src) artLoader.request(src, mode === "card" || litHere);
      placeholderIds.add(n.id);
      ctx.fillStyle = hues[0] ?? paintColors.muted;
      if (mode === "card") {
        ctx.fillRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.fill();
      }
    }

    // THE ENGINE NEVER READ THIS CARD, SAID WITHOUT WORDS. Over the art rather than instead
    // of it: the card is really in the deck and its printed facts still hold, so hiding the
    // picture would overstate the gap. Stripes in SCREEN pixels (divided by the camera scale)
    // so the pitch a reader learns at one zoom is the pitch they meet at every other, and the
    // geometry itself comes from `lib/unread.ts` — the graph list paints the same mark as a CSS
    // gradient, and a convention drawn at two pitches is two conventions.
    if (unreadRef.current.has(n.id)) {
      const half = mode === "card" ? Math.hypot(cardW, cardH) / 2 : r;
      // AT LEAST FOUR STRIPES, ALWAYS, AND THE WHOLE HATCH SCALES TOGETHER TO GET THEM.
      // `HATCH.pitch` is 8 screen px, which is right on a node you are looking at and wrong on
      // the one the spotlight zooms out to frame: at z 0.43 a disc is ~12px across, two stripes
      // over a ring, and a judge read that as the international PROHIBITION sign -- "a verdict
      // the tool has passed on the card, excluded, disallowed, rather than an absence of data
      // on the tool's side", which inverts whose failure this mark is about.
      //
      // ONE SCALE FOR BOTH, and the first attempt is why this is spelled out: shrinking the
      // pitch alone left the 3px stripe width untouched, so at a 3px pitch the dark lines
      // touched, filled the disc solid, and the mark became an EMPTY RING -- less legible than
      // the slash it was fixing. The duty cycle (3 on, 5 off) is what makes it read as hatching
      // rather than as a fill, so it is the thing that must survive every size.
      const pitchPx = Math.min(HATCH.pitch, (2 * r * cam.z) / 4);
      const shrink = pitchPx / HATCH.pitch;
      const pitch = pitchPx / cam.z;
      const strokeW = (HATCH.width * shrink) / cam.z;
      ctx.save();
      ctx.beginPath();
      if (mode === "card") ctx.rect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
      else ctx.arc(n.x, n.y, r, 0, TAU);
      ctx.clip();
      // EVERY STRIPE IS CASED, and that is not decoration. A dark stripe alone measured 15/255
      // of luminance range over `Nest of Scarabs` — art already at the page's own darkness —
      // against 55-58 over the two lighter unread cards on the same board. Art crops run the
      // whole range, so no single stripe colour reads on all of them; a dark line with a light
      // hairline beside it has one half showing whichever way the art goes.
      const line = (d: number, dx: number) => {
        ctx.beginPath();
        ctx.moveTo(n.x + d + dx - half, n.y - half);
        ctx.lineTo(n.x + d + dx + half, n.y + half);
        ctx.stroke();
      };
      for (let d = -2 * half; d <= 2 * half; d += pitch) {
        ctx.strokeStyle = paintColors.bg;
        ctx.lineWidth = strokeW;
        line(d, 0);
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = paintColors.fg;
        ctx.lineWidth = Math.min(1, shrink * 1.5) / cam.z;
        line(d, strokeW);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    // What this card IS, under the current paint mode. Drawn for both the art and the fallback
    // branch: a card whose art failed to load must not lose its facet signal along with its
    // picture. Hue rides the rim, never a fill over the art -- a translucent wash over this
    // surface collapses toward gray (measured) and stops separating.
    if (mode === "card") {
      // Equal-width bars along the card's bottom edge. Card mode paints a rectangle, so there
      // is no rim to stroke arcs onto.
      //
      // OUTSIDE THE CARD, NOT OVER IT (owner-reported 2026-09-04). Drawn INSIDE the bottom edge
      // these bars sat exactly on the credit line -- the artist's name is printed bottom-left on
      // every Magic card, and that credit is the reason this product may show the art at all.
      // Covering it is both a licence problem and the rudest possible place to put a UI element.
      // Below the card the bars still read as belonging to it and obscure nothing.
      const barW = cardW / Math.max(paintHuesForNode.length, 1);
      paintHuesForNode.forEach((hue, i) => {
        ctx.fillStyle = hue;
        ctx.fillRect(n.x - cardW / 2 + i * barW, n.y + cardH / 2 + 1 / cam.z, barW, BAR_H);
      });
      if (paintHuesForNode.length === 0) {
        ctx.lineWidth = 1 / cam.z;
        ctx.strokeStyle = paintColors.sep;
        ctx.strokeRect(n.x - cardW / 2, n.y - cardH / 2, cardW, cardH);
      }
    } else {
      ctx.lineWidth = 2.5 / cam.z;
      for (const arc of rimArcs(paintHuesForNode)) {
        ctx.strokeStyle = arc.hue;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, arc.from, arc.to);
        ctx.stroke();
      }
      if (paintHuesForNode.length === 0) {
        ctx.lineWidth = 1 / cam.z;
        ctx.strokeStyle = paintColors.sep;
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.stroke();
      }
    }

    // The card you clicked, in neutral: it must not compete with the two direction hues, and
    // "this is the thing you asked about" is a different claim from "this produces/consumes".
    if (isRoot) {
      ctx.lineWidth = 2.5 / cam.z;
      ctx.strokeStyle = paintColors.fg;
      ctx.beginPath();
      if (mode === "card") ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
      else ctx.arc(n.x, n.y, r + 3, 0, TAU);
      ctx.stroke();
    }

    if (matchIds?.has(n.id)) {
      ctx.lineWidth = 2.5 / cam.z;
      ctx.strokeStyle = paintColors.accent;
      if (mode === "card") {
        ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 3, 0, TAU); ctx.stroke();
      }
    }

    // PINNED, ONE RADIUS OUTSIDE THE MATCH RING (roadmap S8). The search-match ring above
    // already uses the accent at r + 3, so a card that is both matched and pinned would
    // otherwise show one ring and silently lose a fact. Same colour, same idiom, its own
    // radius. `pinnedNames` is read from the reader's set rather than any engine field: this
    // is the one mark on the board the reader made.
    if (pinnedNames.has(n.cardName ?? n.label)) {
      ctx.lineWidth = 2.5 / cam.z;
      ctx.strokeStyle = paintColors.accent;
      if (mode === "card") {
        ctx.strokeRect(n.x - cardW / 2 - 6, n.y - cardH / 2 - 6, cardW + 12, cardH + 12);
      } else {
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 6, 0, TAU); ctx.stroke();
      }
    }

    if (copies > 1) {
      ctx.font = `500 ${10 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = paintColors.fg;
      ctx.fillText(`×${copies}`, n.x, n.y + ART_RADIUS + 11 / cam.z);
    }

    // A TOKEN IS NOT A CARD, AND THE BOARD HAS TO SAY SO -- it can carry the same name as a real
    // card sitting next to it (92 corpus token names are also a card). Dashed rim: the node is a
    // permanent the deck MAKES, not one of the 99 it holds. The word goes in the copies badge's
    // slot, which is free here -- a token is always exactly one node.
    // AN EMBLEM IS NOT A TOKEN EITHER (CR 114.1), so it gets a third dash pattern and its own
    // word; `isToken` is true on it as well, which is what keeps every token exclusion applied.
    if (n.isToken) {
      const emblem = n.isEmblem === true;
      ctx.save();
      ctx.setLineDash(emblem ? [2 / cam.z, 3 / cam.z] : [4 / cam.z, 3 / cam.z]);
      ctx.lineWidth = 1.5 / cam.z;
      ctx.strokeStyle = paintColors.muted;
      ctx.beginPath();
      if (mode === "card") ctx.strokeRect(n.x - cardW / 2 - 3, n.y - cardH / 2 - 3, cardW + 6, cardH + 6);
      else ctx.arc(n.x, n.y, r + 3, 0, TAU);
      ctx.stroke();
      ctx.restore();
      ctx.font = `500 ${10 / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = paintColors.muted;
      ctx.fillText(emblem ? "emblem" : "token", n.x, n.y + ART_RADIUS + 11 / cam.z);
    }

    // THE COMPANION SAYS SO, in the same free slot a token's word uses: it is one card, so the
    // copies badge never needs the space. Foreground rather than muted -- it is a card the
    // player chose to build around, not a derived one.
    // THE MANA FONT'S OWN COMPANION MARK leads the word (owner, 2026-09-22: use the Magic
    // glyph wherever one exists). `ms-ability-companion` is U+E97B in mana-font's CSS. Drawn
    // only once the face has loaded: a canvas has no fallback glyph, so an unloaded font would
    // paint an empty box where the word alone was honest.
    if (companionsRef.current.has(n.id)) {
      const y = n.y + ART_RADIUS + 11 / cam.z;
      const size = 10 / cam.z;
      const word = "companion";
      ctx.font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
      const wordW = ctx.measureText(word).width;
      const glyph = document.fonts?.check(`${size}px "Mana"`) ? COMPANION_GLYPH : "";
      ctx.fillStyle = paintColors.fg;
      if (glyph) {
        ctx.font = `${size}px "Mana"`;
        const glyphW = ctx.measureText(glyph).width;
        const gap = 3 / cam.z;
        const left = n.x - (glyphW + gap + wordW) / 2;
        ctx.textAlign = "left";
        ctx.fillText(glyph, left, y);
        ctx.font = `500 ${size}px "JetBrains Mono", ui-monospace, monospace`;
        ctx.fillText(word, left + glyphW + gap, y);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(word, n.x, y);
      }
    }

    // SHARED RIM, NO LINK (owner's ruling, 2026-08-27). The two faces of one card -- Task 7's
    // front (bare id) and back (`face:<n>:<name>`) -- both carry `cardName`, so a rim marks
    // them as one card without an edge drawn between them: no new edge kind, no legend entry,
    // nothing for a count to see. `cardName` is the test, never `face` -- it is present on
    // BOTH faces, while `face` is absent on the front.
    //
    // DASHED, WIDER RADIUS, review fix 2026-08-27: the first cut painted this SOLID at `fg`,
    // `r + 3` -- byte-identical to the "you clicked this" rim just above except for line width
    // (2.5 vs 1.5), so on the face IS the clicked node the thinner stroke painted entirely
    // inside the thicker one and vanished. Dashing it and pushing it out to `r + 5` keeps it
    // visible under a solid `r + 3` click rim in EITHER draw order, and the dash pattern
    // (`[6,2]`) is deliberately wider than the token rim's (`[4,3]`) so the two dashed rims
    // read as different facts even where they might otherwise coincide.
    if (n.cardName !== undefined) {
      ctx.save();
      ctx.setLineDash([6 / cam.z, 2 / cam.z]);
      // ACCENT ON BOTH FACES OF THE SELECTED CARD, so a board holding ten flip cards says which
      // two of the twenty faces are the one you clicked. At rest every pair's rim is the same
      // neutral, which is correct -- the rim is a fact about the card, not about attention.
      ctx.lineWidth = (sameCardAsRoot ? 2 : 1.5) / cam.z;
      ctx.strokeStyle = sameCardAsRoot ? paintColors.accent : paintColors.fg;
      ctx.beginPath();
      if (mode === "card") ctx.strokeRect(n.x - cardW / 2 - 5, n.y - cardH / 2 - 5, cardW + 10, cardH + 10);
      else ctx.arc(n.x, n.y, r + 5, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }
  // Canvas state is global and persistent, so a search left dimming on would leak into the
  // next frame's first edge.
  ctx.globalAlpha = 1;

  // SEMANTIC-ZOOM LABELS -- pure paint (labels.ts). No node's x/y/radius is ever read FROM
  // this pass, only INTO it: overlap is resolved in screen space, after the fact, and the
  // result is a draw decision only. Below the zoom floor the candidate set itself narrows to
  // commanders and the hovered neighbourhood, rather than asking placeLabels to reject 90-odd
  // boxes crammed into a few screen px every frame.
  // A FLOOR AND, SINCE 2026-08-14, A CEILING. Labels used to start above LABEL_ZOOM_FLOOR and
  // never stop, so from CARD_MODE_Z (4) to MAX_Z (8) a name was painted over a card whose own
  // art prints that name larger and better. Above the ceiling only the cards with NO art drawn
  // keep a label: a placeholder is a blank coloured rectangle, and suppressing its name would
  // leave nothing on screen identifying it. Paint only — no candidate set has ever fed layout.
  // THE ONE-CARD VIEW NAMES EVERY CARD IT DRAWS. It holds ten discs at most, so neither the
  // zoom floor nor the degree cull has anything to protect: on it they only ever removed names
  // -- the bottom partner of Inalla's view drew unnamed, and one pinch on the phone dropped two
  // more (2026-09-25 live review).
  const candidates = bare
    ? labelCandidates(nodes, cam.z, {
      zoomFloor: 0,
      cardModeZoom: CARD_MODE_Z,
      eligibleBelowFloor: new Set(),
      placeholders: placeholderIds,
    })
    : labelCandidates(nodes, cam.z, {
    zoomFloor: LABEL_ZOOM_FLOOR,
    cardModeZoom: CARD_MODE_Z,
    // THE SPOTLIGHT'S OWN MATCHES ARE ALWAYS ELIGIBLE. Without this the state that exists to
    // show the unread named none of them: every label on screen belonged to a dimmed READ card,
    // because an unread card is edgeless and the degree cull drops it first. "How many" without
    // "which" is not enough to decide whether the cards you just added are worth keeping.
    eligibleBelowFloor: new Set([
      ...alwaysLabelled(), ...hoveredSet,
      ...(spotlightRef.current ? matchesRef.current ?? [] : []),
    ]),
    placeholders: placeholderIds,
    // Cull the weakest quarter at board zoom — see `labelCandidates` for why a quarter of the
    // candidates costs half the labels. Passing the map is what turns the cull on; it is the
    // same one `labelPriority` orders by two lines down, so what survives the cull and what
    // wins a slot cannot disagree about which card matters.
    // No `exempt` needed: labelCandidates' cull already spares everything in
    // `eligibleBelowFloor`, which is where the spotlight's matches were just added -- and the
    // cull is exactly what would drop them, since it ranks by weighted degree and theirs is 0.
    cull: { weightedDegree, degreeQuantile: LABEL_DEGREE_QUANTILE },
  });
  // THE REPORT'S BOARD NAMES WHAT THE READER IS LOOKING AT, NOT EVERYTHING THAT FITS (owner,
  // 2026-09-24). On a deck like Jodah -- 56 of 66 cards touching the commander -- every name
  // that won a slot still sat in a knot of other names, and the selected card's partners were
  // competing for slots with dimmed cards that are not in its flow. So on the guided board:
  // at rest, the commanders, the key cards, the hovered neighbourhood and search matches; with a
  // card selected, that card's flow. Everything else stays a disc, one hover away from a name.
  if (guidedRef.current && candidates.length > 0) {
    const keep = new Set<string>([...alwaysLabelled(), ...hoveredSet, ...(matchesRef.current ?? [])]);
    const focusFlow = flowRef.current;
    if (focusFlow) { for (const id of focusFlow.nodes.keys()) keep.add(id); for (const id of focusFlow.roots) keep.add(id); }
    else for (const id of keyCardIdsRef.current) keep.add(id);
    for (let i = candidates.length - 1; i >= 0; i--) if (!keep.has(candidates[i]!.id)) candidates.splice(i, 1);
  }
  if (candidates.length > 0) {
    // World-unit font size so it renders at a constant LABEL_PX screen px -- the formula the
    // deleted room labels also used (roomFontPx); the defect was never the formula, only that
    // its measured box got fed back into layout. ctx.measureText here returns a WORLD-unit
    // width (it is unaffected by the active transform's scale, only by the font size that
    // transform will later stretch), so it is multiplied by cam.z below to land in screen
    // space -- an unconverted world box compared as though it were screen px is the exact bug
    // that got labels deleted the first time (see this task's brief).
    ctx.font = `500 ${LABEL_PX / cam.z}px "JetBrains Mono", ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = paintColors.fg;
    // Spotlit matches rank with the hovered neighbourhood: when a reader has asked to see one
    // set of cards, that set wins the scarce slots over whatever the degree ordering prefers.
    const order = labelPriority(candidates, weightedDegree, alwaysLabelled(),
      spotlightRef.current && matchesRef.current ? new Set([...hoveredSet, ...matchesRef.current]) : hoveredSet);
    // TWO SLOTS PER LABEL, above then below -- see placeLabels. `mode === "card"` uses the
    // card's own half-height, so a label clears the printed card rather than the disc that is
    // not being drawn.
    const nodeHalfH = (mode === "card" ? cardH / 2 : nodeRadius()) * cam.z;
    const boxes = order.map((id) => {
      const n = byId.get(id)!;
      const wScreen = ctx.measureText(n.label).width * cam.z;
      const sx = n.x * cam.z + cam.x, sy = n.y * cam.z + cam.y;
      const common = {
        id,
        // KEPT ON THE CANVAS. A card near the edge used to print half its name off it
        // ("ce Kuja, Fate Defied" at 390); the drawn text reads this same box back below.
        x: clampLabelX(sx - wScreen / 2 - LABEL_GAP, wScreen + LABEL_GAP * 2, dim.w),
        w: wScreen + LABEL_GAP * 2,
        h: LABEL_PX + LABEL_GAP * 2,
      };
      return [
        { ...common, y: sy - nodeHalfH - LABEL_PX - LABEL_GAP },
        { ...common, y: sy + nodeHalfH + LABEL_GAP },
      ];
    });
    // THE NODES ARE OBSTACLES TOO (roadmap H7). Every node on the board, at the size it
    // actually paints -- a disc of nodeRadius() in miniature, the full CARD_W x CARD_H rectangle
    // in card mode -- so a label can no longer be printed across a neighbour's art. Built from
    // `nodes` rather than from `candidates`: a label must clear every node it could cover, and
    // at a zoom below LABEL_ZOOM_FLOOR most nodes carry no label of their own while still being
    // very much in the way.
    const halfW = (mode === "card" ? cardW : nodeRadius() * 2) * cam.z / 2;
    const nodeBoxes = nodes.map((n) => ({
      id: n.id,
      x: n.x * cam.z + cam.x - halfW,
      y: n.y * cam.z + cam.y - nodeHalfH,
      w: halfW * 2,
      h: nodeHalfH * 2,
    }));
    // Same dimming rule the node pass uses a few lines up, and the same reason: a search keeps
    // the deck's shape rather than hiding what doesn't match, so a matching card's NAME must
    // read as clearly as its ring does. `matchIds` (not `matches`) -- see the node pass's own
    // comment on why this reads the ref.
    for (const { id, slot } of placeLabels(boxes, nodeBoxes)) {
      const n = byId.get(id)!;
      // An edgeless card's NAME is demoted with its disc. Without this the demotion half-lands:
      // a faint, shrunken, colourless dot under a full-brightness label, which is a card
      // ANNOUNCING itself while the drawing says it is not participating. `demote` from the node
      // pass is recomputed rather than shared -- that pass runs per node, this one per SURVIVING
      // label, so sharing it would mean threading a flag through placeLabels for no gain.
      const labelDemote = n.deg === 0 && (!matchIds || !matchIds.has(id));
      // Same flow condition the node pass applies to the disc a few lines up (see its comment)
      // -- without this a non-flow card kept a full-brightness NAME over a 0.15 disc, which is
      // exactly the half-landed demotion that comment warns about.
      const labelFlowNode = activeFlow?.nodes.get(id);
      const labelIsRoot = activeFlow?.roots.has(id) === true;
      ctx.globalAlpha = matchIds && !matchIds.has(id) ? 0.15
        : activeFlow && !labelFlowNode && !labelIsRoot ? 0.15
        : labelDemote ? EDGELESS_ALPHA : 1;
      // Slot 1 is the below-the-node fallback: the text baseline sits under the node rather
      // than over it, so the drawn position is the one placeLabels actually reserved.
      const halfWorld = mode === "card" ? cardH / 2 : nodeRadius();
      const wScreen = ctx.measureText(n.label).width * cam.z;
      const boxX = clampLabelX(n.x * cam.z + cam.x - wScreen / 2 - LABEL_GAP, wScreen + LABEL_GAP * 2, dim.w);
      const textX = (boxX + LABEL_GAP + wScreen / 2 - cam.x) / cam.z;
      const textY = slot === 0
        ? n.y - halfWorld - 4 / cam.z
        : n.y + halfWorld + (LABEL_PX + 2) / cam.z;
      // A HALO IN THE BOARD'S OWN BACKGROUND, so an edge passing under a name no longer reads
      // as a strike-through ("Kefka, Ruler of Ruin" on the 2026-09-25 review).
      ctx.lineJoin = "round";
      ctx.lineWidth = 3 / cam.z;
      ctx.strokeStyle = paintColors.bg;
      ctx.strokeText(n.label, textX, textY);
      ctx.fillText(n.label, textX, textY);
    }
    // Canvas state is global and persistent (draw()'s own reset a few lines up already makes
    // this mistake impossible for the node pass) -- a search left dimming on here would leak
    // into next frame's background wipe.
    ctx.globalAlpha = 1;
  }
}
