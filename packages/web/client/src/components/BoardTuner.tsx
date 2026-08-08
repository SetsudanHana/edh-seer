import { useEffect, useState } from "react";
import { boardMetrics, countOverlaps, DEFAULT_PARAMS, type BoardParams } from "./board-force.js";

/** A slider descriptor. `log` knobs are d3 stiffnesses spanning decades, where a linear slider
 *  spends 90% of its travel in a range that visibly does nothing. */
export interface Knob {
  key: keyof BoardParams;
  min: number;
  max: number;
  log: boolean;
  /** Integer-only knobs (collide iterations) snap; everything else is continuous. */
  step?: number;
}

/** Ranges bracket every value the migration's ten-trial table tried (REPULSION 10..2200), so the
 *  panel can reproduce any published arm. See the design doc's 3. */
export const KNOBS: readonly Knob[] = [
  { key: "repulsion", min: 1, max: 2200, log: true },
  { key: "roomAttraction", min: 1e-4, max: 1e-1, log: true },
  { key: "containment", min: 1e-4, max: 1e-1, log: true },
  { key: "foreignPush", min: 1e-4, max: 1e-1, log: true },
  { key: "linkStiffness", min: 1e-4, max: 1e-1, log: true },
  { key: "centerPull", min: 1e-5, max: 1e-2, log: true },
  { key: "velocityDecay", min: 0.01, max: 0.9, log: false },
  { key: "alphaDecay", min: 0.001, max: 0.1, log: false },
  { key: "alphaFloor", min: 0, max: 0.2, log: false },
  { key: "collideIterations", min: 1, max: 4, log: false, step: 1 },
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

export function fromSlider(k: Knob, position: number): number {
  const t = position / 1000;
  const v = k.log
    ? Math.exp(Math.log(k.min) + t * (Math.log(k.max) - Math.log(k.min)))
    : k.min + t * (k.max - k.min);
  return k.step ? Math.round(v / k.step) * k.step : v;
}

export interface ProbeSnapshot {
  cards: readonly { x: number; y: number; rooms: readonly string[] | null }[];
  circles: readonly { id: string; x: number; y: number; r: number }[];
}

/** The source constant a param key writes back to, for the copy button. */
const CONSTANT_NAME: Record<keyof BoardParams, string> = {
  repulsion: "REPULSION",
  roomAttraction: "ROOM_ATTRACTION",
  containment: "CONTAINMENT",
  foreignPush: "FOREIGN_PUSH",
  linkStiffness: "LINK_STIFFNESS",
  centerPull: "CENTER_PULL",
  velocityDecay: "VELOCITY_DECAY",
  alphaDecay: "ALPHA_DECAY",
  alphaFloor: "ALPHA_FLOOR",
  collideIterations: "COLLIDE_ITERATIONS",
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
    { escapes: { one: number; two: number; threePlus: number }; intrusions: number; overlaps: number }
  | null>(null);

  useEffect(() => {
    const read = () => {
      const snap = probe();
      if (!snap) return setMetrics(null);
      const { escapes, intrusions } = boardMetrics(snap.cards, snap.circles);
      setMetrics({ escapes, intrusions, overlaps: countOverlaps(snap.cards) });
    };
    read();
    const id = setInterval(read, POLL_MS);
    return () => clearInterval(id);
  }, [probe]);

  // FOREIGN_PUSH < CONTAINMENT is a hard constraint (board-force.ts) -- the reverse expels cards
  // from every room at once. Flagged, never enforced: watching the board fall apart is a thing a
  // tuning rig is FOR, and a slider that refuses to move is worse than one that warns.
  const stiffnessInverted = params.foreignPush >= params.containment;

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
      <span className="tabular-nums">{value}</span>
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
            <output className="tabular-nums">{formatValue(params[k.key])}</output>
          </span>
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

      {stiffnessInverted ? (
        <p data-testid="stiffness-warning" className="text-(--warning) py-1">
          foreignPush ≥ containment — cards are expelled from every room at once
        </p>
      ) : null}

      <div className="border-t border-(--separator) mt-2 pt-2">
        {metrics ? (
          <>
            {metric("metric-escapes-one", "escapes 1-room", metrics.escapes.one, true)}
            {metric("metric-overlaps", "overlaps", metrics.overlaps, true)}
            {metric("metric-escapes-two", "escapes 2-room", metrics.escapes.two, false)}
            {metric("metric-escapes-three", "escapes 3+", metrics.escapes.threePlus, false)}
            {metric("metric-intrusions", "intrusions", metrics.intrusions, false)}
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
