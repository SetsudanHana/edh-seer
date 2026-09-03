/** THE SERIALISATION POINT FOR EVERY OUTBOUND DECK FETCH.
 *
 *  Both deck sites ask for at most one request per second, and we honour it as a hard guarantee
 *  rather than an average. Every upstream fetch goes through one `Gate`, and a `Gate` lives inside a
 *  Durable Object, which the runtime guarantees is a single instance globally. Nothing else on
 *  Cloudflare is single-threaded across colos, so nothing else can make the guarantee.
 *
 *  It is pure and clock-injected ON PURPOSE. A rate limiter that has only ever been tested by
 *  watching production is a rate limiter nobody has tested. */

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()),
};

/** Our own queue is full. The caller should be told to try again, NOT queued behind ten others. */
export class TooBusy extends Error {
  constructor() {
    super("importer busy");
    this.name = "TooBusy";
  }
}

/** Upstream told us to stop, or stopped answering. Nothing is sent while this holds. */
export class Paused extends Error {
  constructor(readonly untilMs: number) {
    super("importer paused");
    this.name = "Paused";
  }
}

export interface GateOptions {
  /** 1100, not 1000: their measurement window is not our clock, and 100ms of margin is free. */
  slotMs?: number;
  /** Admission cap. Beyond this the caller is refused rather than queued behind a wall. */
  maxDepth?: number;
  /** How long we stay silent after upstream complains. */
  pauseMs?: number;
}

export class Gate {
  private readonly slotMs: number;
  private readonly maxDepth: number;
  private readonly pauseMs: number;

  /** Earliest wall-clock time the next upstream call may START. */
  private nextSlotAt = 0;
  /** While `now()` is below this, we send nothing at all. */
  private pausedUntil = 0;
  /** Admitted-but-unfinished tasks, including the running one. */
  private depth = 0;
  /** The serial chain. Tasks run strictly one after another; see the note in `run`. */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly clock: Clock = realClock,
    opts: GateOptions = {},
  ) {
    this.slotMs = opts.slotMs ?? 1100;
    this.maxDepth = opts.maxDepth ?? 6;
    this.pauseMs = opts.pauseMs ?? 60_000;
  }

  /** Runs `task` as the only upstream call in flight, no sooner than one slot after the previous
   *  one FINISHED.
   *
   *  Spacing the starts is not enough. If a response takes three seconds and we start the next call
   *  one second in, two are in flight -- and one slow response has turned into a burst at exactly
   *  the moment upstream is least happy. So the slot is measured from completion, and the chain is
   *  serial rather than a set of reservations.
   *
   *  Admission is checked SYNCHRONOUSLY, before joining the chain, because a caller who will wait
   *  a minute wants a 429 now, and because a Durable Object that spends its wall-clock sleeping in a
   *  queue takes every queued request down with it when it is evicted. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    const now = this.clock.now();
    if (now < this.pausedUntil) throw new Paused(this.pausedUntil);
    if (this.depth >= this.maxDepth) throw new TooBusy();

    this.depth++;
    const mine = this.tail.then(() => this.execute(task));
    // The chain must never reject: one failed fetch must not poison every request behind it.
    this.tail = mine.then(
      () => undefined,
      () => undefined,
    );
    try {
      return await mine;
    } finally {
      this.depth--;
    }
  }

  private async execute<T>(task: () => Promise<T>): Promise<T> {
    const now = this.clock.now();
    // Re-checked here as well: the breaker may have tripped while this task sat in the queue, and
    // the whole point of the breaker is that nothing is sent after it does.
    if (now < this.pausedUntil) throw new Paused(this.pausedUntil);

    const wait = this.nextSlotAt - now;
    if (wait > 0) await this.clock.sleep(wait);

    try {
      return await task();
    } catch (err) {
      // ANY failure trips the breaker, not just a 429. A timeout or a 502 says upstream is unwell,
      // and the worst thing to do to something unwell is keep asking. The caller
      // aborts its own fetch on a deadline (`AbortSignal.timeout`), so a hang arrives here as a
      // rejection rather than holding the queue open forever.
      this.pausedUntil = this.clock.now() + this.pauseMs;
      throw err;
    } finally {
      // FROM COMPLETION, not from the start.
      this.nextSlotAt = this.clock.now() + this.slotMs;
    }
  }

  /** Upstream asked us to back off. Called by the owner of the fetch, which is the only code that
   *  can read a status line. */
  backOff(): void {
    this.pausedUntil = this.clock.now() + this.pauseMs;
  }

}
