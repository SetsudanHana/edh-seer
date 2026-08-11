import { useEffect, useState } from "react";
import { boardMetrics, countOverlaps, DEFAULT_PARAMS, type BoardParams } from "./board-force.js";

/** A slider descriptor. `log` knobs are d3 stiffnesses spanning decades, where a linear slider
 *  spends 90% of its travel in a range that visibly does nothing. */
export interface Knob {
  key: keyof BoardParams;
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
  { key: "repulsion", what: "how hard every node pushes every other apart", min: 1, max: 2200, log: true },
  { key: "roomAttraction", what: "pull between two cards per room they share", min: 1e-4, max: 1e-1, log: true },
  { key: "containment", what: "how hard a room pulls a stray member back inside", min: 1e-4, max: 1e-1, log: true },
  { key: "foreignPush", what: "how hard a room pushes a non-member out (must stay below containment)", min: 1e-4, max: 1e-1, log: true },
  { key: "linkStiffness", what: "spring strength along an edge", min: 1e-4, max: 1e-1, log: true },
  { key: "centerPull", what: "pull toward the origin, for nodes no room claims", min: 1e-5, max: 1e-2, log: true },
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
  cards: readonly { x: number; y: number; rooms: readonly string[] | null }[];
  circles: readonly { id: string; x: number; y: number; r: number }[];
  /** Cards projectRoomMembership could not place within its pass ceiling. Unlike everything else
   *  here it cannot be recomputed from a snapshot -- it is a fact about the last tick's work, not
   *  about the resulting geometry, so the board has to hand it over. */
  unresolved: number;
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
    { cards: number; escapes: { one: number; two: number; threePlus: number }; intrusions: number;
      overlaps: number; unresolved: number }
  | null>(null);

  useEffect(() => {
    const read = () => {
      const snap = probe();
      if (!snap) return setMetrics(null);
      const { escapes, intrusions } = boardMetrics(snap.cards, snap.circles);
      setMetrics({
        cards: snap.cards.length, escapes, intrusions,
        overlaps: countOverlaps(snap.cards), unresolved: snap.unresolved,
      });
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

      {stiffnessInverted ? (
        <p data-testid="stiffness-warning" className="text-(--warning) py-1">
          foreignPush ≥ containment — cards are expelled from every room at once
        </p>
      ) : null}

      <div className="border-t border-(--separator) mt-2 pt-2">
        {metrics ? (
          <>
            {/* A destroyed board reads identically to a settled one on every metric below: room
             *  circles are DERIVED from their member cards' own positions (roomLayout in
             *  board-force.ts), so an empty card set (the `card` kind chip toggled off) or every
             *  card expelled off-screen (foreignPush misconfigured above containment) both leave
             *  escapes/intrusions/overlaps at a clean zero -- the circles just follow the cards
             *  wherever they went. This row is what makes that case legible instead of a false
             *  pass. */}
            {metric("metric-cards", "cards", metrics.cards, false)}
            {metric("metric-escapes-one", "escapes 1-room", metrics.escapes.one, true)}
            {metric("metric-overlaps", "overlaps", metrics.overlaps, true)}
            {/* The third hard condition, and the only one that is not a property of the geometry
              *  in front of you: intrusions and escapes both read zero on a board the projection
              *  gave up on, because it leaves the cards it could not place exactly where they
              *  were and they are then counted like any other. */}
            {metric("metric-unresolved", "unresolved", metrics.unresolved, true)}
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
