/**
 * Microtask ticks, the only "time" this package has.
 *
 * `docs/TEST_STRATEGY.md` section 2.1 forbids ordinary tests from depending on
 * wall-clock timing, and ADR-0005 section 7 test 2 still needs a way to give
 * one canned response more latency than another. A count of resolved promises
 * is that way: it reorders nothing a real timer would not, it is exactly
 * reproducible, and it costs no elapsed time.
 */
export async function ticks(count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve();
  }
}
