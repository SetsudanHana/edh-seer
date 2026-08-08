import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, afterEach } from "vitest";
import { BoardTuner, KNOBS, fromSlider, toSlider } from "./BoardTuner.js";
import { DEFAULT_PARAMS, REPULSION } from "./board-force.js";
import { ART_RADIUS } from "./deck-rooms.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const emptyProbe = () => ({ cards: [], circles: [] });

describe("slider scale", () => {
  test("every knob round-trips its own default", () => {
    for (const k of KNOBS) {
      const v = DEFAULT_PARAMS[k.key];
      expect(fromSlider(k, toSlider(k, v))).toBeCloseTo(v, 6);
    }
  });

  test("the endpoints map exactly", () => {
    for (const k of KNOBS) {
      expect(fromSlider(k, toSlider(k, k.min))).toBeCloseTo(k.min, 6);
      expect(fromSlider(k, toSlider(k, k.max))).toBeCloseTo(k.max, 6);
    }
  });

  test("a log knob's midpoint is its geometric mean, not its arithmetic one", () => {
    const k = KNOBS.find((k) => k.key === "repulsion")!;
    const mid = fromSlider(k, (toSlider(k, k.min) + toSlider(k, k.max)) / 2);
    expect(mid).toBeCloseTo(Math.sqrt(k.min * k.max), 4);
  });
});

describe("BoardTuner", () => {
  test("renders one slider per knob", () => {
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={emptyProbe} />);
    expect(screen.getAllByRole("slider")).toHaveLength(KNOBS.length);
  });

  test("moving a slider reports the mapped value, not the slider position", () => {
    const onChange = vi.fn();
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={onChange} probe={emptyProbe} />);
    const slider = screen.getByLabelText("repulsion");
    const k = KNOBS.find((k) => k.key === "repulsion")!;
    fireEvent.change(slider, { target: { value: String(toSlider(k, 100)) } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].repulsion).toBeCloseTo(100, 4);
    // Every other key rides along unchanged.
    expect(onChange.mock.calls[0][0].containment).toBe(DEFAULT_PARAMS.containment);
  });

  test("flags FOREIGN_PUSH >= CONTAINMENT without preventing it", () => {
    const { rerender } = render(
      <BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={emptyProbe} />,
    );
    expect(screen.queryByTestId("stiffness-warning")).toBeNull();
    rerender(
      <BoardTuner
        params={{ ...DEFAULT_PARAMS, foreignPush: DEFAULT_PARAMS.containment }}
        onChange={() => {}}
        probe={emptyProbe}
      />,
    );
    expect(screen.getByTestId("stiffness-warning")).toBeTruthy();
    // Still movable: the constraint is flagged, not enforced.
    expect(screen.getByLabelText("foreignPush")).not.toBeDisabled();
  });

  test("polls the probe and reports the hard conditions", () => {
    vi.useFakeTimers();
    // One card in room "ramp", sitting outside ramp's circle: one escape, one-room bucket.
    // Two cards overlapping at the origin: one overlap pair.
    const probe = () => ({
      cards: [
        { x: 500, y: 0, rooms: ["ramp"] },
        { x: 0, y: 0, rooms: [] },
        { x: 1, y: 0, rooms: [] },
      ],
      circles: [{ id: "ramp", x: 0, y: 0, r: 100 }],
    });
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={probe} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("metric-escapes-one")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-overlaps")).toHaveTextContent("1");
    // Both hard conditions are broken, so both read as warnings.
    expect(screen.getByTestId("metric-escapes-one").className).toContain("warning");
    expect(screen.getByTestId("metric-overlaps").className).toContain("warning");
  });

  test("copies a constant block, marking only what changed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(
      <BoardTuner
        params={{ ...DEFAULT_PARAMS, repulsion: 100 }}
        onChange={() => {}}
        probe={emptyProbe}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain(`export const REPULSION = 100;`);
    expect(text).toContain(`// changed from ${REPULSION}`);
    // An unchanged constant is present but unmarked.
    expect(text).toContain(`export const CONTAINMENT = ${DEFAULT_PARAMS.containment};`);
    expect(text.split("\n").filter((l) => l.includes("changed from"))).toHaveLength(1);
  });
});
