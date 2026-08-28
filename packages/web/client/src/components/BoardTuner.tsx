import { useEffect, useState } from "react";
import { countOverlaps, DEFAULT_PARAMS, type BoardParams } from "./board-force.js";
import { edgeCrossings, linkDistError } from "./board-quality.js";

/** The params a SLIDER can carry. `linkDegreeNorm` is a boolean and is deliberately not one: it
 *  picks between two force laws rather than moving a value along a range, and it is chosen by
 *  measurement (the harness's arms), not by dragging. Deriving the key set instead of listing it
 *  means the next boolean param cannot silently become `NaN` in a slider. */
type NumericParam = {
  [K in keyof BoardParams]: BoardParams[K] extends number ? K : never
}[keyof BoardParams];

/** A slider descriptor. `log` knobs are d3 stiffnesses spanning decades, where a linear slider
 *  spends 90% of its travel in a range that visibly does nothing. */
export interface Knob {
  key: NumericParam;
  /** One line of plain English for what the knob does to the board. The constant NAME stays on the
   *  row beside it -- it is what the copy button emits and what gets pasted into board-force.ts,
   *  so a friendly label replacing it would break the one workflow this panel exists for. */
  what: string;
  min: number;
  max: number;
  log: boolean;
  /** Integer-only knobs (collide iterations) snap; everything else is continuous. */
  step?: number;
}

/** Ranges bracket every value the migration's ten-trial table tried (REPULSION 10..2200), so the
 *  panel can reproduce any published arm. See the design doc's 3. */
export const KNOBS: readonly Knob[] = [
  { key: "repulsion", what: "how hard every card pushes every other apart", min: 1, max: 2200, log: true },
  { key: "repulsionRange", what: "how far that push reaches; below the board's width it only spaces neighbours", min: 40, max: 900, log: true },
  { key: "linkStrengthK", what: "how hard a synergy edge holds its pair at the distance its weight asks for", min: 0.01, max: 1, log: true },
  { key: "centerPull", what: "pull toward the origin, which is all that anchors a card with no edges", min: 1e-5, max: 1e-2, log: true },
  { key: "velocityDecay", what: "friction -- how much speed is kept between ticks", min: 0.01, max: 0.9, log: false },
  { key: "alphaDecay", what: "how fast the layout cools toward its resting energy", min: 0.001, max: 0.1, log: false },
  { key: "alphaFloor", what: "the energy it never cools below, so the board keeps settling", min: 0, max: 0.2, log: false },
  { key: "collideIterations", what: "passes of disc-overlap resolution per tick", min: 1, max: 4, log: false, step: 1 },
];

/** Every slider runs 0..1000 in its own units; these two map that to the knob's real range. A log
 *  knob's midpoint is the GEOMETRIC mean of its endpoints, which is the whole point -- 1e-4..1e-1
 *  on a linear slider puts every useful stiffness in the first 1% of the travel. */
export function toSlider(k: Knob, value: number): number {
  const t = k.log
    ? (Math.log(value) - Math.log(k.min)) / (Math.log(k.max) - Math.log(k.min))
    : (value - k.min) / (k.max - k.min);
  return t * 1000;
}

/** Rounded here, not at the copy button: the value that reaches the simulation must be the value
 *  the metrics were measured against, so rounding inside copy() would commit a constant that was
 *  never actually run. Three significant digits -- the log knobs move ~0.77% per slider position
 *  at 1000 positions, so 3 digits keeps neighbouring positions distinct while making a measured
 *  constant like 25 recoverable by hand (toSlider(25) -> 418 -> raw 24.953569628510607 ->
 *  toPrecision(3) -> 25). `toPrecision` rather than a hand-rolled log10/round: it sidesteps the
 *  floating-point boundary cases a manual magnitude calc hits at exact powers of ten (this file's
 *  own 1e-4 and 1e-5 endpoints). */
export function fromSlider(k: Knob, position: number): number {
  const t = position / 1000;
  const v = k.log
    ? Math.exp(Math.log(k.min) + t * (Math.log(k.max) - Math.log(k.min)))
    : k.min + t * (k.max - k.min);
  return k.step ? Math.round(v / k.step) * k.step : Number(v.toPrecision(3));
}

export interface ProbeSnapshot {
  cards: readonly { id: string; x: number; y: number }[];
  /** Every edge with the distance its weight asked for -- linkDistError's whole input, and not
   *  recomputable from the node positions alone. */
  edges: readonly { from: string; to: string; target: number }[];
}

