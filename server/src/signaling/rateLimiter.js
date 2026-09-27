/**
 * Fixed-window counter. Cheap, dependency free and good enough to stop a
 * runaway client from flooding the signaling server.
 */
export function createWindowLimiter({ windowMs, max }) {
  let count = 0;
  let windowStart = Date.now();
  return {
    max,
    /** Records one event and returns how many have been seen in this window. */
    take() {
      const now = Date.now();
      if (now - windowStart >= windowMs) {
        windowStart = now;
        count = 0;
      }
      count += 1;
      return count;
    },
    reset() {
      count = 0;
      windowStart = Date.now();
    },
  };
}

export const RATE_LIMIT_WINDOW_MS = 10_000;
