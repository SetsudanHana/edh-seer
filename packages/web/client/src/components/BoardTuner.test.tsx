import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi, afterEach } from "vitest";
import { BoardTuner, KNOBS, fromSlider, toSlider } from "./BoardTuner.js";
import { DEFAULT_PARAMS, REPULSION } from "./board-force.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const emptyProbe = () => ({ cards: [], edges: [] });

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
    // toBeCloseTo(_, 1) not the round-trip tests' 6: fromSlider now rounds to 3 significant
    // digits (see its doc comment in BoardTuner.tsx), so a shape assertion like this one is only
    // exact to that many digits -- 46.9 vs the unrounded 46.90415... -- while a round-tripped
    // DEFAULT_PARAMS value stays exact because every default already IS a 3-sig-fig number.
    expect(mid).toBeCloseTo(Math.sqrt(k.min * k.max), 1);
  });
});

describe("BoardTuner", () => {
  test("renders one slider per knob", () => {
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={emptyProbe} />);
    expect(screen.getAllByRole("slider")).toHaveLength(KNOBS.length);
  });

  test("every knob explains what it controls, alongside its constant name", () => {
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={emptyProbe} />);
    for (const k of KNOBS) {
      expect(k.what.length).toBeGreaterThan(0);
      expect(screen.getByText(k.what)).toBeTruthy();
      // The constant name survives: it is what the copy button emits.
      expect(screen.getByText(k.key)).toBeTruthy();
    }
    // The slider's accessible name stays the constant name, so the copy workflow and the tests
    // address knobs by the same identifier the source uses.
    expect(screen.getByLabelText("linkStrengthK")).toBeTruthy();
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
    expect(onChange.mock.calls[0][0].centerPull).toBe(DEFAULT_PARAMS.centerPull);
  });

  test("polls the probe and reports the drawing-quality metrics", () => {
    vi.useFakeTimers();
    // Two cards a hair apart at the origin: one overlapping pair. Their edge asks for 200 world
    // units and gets 1, so the rms distance error is ~199.
    const probe = () => ({
      cards: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
      edges: [{ from: "a", to: "b", target: 200 }],
    });
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={probe} />);
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("metric-overlaps")).toHaveTextContent("1");
    expect(screen.getByTestId("metric-dist-error")).toHaveTextContent("199");
    // Overlapping discs are the hard condition, so that one reads as a warning.
    expect(screen.getByTestId("metric-overlaps").className).toContain("warning");
    // One edge cannot cross anything.
    expect(screen.getByTestId("metric-crossings")).toHaveTextContent("0");
  });

  test("shows a cards count, so an empty or destroyed board reads as empty rather than perfect", () => {
    const probe = () => ({
      cards: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
      edges: [],
    });
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={probe} />);
    expect(screen.getByTestId("metric-cards")).toHaveTextContent("2");
  });

  test("re-polls on the interval, not just once at mount", () => {
    vi.useFakeTimers();
    // read() also runs synchronously on mount (`read(); const id = setInterval(read, ...)`), so a
    // test that only checks the FIRST reading passes even with setInterval deleted outright -- the
    // panel would freeze on its first reading and display it forever. A second, different reading
    // from the same probe is what actually exercises the poll.
    const probe = vi.fn()
      .mockReturnValueOnce({ cards: [{ id: "a", x: 0, y: 0 }], edges: [] })
      .mockReturnValue({
        cards: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 1, y: 0 }],
        edges: [],
      });
    render(<BoardTuner params={DEFAULT_PARAMS} onChange={() => {}} probe={probe} />);
    expect(screen.getByTestId("metric-cards")).toHaveTextContent("1");
    act(() => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("metric-cards")).toHaveTextContent("2");
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
    expect(text).toContain(`export const CENTER_PULL = ${DEFAULT_PARAMS.centerPull};`);
    expect(text.split("\n").filter((l) => l.includes("changed from"))).toHaveLength(1);
  });
});