/** The source constant a param key writes back to, for the copy button. */
const CONSTANT_NAME: Record<NumericParam, string> = {
  repulsion: "REPULSION",
  repulsionRange: "REPULSION_RANGE",
  linkStrengthK: "LINK_STRENGTH_K",
  centerPull: "CENTER_PULL",
  velocityDecay: "VELOCITY_DECAY",
  alphaDecay: "ALPHA_DECAY",
  alphaFloor: "ALPHA_FLOOR",
  collideIterations: "COLLIDE_ITERATIONS",
  // Added to `BoardParams` after this map was written and never added here -- `Record<NumericParam,
  // string>` is exhaustive, so it was a type error the whole time and 2,712 green tests could not
  // see it. It is why `typecheck` is a CI gate now. `KNOBS` still has no collidePad SLIDER, which
  // is a separate gap: that list is curated by hand and choosing a range is a judgement.
  collidePad: "COLLISION_PAD",
};

/** Four readings a second, not one a frame: these numbers are for reading, and countOverlaps is
 *  O(cards^2) -- running it inside the paint loop would tax the thing it is measuring. */
const POLL_MS = 250;

/** A dev-only rig for tuning the board's force constants against the metrics they move. Gated by
 *  its caller (import.meta.env.DEV && debug) -- this component does not gate itself, so its tests
 *  can render it directly. */
export function BoardTuner({
  params, onChange, probe,
}: {
  params: BoardParams;
  onChange: (p: BoardParams) => void;
  probe: () => ProbeSnapshot | null;
}) {
  const [metrics, setMetrics] = useState<
    { cards: number; overlaps: number; crossings: number; distError: number } | null
  >(null);

  useEffect(() => {
    const read = () => {
      const snap = probe();
      if (!snap) return setMetrics(null);
      const at = Object.fromEntries(snap.cards.map((c) => [c.id, { x: c.x, y: c.y }]));
      setMetrics({
        cards: snap.cards.length,
        overlaps: countOverlaps(snap.cards),
        crossings: edgeCrossings(snap.edges, at),
        distError: Math.round(linkDistError(snap.edges, at)),
      });
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [probe]);

  const copy = () => {
    const text = KNOBS.map((k) => {
      const v = params[k.key];
      const changed = v !== DEFAULT_PARAMS[k.key];
      return `export const ${CONSTANT_NAME[k.key]} = ${v};${
        changed ? ` // changed from ${DEFAULT_PARAMS[k.key]}` : ""
      }`;
    }).join("\n");
    void navigator.clipboard.writeText(text);
  };

  const metric = (testid: string, label: string, value: number, hard: boolean) => (
    <div
      data-testid={testid}
      className={`flex justify-between gap-3 ${hard && value > 0 ? "text-(--warning)" : "text-(--muted)"}`}
    >
      <span>{label}</span>
      <span className="stat-num">{value}</span>
    </div>
  );

  return (
    <details
      open
      className="absolute top-2 right-2 w-64 rounded-(--radius) border border-(--border) bg-(--surface) p-2 text-xs"
    >
      <summary className="eyebrow cursor-pointer">tune</summary>

      {KNOBS.map((k) => (
        // A wrapping <label> here (instead of aria-label alone) would also associate with the
        // nested <output> -- itself a labelable HTML element -- making getByLabelText(k.key)
        // ambiguous between the output and the input. aria-label on the input is the sole
        // accessible-name source, so the wrapper is a plain <div>.
        <div key={k.key} className="flex flex-col gap-0.5 py-1">
          <span className="flex justify-between text-(--muted)">
            {k.key}
            <output className="stat-num">{formatValue(params[k.key])}</output>
          </span>
          <span className="text-(--muted) leading-tight" style={{ fontSize: 10 }}>{k.what}</span>
          <input
            type="range"
            aria-label={k.key}
            min={0}
            max={1000}
            step={1}
            value={toSlider(k, params[k.key])}
            onChange={(e) => onChange({ ...params, [k.key]: fromSlider(k, Number(e.target.value)) })}
          />
        </div>
      ))}

      <div className="border-t border-(--separator) mt-2 pt-2">
        {metrics ? (
          <>
            {/* An empty board reads as a perfect one on every metric below -- zero overlaps, zero
             *  crossings, zero distance error -- so the card count is what makes that case legible
             *  instead of a false pass. */}
            {metric("metric-cards", "cards", metrics.cards, false)}
            {metric("metric-overlaps", "overlaps", metrics.overlaps, true)}
            {metric("metric-crossings", "edge crossings", metrics.crossings, false)}
            {/* rms |actual - the distance the edge's weight asked for|: the single number saying
             *  whether the layout honoured the synergy weights at all. */}
            {metric("metric-dist-error", "link dist error", metrics.distError, false)}
          </>
        ) : (
          <p className="text-(--muted)">no board</p>
        )}
      </div>

      <button type="button" onClick={copy} className="eyebrow mt-2 w-full border border-(--separator) rounded-(--radius) py-1">
        copy constants
      </button>
    </details>
  );
}

/** Stiffnesses are small enough that toFixed() would print 0.000; integers should not print as
 *  1.00e+0 either. */
function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v);
  return v < 0.01 ? v.toExponential(2) : v.toFixed(3);
}
