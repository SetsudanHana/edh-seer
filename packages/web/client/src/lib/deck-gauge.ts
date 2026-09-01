import { LAND_BAND, LAND_FALLOFF } from "@edh-seer/matcher/build";
import { scoreBand, type ScoreTone } from "./score-band.js";

export type GaugeTone = "danger" | "warning" | "success" | "neutral";

export interface GaugeReading {
  /** Machine-readable bucket, for tests and for the mark's own class. */
  state: string;
  /** What the reader is told IN WORDS. The tone is never the only carrier of the state --
   *  WCAG 1.4.1, and a dial is exactly the mark that tempts a colour-only reading. */
  label: string;
  tone: GaugeTone;
  /** Where the needle sits, -1 (far under) to 1 (far over), 0 dead centre.
   *
   *  CEILING: the needle rests at its BUCKET's centre, so +3 and +30 point to the same place. The
   *  exact figure is printed beside the dial, which is what a reader acts on; interpolating inside
   *  a bucket needs a span to divide by and every candidate span (the target itself, a multiple of
   *  it, a fixed number of cards) would be invented. Upgrade path: if a real span is ever measured
   *  -- p25/p75 from `build-population.ts` is the obvious candidate -- interpolate within the
   *  bucket and leave every threshold here untouched. */
  position: number;
}

const TONE_OF_SCORE: Record<ScoreTone, GaugeTone> = {
  low: "danger", mid: "warning", good: "success", high: "success",
};

/** A FLOOR, NOT A TARGET, and the asymmetry below is that fact rendered.
 *
 *  `build.ts:520` is `Math.min(p.count / p.target, 1) // exceeding a floor never penalizes`, so a
 *  parent past its target scores full credit; the trim chips call the same overshoot "where the
 *  room is" and the cut list is built from it. A symmetric dial would tell the reader the opposite
 *  of the score and the cut list on the same screen. Making over a genuine fault means making
 *  attainment two-sided in the engine, which re-opens every parent target and needs its own
 *  before/after over the 71 calibration decks -- see the spec, section 3.1. */
export function floorState(count: number, target: number): GaugeReading {
  if (target <= 0) return { state: "on-target", label: "no floor set", tone: "neutral", position: 0 };
  const d = count - target;
  if (d <= -3) return { state: "far-under", label: `${-d} short`, tone: "danger", position: -1 };
  if (d < 0) return { state: "under", label: `${-d} short`, tone: "warning", position: -0.5 };
  if (d <= 2) return { state: "on-target", label: "on target", tone: "success", position: 0 };
  return { state: "room", label: `${d} over target`, tone: "neutral", position: 1 };
}

/** THE ONE TWO-SIDED GAUGE. Over is wrong for lands in a way it is not for a role floor, and the
 *  tolerance is the engine's own -- imported, never transcribed.
 *
 *  IT DELIBERATELY DISAGREES WITH `landFinding`, which fires on ANY non-zero delta
 *  (`lib/findings.ts:240`) while `buildScore` gives full credit within ±3. Both are shipped today,
 *  so 38 against a modelled 36 is a ranked finding AND a perfect score. A gauge reports a STATE and
 *  must not contradict the score beside it; a finding ranks what is worth SAYING and may be more
 *  sensitive. Reconciling the two thresholds changes which findings fire, so it is its own work. */
export function bandState(count: number, target: number): GaugeReading {
  if (target <= 0) return { state: "on-band", label: "no model", tone: "neutral", position: 0 };
  const d = count - target;
  const far = LAND_BAND + LAND_FALLOFF;
  if (Math.abs(d) <= LAND_BAND) return { state: "on-band", label: "on the modelled count", tone: "success", position: 0 };
  const dir = d > 0 ? "over" : "under";
  const size = Math.abs(d);
  if (size < far) {
    return { state: dir, label: `${size} ${dir}`, tone: "warning", position: d > 0 ? 0.5 : -0.5 };
  }
  return { state: `far-${dir}`, label: `${size} ${dir}`, tone: "danger", position: d > 0 ? 1 : -1 };
}

/** A CEILING, NOT A CENTRE: 5 is the best a deck can do, so this dial has no over side and is the
 *  one-directional quality shape rather than the diverging one. Bands come from `scoreBand`, which
 *  `HeadlineScores` already prints, so the two renderings of one score cannot disagree.
 *
 *  `partial` is the rule `HeadlineScores` enforces: `synergyOverall` is edge-derived, so on a deck
 *  where the engine could not read half the cards a red 0.8/5 is the engine's blindness rendered as
 *  the player's failure. The NUMBER still shows -- refusing it would be a second wrong answer. */
export function scoreState(score: number, partial?: boolean): GaugeReading {
  const position = Math.max(-1, Math.min(1, (score / 5) * 2 - 1));
  if (partial) {
    return { state: "unread", label: "too little of the deck read to call this", tone: "neutral", position };
  }
  const band = scoreBand(score);
  return { state: band.label.toLowerCase(), label: band.label.toLowerCase(), tone: TONE_OF_SCORE[band.tone], position };
}
