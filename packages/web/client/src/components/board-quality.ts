export interface Pt { x: number; y: number }
export interface QEdge { from: string; to: string }
export interface QTargetEdge extends QEdge { target: number }

/** True iff segments pq and rs properly cross. Shared endpoints do NOT count: two edges out of one
 *  node always touch there, and counting it would swamp the real crossings with hub degree. */
function crosses(p: Pt, q: Pt, r: Pt, s: Pt): boolean {
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p, q, r), d2 = d(p, q, s), d3 = d(r, s, p), d4 = d(r, s, q);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** ponytail: O(n^2) over edge pairs -- 200 edges is 20k tests, microseconds. If the projection ever
 *  ships thousands of edges, sweep-line (Bentley-Ottmann) is the upgrade. */
export function edgeCrossings(edges: readonly QEdge[], nodes: Record<string, Pt>): number {
  let n = 0;
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      const a = edges[i], b = edges[j];
      if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
      if (crosses(nodes[a.from], nodes[a.to], nodes[b.from], nodes[b.to])) n++;
    }
  }
  return n;
}

/** Root-mean-square of |actual distance - the distance the edge's weight asked for|. This is the
 *  single number saying whether the layout honoured the synergy weights at all. */
export function linkDistError(edges: readonly QTargetEdge[], nodes: Record<string, Pt>): number {
  if (edges.length === 0) return 0;
  let sum = 0;
  for (const e of edges) {
    const a = nodes[e.from], b = nodes[e.to];
    const actual = Math.hypot(b.x - a.x, b.y - a.y);
    sum += (actual - e.target) ** 2;
  }
  return Math.sqrt(sum / edges.length);
}

/** Names any node that is not a plain card. The projection exists so that this always returns [];
 *  a `kind` field is how a facet node would come back, since that is what they carried before. */
export function hubFreedom(nodes: readonly { id: string; kind?: string }[]): string[] {
  return nodes.filter((n) => n.kind !== undefined).map((n) => n.id);
}

export const FIXTURES = ["sorin", "inalla", "fairdrazi", "changelings", "braids", "mdfc"];

/** One fixture's measured drawing quality. Wider than `Caps` on purpose: `hubFreedom` is measured
 *  but never capped -- a facet value appearing as a node is not a budget to spend down, it is the
 *  invariant the projection exists to hold, so it is asserted empty rather than given a number. */
export interface QualityMetrics {
  nodeOverlaps: number;
  /** Two card-mode RECTANGLES overlapping. Separate from nodeOverlaps because the disc metric read
   *  0 on every fixture while cards overlapped 76 times -- see countCardOverlaps. */
  cardOverlaps: number;
  edgeCrossings: number;
  linkDistError: number;
  /** Ids of any node that is not a plain card. Must be empty. */
  hubFreedom: string[];
}

/** The three metrics from `QualityMetrics` that get a numeric budget. `hubFreedom` has no cap --
 *  see the comment on `QualityMetrics`. */
export interface Caps {
  /** Two card discs closer than 2 * ART_RADIUS. */
  nodeOverlaps: number;
  /** Two card-mode rectangles overlapping. Not 0: the collide force is SOFT (one iteration, alpha
   *  decay), so a few pairs settle inside a radius that geometrically guarantees separation. */
  cardOverlaps: number;
  /** Properly crossing edge pairs, shared endpoints excluded. */
  edgeCrossings: number;
  /** rms |actual - target| link distance, rounded up to an integer for the table. */
  linkDistError: number;
}

