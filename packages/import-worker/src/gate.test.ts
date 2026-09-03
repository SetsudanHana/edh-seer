import { expect, test } from "vitest";
import { Gate, Paused, TooBusy, type Clock } from "./gate.js";

/** Virtual time. `sleep` resolves on a microtask and moves the clock forward, so a test that
 *  exercises a 60-second pause takes no wall-clock time and never depends on timer ordering. */
class FakeClock implements Clock {
  t = 0;
  now(): number {
    return this.t;
  }
  async sleep(ms: number): Promise<void> {
    if (ms > 0) this.t += ms;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

const SLOT = 1100;

/** A task that takes `durationMs` of virtual time and records when it started. */
function recorder(clock: FakeClock, durationMs = 0) {
  const starts: number[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const task = async () => {
    starts.push(clock.now());
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    clock.advance(durationMs);
    inFlight--;
    return "ok";
  };
  return { starts, task, maxInFlight: () => maxInFlight };
}

test("twenty concurrent callers never start two upstream calls inside one slot", async () => {
  const clock = new FakeClock();
  const gate = new Gate(clock, { slotMs: SLOT, maxDepth: 50 });
  const { starts, task } = recorder(clock);

  await Promise.all(Array.from({ length: 20 }, () => gate.run(task)));

  expect(starts).toHaveLength(20);
  for (let i = 1; i < starts.length; i++) {
    expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(SLOT);
  }
});

test("the slot is measured from COMPLETION, so a slow response cannot bunch the next one up", async () => {
  const clock = new FakeClock();
  const gate = new Gate(clock, { slotMs: SLOT, maxDepth: 50 });
  // Each call takes 3 seconds. Spacing the STARTS would put the second one in flight while the
  // first is still open; spacing from completion cannot.
  const { starts, task, maxInFlight } = recorder(clock, 3_000);

  await Promise.all([gate.run(task), gate.run(task), gate.run(task)]);

  expect(maxInFlight()).toBe(1);
  expect(starts).toEqual([0, 3_000 + SLOT, 2 * (3_000 + SLOT)]);
});

test("a failure stops everything for the pause window, sending nothing at all", async () => {
  const clock = new FakeClock();
  const gate = new Gate(clock, { slotMs: SLOT, maxDepth: 50, pauseMs: 60_000 });
  let calls = 0;

  await expect(
    gate.run(async () => {
      calls++;
      throw new Error("429");
    }),
  ).rejects.toThrow("429");

  // The next caller is refused WITHOUT the task running. That is the whole point: a retry into a
  // rate limit is the thing we must never do.
  await expect(gate.run(async () => { calls++; return "x"; })).rejects.toBeInstanceOf(Paused);
  expect(calls).toBe(1);

  clock.advance(60_000);
  await expect(gate.run(async () => { calls++; return "x"; })).resolves.toBe("x");
  expect(calls).toBe(2);
});

test("backOff pauses on demand, for the caller that can read a status line", async () => {
  const clock = new FakeClock();
  const gate = new Gate(clock, { pauseMs: 5_000 });
  gate.backOff();
  await expect(gate.run(async () => "x")).rejects.toBeInstanceOf(Paused);
  clock.advance(5_000);
  await expect(gate.run(async () => "x")).resolves.toBe("x");
});

test("the queue is capped: past the cap a caller is refused, not parked behind a wall", async () => {
  const clock = new FakeClock();
  const gate = new Gate(clock, { slotMs: SLOT, maxDepth: 2 });
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  let calls = 0;

  const pending = [
    gate.run(async () => {
      calls++;
      await held;
      return "a";
    }),
    gate.run(async () => {
      calls++;
      return "b";
    }),
  ];
  // Two admitted; the third arrives while both are outstanding.
  await expect(gate.run(async () => { calls++; return "c"; })).rejects.toBeInstanceOf(TooBusy);

  release();
  await Promise.all(pending);
  expect(calls).toBe(2);
});

test("one caller's failure does not poison the callers queued behind it", async () => {
  const clock = new FakeClock();
  const gate = new Gate(clock, { slotMs: SLOT, maxDepth: 50, pauseMs: 0 });
  const results = await Promise.allSettled([
    gate.run(async () => {
      throw new Error("boom");
    }),
    gate.run(async () => "second"),
  ]);
  expect(results[0].status).toBe("rejected");
  expect(results[1]).toMatchObject({ status: "fulfilled", value: "second" });
});
