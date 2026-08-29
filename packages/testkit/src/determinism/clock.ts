/**
 * A clock that does not move unless a test moves it.
 *
 * `docs/TEST_STRATEGY.md` section 2.1: "a fixed clock when operational
 * metadata is enabled". The canonical report has no time field at all
 * (`docs/ARCHITECTURE.md` section 9), so this exists for the envelope and for
 * anything that would otherwise reach for `Date.now()`.
 *
 * It deliberately does not install itself over `Date.now`. A global clock
 * patch makes every test in the worker share one mutable instant, and the
 * failure mode is a test that passes alone and fails in a suite.
 */
export class FrozenClock {
  #now: number;

  constructor(startMs = 0) {
    this.#now = startMs;
  }

  now(): number {
    return this.#now;
  }

  /** ISO 8601 with millisecond precision, as `Date.prototype.toISOString`. */
  nowIso(): string {
    return new Date(this.#now).toISOString();
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError(
        `a frozen clock only moves forward; advance(${String(milliseconds)})`,
      );
    }
    this.#now += milliseconds;
  }
}