/** MEASURED, not chosen: `board-layout.harness.ts`, five fixtures x ten seeded trials, 800 ticks
 *  plus 180 motion ticks. Overlaps and crossings are summed over the ten trials, linkDistError is
 *  the ceil of their mean. A cap picked before anything was measured is a guess wearing a number.
 *
 *  Ratchet rules, unchanged from the table this replaces: over a cap is a regression and fails;
 *  UNDER one also fails, until the cap is lowered to the new number in the same commit, or an
 *  improvement can be silently spent later. Raising one needs a written reason on the line.
 *
 *  THE ARM THESE NUMBERS COME FROM. The board is degree-normalised (LINK_DEGREE_NORM) at
 *  LINK_STRENGTH_K 1.4. Six arms, same instrument, motionMean is world units a node moves over the
 *  180 ticks after settling:
 *
 *    arm          crossings (5 fixtures)                 distErr           motionMean
 *    shipped      53534 56197 69209  9623 27787          40 40 41 30 34    119.7 88.3 62.1 13.3 26.4
 *    degnorm      39009 27318 27042  6641 16093          57 54 62 47 54     13.5 13.5 11.3  5.6  5.0
 *    k012         48400 34095 43852  7001 22676          72 62 63 56 76     18.5  8.7  8.6  5.5  7.7
 *    k0133        50040 34905 41859  7300 20679          69 61 62 54 68
 *    degnorm-k1   42289 30688 34310  6768 17772          49 46 53 40 48     19.4 18.1 12.9  4.6  8.0
 *    degnorm-k14  43058 32740 35016  6736 19796          41 41 48 36 42     13.8 23.2  9.8  4.6  9.2
 *    degnorm-k2   46001 35377 43863  8024 22522          37 38 45 31 37     18.3 26.1 18.2  5.9 12.3
 *
 *  `k012`/`k0133` are the CONTROL, and they are why the divisor is degree rather than a smaller k:
 *  softening every spring uniformly by the same average factor settles the board too, but leaves
 *  crossings and link-distance error WORSE than the undivided arm on every fixture. Degree is what
 *  matters, not softness -- a leaf card's spring keeps full strength under the divisor, only hubs pay.
 *
 *  Two control values because the first was mis-derived. 0.12 came from dividing 0.7 by an
 *  ESTIMATED mean min-endpoint degree of ~6; the mean over the five fixtures' filtered links is
 *  actually 5.252 (per-fixture 4.58-5.49), so the fair control is 0.133. `k0133` is that rerun, and
 *  it loses to the shipped arm on both metrics on all five fixtures exactly as `k012` did. The
 *  estimate was wrong by 14-24% and the conclusion did not depend on it -- which is the only reason
 *  it is a footnote rather than a redo.
 *
 *  Against `shipped`, the shipped arm buys crossings -20% to -49% and motion -65% to -89% (sorin
 *  119.7 -> 13.8: it never settled at all before, it walked half a link length per node forever),
 *  and the one node overlap goes. It PAYS up to 8 units of rms link-distance error on fairdrazi and
 *  braids -- 1 unit on sorin and inalla, and it is 6 better on nothing. k2 buys that back and
 *  spends it on crossings instead; past 1.4 the crossings cost per further unit of distErr more
 *  than triples (~4.3% below it, ~14.6% above), which is the sense in which 1.4 is the knee.
 *
 *  THE TRADE IS THE OWNER'S CALL AND WAS TAKEN: signed off 2026-08-13 after the review put the
 *  three arms side by side. Distance fidelity is what says "distance means synergy", so spending 8
 *  units of it to make the board settle is a product judgement, not a computed one. `degnorm-k2` is
 *  a one-line change plus a re-cap if it is ever revisited. */
