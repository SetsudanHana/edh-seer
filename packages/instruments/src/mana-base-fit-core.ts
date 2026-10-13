/** THE ARITHMETIC OF THE `MANA_BASE_COST.colourMiss` FIT (#1169 task 3), importable. The sweep that makes the rows needs Mongo and lives in
 *  `research/matcher/mana-base-fit.ts`; this is the part that turns rows into a slope, so a test can pin the shipped constant to it. */

export interface LostWays { screw: number; colour: number; flood: number }
/** One deck of the fit, as the fixture `data/mana-base-fit-rows.json` carries it: `colourMiss` is the x, the two arms are what the y is made of. */
export interface FitRow { name: string; kind: "precon" | "calibration"; colourMiss: number; base: LostWays; allCol: LostWays }

/** Lost turns per ten: the SUM of the three ways a turn is lost (a turn colour-screwed and flooded counts twice). The reading that reproduces the record. */
export const lostTurns = (l: LostWays): number => l.screw + l.colour + l.flood;
/** What the colours cost a deck: the lost turns it has over the same deck with every land making every colour. */
export const colourCost = (r: FitRow): number => lostTurns(r.base) - lostTurns(r.allCol);

export interface Fit { n: number; slope: number; r2Centred: number; r2Uncentred: number; r2Pearson: number; meanX: number; meanY: number }

/** Least squares through the origin, with R^2 read both centred and uncentred. `slope` pins the line (to score a shipped value) instead of fitting it. */
export function fit(xs: readonly number[], ys: readonly number[], slope?: number): Fit {
  const n = xs.length;
  const sxy = xs.reduce((a, x, i) => a + x * ys[i]!, 0), sxx = xs.reduce((a, x) => a + x * x, 0);
  const b = slope ?? sxy / sxx;
  const my = ys.reduce((a, y) => a + y, 0) / n, mx = xs.reduce((a, x) => a + x, 0) / n;
  const sse = ys.reduce((a, y, i) => a + (y - b * xs[i]!) ** 2, 0);
  const sst = ys.reduce((a, y) => a + (y - my) ** 2, 0);
  const sst0 = ys.reduce((a, y) => a + y * y, 0);
  const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i]! - my), 0);
  const vx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return { n, slope: b, r2Centred: 1 - sse / sst, r2Uncentred: 1 - sse / sst0, r2Pearson: (cov * cov) / (vx * sst), meanX: mx, meanY: my };
}

/** The fit `MANA_BASE_COST.colourMiss` is: all rows, y = `colourCost`, x = `colourMiss`, through the origin. */
export const colourFit = (rows: readonly FitRow[]): Fit => fit(rows.map((r) => r.colourMiss), rows.map(colourCost));

export const round3 = (x: number): number => Math.round(x * 1000) / 1000;