/** RE-CAPPED 2026-08-20 — THE BOARD IS ALLOWED TO STOP (`ALPHA_FLOOR` 0.02 → 0, roadmap H1).
 *
 *  These are the harness's own settings (800 ticks, 10 trials), which is MID-SETTLE for a board
 *  that now comes to rest: alpha reaches ~0.018 at 800 ticks and the layout freezes around 1,400.
 *  Kept at 800 anyway, so the gate stays comparable with every re-cap above it.
 *
 *  THE ARMS, measured like-for-like at 4,000 ticks where both are done moving (10 trials):
 *    fixture      arm       cardOverlaps  crossings  distErr  motionMax
 *    sorin        floor .02      84         41294      78       83.9
 *    sorin        floor 0         0         40119      77        0.0
 *    inalla       floor .02       7         33131      56       12.0
 *    inalla       floor 0         0         36161      60        0.0
 *    fairdrazi    floor .02       4         37764      63       14.8
 *    fairdrazi    floor 0         0         35193      62        0.0
 *    changelings  floor .02       2          7399      43       15.0
 *    changelings  floor 0         0          7429      42        0.0
 *    braids       floor .02       0         23485      46       13.5
 *    braids       floor 0         0         23665      48        0.0
 *
 *  **CARD OVERLAPS GO TO ZERO ON ALL FIVE AND MOTION GOES TO EXACTLY ZERO.** sorin's 84 overlapping
 *  card pairs at 4,000 ticks are the old arm's real state, and they are a MOVING TARGET (2.4 pairs
 *  at 20,000) precisely because that board never stops rearranging itself.
 *
 *  THE COST, and it is one fixture: **inalla loses 9.1% of crossings (33,131 → 36,161) and 4 units
 *  of rms distance error**, past the 3% stop-and-diagnose line the re-caps above hold themselves to.
 *  The mechanism is that the floor's leaked energy kept nudging the densest board out of bad
 *  configurations; with no floor it freezes in the first local minimum it reaches. Diagnosed rather
 *  than assumed: an `alphaDecay 0.0025` arm at 8,000 ticks — twice the exploration — recovers
 *  inalla's distance error (60 → 56) and leaves crossings WORSE at 36,443, so this is freezing, not
 *  exploration time, and no decay setting buys it back.
 *
 *  TAKEN, with the cost recorded rather than hidden: zero overlaps and a board that stops beat 9%
 *  of a crossings count on one fixture, and `cardOverlaps` is the metric with an owner ruling behind
 *  it ("I would prefer having bigger cards cause they should be readable"). One line to revert —
 *  `ALPHA_FLOOR` in board-force.ts. */
export const QUALITY_CAPS: Record<string, Caps> = {
  // RE-CAPPED 2026-08-28 for ALPHA_DECAY 0.005 -> 0.010 (board-force.ts, with the table). The board
  // now parks in ~11.5 s instead of ~23, so it stops visibly drifting under the reader; crossings
  // and rms link-distance error pay 2-12% for it and CARD OVERLAPS GO TO ZERO ON ALL SIX, because a
  // board that keeps creeping keeps re-forming them.
  // RE-CAPPED AGAIN 2026-08-28 for REPULSION 25 -> 60 (board-force.ts, with the table). Crossings
  // fall 11-36% on every fixture and rms link-distance error rises 0-14: the trade is a board that
  // clumps less against a distance that encodes synergy strength slightly less exactly.
  sorin: { nodeOverlaps: 0, cardOverlaps: 0, edgeCrossings: 36435, linkDistError: 80 },
  inalla: { nodeOverlaps: 0, cardOverlaps: 0, edgeCrossings: 26347, linkDistError: 63 },
  fairdrazi: { nodeOverlaps: 0, cardOverlaps: 0, edgeCrossings: 27767, linkDistError: 73 },
  changelings: { nodeOverlaps: 0, cardOverlaps: 0, edgeCrossings: 6664, linkDistError: 57 },
  braids: { nodeOverlaps: 0, cardOverlaps: 0, edgeCrossings: 17030, linkDistError: 63 },
  // THE ONLY FACE-CARRYING FIXTURE, captured 2026-08-28 from `taking-crew-to-the-town` — 21 of its
  // 100 cards are multi-face, so it draws 130 nodes where the other five draw 75-95. Added because
  // faces-as-nodes shipped 2026-08-27 and every fixture here predates it: the ratchet was measuring
  // a board shape the app no longer produces for half its decks.
  //
  // Capped where it measures rather than where anyone would like it to be — a cap is a ratchet
  // against regression, not a target.
  //
  // THE FACE SPRING'S COST, re-measured at the CURRENT constants (2026-08-28): 62,626 crossings with
  // the spring against 57,292 without, so joining a card's faces costs about 9% more crossings and
  // buys a median face-to-face gap of 77 world units against 330. The figures this comment carried
  // first (74,877 / 69,766, +7%) were taken at ALPHA_DECAY 0.005 and REPULSION 25 and are dead --
  // a review found them sitting un-flagged above a cap from a third regime.
  //
  // AND ITS CROSSINGS ARE NOT A NODE-COUNT FACT, which is how they were first written up. mdfc has
  // 338 edges to sorin's 246: the edge-PAIR ratio is 1.888 and the crossings ratio 1.864, so the
  // excess is edges almost exactly and the 130-vs-84 node count explains none of it. What the extra
  // nodes really cost is 130 discs and 130 LABELS, which no metric here measures.
  mdfc: { nodeOverlaps: 0, cardOverlaps: 0, edgeCrossings: 62644, linkDistError: 66 },
};

/** RE-CAPPED AGAIN, same day, for the de-drift ORDER fix (board-force.ts). `forceDeDrift` ran LAST
 *  and so cancelled the centre pull's own contribution -- a pull toward the origin on a displaced
 *  board is almost entirely common-mode, which is precisely what that force subtracts -- so the
 *  board could never come home: seeded at x=800 it moved 3e-13 over 400 ticks and 2e-13 over 10,000.
 *  Moving it BEFORE forceX/forceY restores the return (798 -> 697 over 10k ticks) and KEEPS the
 *  anti-walk property it exists for: centroid distance from the origin after 40k ticks, three seeds,
 *  27 -> 19 on sorin and 21 -> 15 on the other four.
 *
 *  Before -> after (the card-mode caps above -> these):
 *    sorin        cardOverlaps 16 -> 11   crossings 40211 -> 41207 (+2.5%)  distErr 75 -> 77
 *    inalla       cardOverlaps  8 ->  0   crossings 33099 -> 33151 (+0.2%)  distErr 54 -> 56
 *    fairdrazi    cardOverlaps 23 -> 17   crossings 36643 -> 37354 (+1.9%)  distErr 61 -> 61
 *    changelings  cardOverlaps  0 ->  1   crossings  7337 ->  7400 (+0.9%)  distErr 41 -> 42
 *    braids       cardOverlaps  0 ->  0   crossings 23551 -> 23607 (+0.2%)  distErr 47 -> 47
 *  Every move is under 3% -- well inside the stop-and-diagnose line -- and it is the same effect the
 *  de-drift re-cap already recorded once: CENTER_PULL pulls toward a FIXED point, so it is not
 *  translation-invariant, and any change to where the board sits changes the trajectory from there
 *  on. Card overlaps IMPROVED on three fixtures and rose by one pair on changelings; the residual is
 *  the soft collide, unchanged in kind. */

/** RE-CAPPED 2026-08-18 for the card-mode collision fix, and the interesting number is the one that
 *  was not here before. `cardOverlaps` is NEW: the old table capped `nodeOverlaps` at 0 and every
 *  fixture met it while cards overlapped on every board, because the disc metric cannot see a
 *  rectangle. THE GATE WAS MEASURING THE WRONG SHAPE, which is how this shipped twice and had to be
 *  owner-reported twice (2026-08-13, 2026-08-18).
 *
 *  COLLISION_PAD is now derived from the card's DIAGONAL (5 -> 20.2, spacing 33 -> 48.2), because
 *  two axis-aligned rectangles miss each other only when |dx| >= w OR |dy| >= h. Owner's ruling on
 *  the alternative: the first cut shrank the CARD to fit the old spacing, which cost the layout
 *  nothing and made the card 19.2 wide — rejected, "I would prefer having bigger cards cause they
 *  should be readable", so the card keeps 28 x 39.2 and the board pays.
 *
 *  Before -> after, five fixtures, same instrument (800 ticks, 10 trials, summed / meaned as above):
 *    sorin        cardOverlaps 763 -> 16    crossings 42237 -> 40211 (-4.8%)   distErr 40 -> 75 (+87%)
 *    inalla       cardOverlaps 688 ->  8    crossings 33368 -> 33099 (-0.8%)   distErr 42 -> 54 (+29%)
 *    fairdrazi    cardOverlaps 1049 -> 23   crossings 34762 -> 36643 (+5.4%)   distErr 48 -> 61 (+27%)
 *    changelings  cardOverlaps 166 ->  0    crossings  6868 ->  7337 (+6.8%)   distErr 36 -> 41 (+14%)
 *    braids       cardOverlaps 197 ->  0    crossings 19335 -> 23551 (+21.8%)  distErr 43 -> 47 (+9.3%)
 *  nodeOverlaps stayed 0 -> 0 everywhere.
 *
 *  TWO MOVES ARE OVER THE 10% STOP-AND-DIAGNOSE LINE and both are the change doing its job rather
 *  than a second defect. distError rises because a hard 48.2 floor between centres stops a dense
 *  mesh compressing to the distance its edge weights ask for — sorin is the densest board here and
 *  moves most, which is the predicted ordering. braids' crossings rise because a smaller board (75
 *  cards) spread 46% further has longer edges over the same topology, and a longer edge crosses
 *  more. The shape is unchanged: no fixture gained a node overlap, and cardOverlaps fell 98%.
 *
 *  cardOverlaps is NOT capped at 0 on the two big meshes because the collide force is SOFT — one
 *  iteration, alpha decay — so a handful of pairs settle inside a radius that geometrically
 *  guarantees separation. `collideIterations: 2` takes sorin 16 -> ~10 at more crossings; it is a
 *  tuning-panel knob, not the default. */

/** RE-CAPPED for task-10's de-drift force (board-force.ts's `forceDeDrift`), which cancels the
 *  board's common-mode velocity every tick so the centroid stops walking off screen. That force
 *  writes vx/vy, never x/y -- it cannot change the layout's SHAPE, only where that shape sits -- so
 *  crossings/distError/overlaps (all translation-invariant on their own) should have been untouched
 *  by it in isolation. They moved anyway, by single-digit percent, and the reason is `forceX`/
 *  `forceY` (CENTER_PULL): that force pulls toward a FIXED point, which is not translation-invariant,
 *  so once de-drift keeps the centroid pinned near its seed instead of wandering, CENTER_PULL is
 *  acting on a different absolute position every tick from here on and the trajectory differs --
 *  exactly the effect the brief predicted, not a layout regression.
 *
 *  Before -> after, five fixtures, same instrument (800 ticks, 10 trials):
 *    sorin        crossings 43058 -> 42237 (-1.9%)   distErr 41 -> 40 (-2.4%)
 *    inalla       crossings 32740 -> 33368 (+1.9%)   distErr 41 -> 42 (+2.4%)
 *    fairdrazi    crossings 35016 -> 34762 (-0.7%)   distErr 48 -> 48 (unchanged)
 *    changelings  crossings  6736 ->  6868 (+2.0%)   distErr 36 -> 36 (unchanged)
 *    braids       crossings 19796 -> 19335 (-2.3%)   distErr 42 -> 43 (+2.4%)
 *  nodeOverlaps stayed 0 -> 0 on every fixture. Every move is under 3%, nowhere near the brief's 10%
 *  stop-and-diagnose line, so this is capped from the new measurement rather than investigated as a
 *  regression. motionMean -- RENAMED `driftMean` 2026-08-28, and the historical tables above keep the
 *  old name because that is what they were printed under -- (uncapped, diagnostic only, the 180-tick
 *  sample taken after the 800
 *  settling ticks) also dropped, before -> after the de-drift force: sorin 13.75 -> 4.41, inalla
 *  23.20 -> 8.83, fairdrazi 9.81 -> 3.76, changelings 4.60 -> 4.36, braids 9.17 -> 4.06. That drop is
 *  the de-drift force doing its actual job, but it is NOT the instrument that caught DEFECT 1 --
 *  180 ticks starting from an already-settled board never showed a walk this small to begin with;
 *  the centroid-distance table in board-force.test.ts's own drift describe block is what did. */
